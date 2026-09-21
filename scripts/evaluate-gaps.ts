/**
 * Scores gap detection on a sample against its subtitles (independent human timing).
 * In:  <DATA_DIR>/projects/<id>/analysis.json (recognized speech) and runtime/samples/<id>/dialogue-truth.json
 * Out: runtime/measure/gaps-<id>.json and a printed summary.
 * Subtitles mark dialogue only to about ±0.3 s and omit untranslated radio chatter, so read precision as a
 * lower bound; the safety number is how much subtitled dialogue falls inside a narration gap.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { scoreDialogue } from "../src/lib/eval/dialogue-score";
import { findGaps } from "../src/lib/pipeline/gaps";
import { readAnalysis, readProject } from "../src/lib/store/projects";
import type { SubtitleCue } from "../src/lib/srt";

async function main(): Promise<void> {
  const id = process.argv[2] ?? "tos-opening";
  const project = await readProject(id);
  const analysis = await readAnalysis(id);
  if (!analysis) throw new Error(`No analysis for ${id}; run the pipeline once first`);
  const truth = JSON.parse(
    await readFile(join("runtime/samples", id, "dialogue-truth.json"), "utf8"),
  ) as {
    cues: SubtitleCue[];
  };
  const gaps = findGaps(
    { speech: analysis.speech, sounds: analysis.scene.sounds },
    project.clipSeconds,
  );
  const truthGaps = findGaps(
    { speech: truth.cues.map((c) => ({ ...c, speaker: "" })), sounds: [] },
    project.clipSeconds,
  );
  const score = scoreDialogue(analysis.speech, truth.cues, gaps, project.clipSeconds);
  const result = { id, measuredAt: new Date().toISOString(), score, gaps, truthGaps };
  await mkdir("runtime/measure", { recursive: true });
  await writeFile(`runtime/measure/gaps-${id}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(score, null, 2));
  console.log("ours :", gaps.map((g) => `${g.start}-${g.end}`).join("  "));
  console.log("truth:", truthGaps.map((g) => `${g.start}-${g.end}`).join("  "));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
