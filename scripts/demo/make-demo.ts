/**
 * Makes the demo film for one language, step by step or all at once.
 *
 *   npm run demo -- <en|ko> [voice|record|build|all] [--estimate]
 *
 * voice: Google Cloud TTS for the presenter (paid, cached per sentence). With --estimate, no audio:
 *   sentence lengths are estimated, and the film is built silent and marked as not voiced.
 * record: drives the app in Chrome at DEMO_BASE_URL (default: the local production server). It never starts
 *   a paid run or edit: those requests are blocked and the recording fails if one is attempted.
 * build: renders the motion scenes, cuts the recording and film, mixes the sound, writes the check note.
 */
import { join } from "node:path";
import type { Language } from "../../src/lib/pipeline/schemas";
import { OUT } from "./config";
import { buildStoryboard } from "./storyboard";

const STEPS = ["voice", "record", "build"] as const;
type Step = (typeof STEPS)[number];

async function main(): Promise<void> {
  const lang = process.argv[2] as Language;
  const step = (process.argv.slice(3).find((a) => !a.startsWith("--")) ?? "all") as Step | "all";
  if (lang !== "ko" && lang !== "en") throw new Error("usage: make-demo <en|ko> [step]");
  if (step !== "all" && !STEPS.includes(step)) throw new Error(`unknown step ${step}`);
  const run = (s: Step) => step === "all" || step === s;
  const outDir = join(OUT, lang);
  const voiceDir = join(outDir, "voice");
  const recDir = join(outDir, "rec");
  const scenes = buildStoryboard();
  const started = Date.now();

  if (run("voice")) {
    const { estimateStoryboard, voiceStoryboard } = await import("./voice");
    const estimate = process.argv.includes("--estimate");
    const voiced = await (estimate ? estimateStoryboard : voiceStoryboard)(lang, scenes, voiceDir);
    for (const v of voiced)
      console.log(
        `${v.scene}-${v.index}: ${v.seconds.toFixed(2)} s, ${v.wpm.toFixed(0)} wpm @${v.rate}`,
      );
  }
  if (run("record")) {
    const { recordApp } = await import("./record");
    const { readVoiceManifest } = await import("./voice");
    await recordApp({ scenes, voiced: await readVoiceManifest(voiceDir), outDir: recDir });
  }
  if (run("build")) {
    const { buildFilm } = await import("./build");
    const { readVoiceManifest } = await import("./voice");
    const out = await buildFilm({
      lang,
      scenes,
      voiced: await readVoiceManifest(voiceDir),
      recDir,
      outDir,
    });
    console.log(`demo: ${out}`);
  }
  console.log(`demo ${lang} ${step}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
