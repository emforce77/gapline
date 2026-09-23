/**
 * Makes the demo film for one language, step by step or both at once.
 *
 *   npm run demo -- <en|ko> [record|build|all]
 *
 * The film has no presenter voice: captions tell the story, and every scene is timed by how long its
 * captions take to read (timing.ts), so both steps work from the storyboard alone.
 * record: drives the app in Chrome at DEMO_BASE_URL (default: the local production server). It never starts
 *   a paid run or edit: those requests are blocked and the recording fails if one is attempted.
 * build: renders the motion scenes, cuts the recording and film, mixes the sound, writes the check note.
 */
import { join } from "node:path";
import type { Language } from "../../src/lib/pipeline/schemas";
import { OUT } from "./config";
import { buildStoryboard } from "./storyboard";

const STEPS = ["record", "build"] as const;
type Step = (typeof STEPS)[number];

async function main(): Promise<void> {
  const lang = process.argv[2] as Language;
  const step = (process.argv[3] ?? "all") as Step | "all";
  if (lang !== "ko" && lang !== "en") throw new Error("usage: make-demo <en|ko> [record|build]");
  if (step !== "all" && !STEPS.includes(step)) throw new Error(`unknown step ${step}`);
  const run = (s: Step) => step === "all" || step === s;
  const outDir = join(OUT, lang);
  const recDir = join(outDir, "rec");
  const scenes = buildStoryboard();
  const started = Date.now();

  if (run("record")) {
    const { recordApp } = await import("./record");
    await recordApp({ scenes, lang, outDir: recDir });
  }
  if (run("build")) {
    const { buildFilm } = await import("./build");
    const out = await buildFilm({ lang, scenes, recDir, outDir });
    console.log(`demo: ${out}`);
  }
  console.log(`demo ${lang} ${step}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
