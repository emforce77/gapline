/**
 * Makes the demo video for one language, step by step or all at once.
 *
 *   npm run demo -- <ko|en> [cards|voice|record|build|all]
 *
 * voice calls Google Cloud TTS; record performs a real paid edit on the deployed service.
 * Both are serial production steps. record/build read the measured voice plan.
 */
import { join } from "node:path";
import type { Language } from "../../src/lib/pipeline/schemas";
import { buildDemo } from "./build";
import { renderCards } from "./cards";
import { DEMO_DIR, loadDemoData } from "./demo-data";
import { recordApp } from "./record";
import { buildStoryboard } from "./storyboard";
import { readVoiceManifest, voiceStoryboard } from "./voice";

const STEPS = ["cards", "voice", "record", "build"] as const;
type Step = (typeof STEPS)[number];

async function main(): Promise<void> {
  const lang = process.argv[2] as Language;
  const step = (process.argv[3] ?? "all") as Step | "all";
  if (lang !== "ko" && lang !== "en") throw new Error("usage: make-demo <ko|en> [step]");
  if (step !== "all" && !STEPS.includes(step)) throw new Error(`unknown step ${step}`);
  const run = (s: Step) => step === "all" || step === s;

  const outDir = join(DEMO_DIR, lang);
  const data = await loadDemoData(lang);
  const scenes = buildStoryboard(lang, data);
  const cardsDir = join(outDir, "cards");
  const voiceDir = join(outDir, "voice");
  const recDir = join(outDir, "rec");

  const started = Date.now();
  const cards = run("cards") || run("build") ? await renderCards(lang, data, cardsDir) : null;
  if (run("voice")) await voiceStoryboard(lang, scenes, voiceDir);
  const voiced = run("record") || run("build") ? await readVoiceManifest(voiceDir) : [];
  if (run("record")) await recordApp({ lang, data, scenes, voiced, outDir: recDir });
  if (run("build")) {
    const out = await buildDemo({ lang, data, scenes, voiced, cards: cards!, recDir, outDir });
    console.log(`demo: ${out}`);
  }
  console.log(`demo ${lang} ${step}: ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
