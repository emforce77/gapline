/**
 * Runs only the hearing stage on a stored project's clip, to check the re-listen on real audio:
 * Chirp 3 over the whole clip, then each usable silence recognized again on its own
 * (src/lib/pipeline/relisten.ts). Prints both speech lists, the gaps before and after, and what
 * Speech-to-Text billed. The project, its saved analysis and its runs are not changed.
 * Usage: npm run relisten -- <projectId> [languageCode]   (default: the project's film language)
 * Needs: GCP_PROJECT_ID and Google Cloud credentials (Speech-to-Text is called; about $0.02 a clip).
 * Out:   the printed report; the call ledger in a new temporary directory (its path is printed).
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCallRecords } from "../src/lib/llm/ledger";
import { findGaps } from "../src/lib/pipeline/gaps";
import { chirpRecognizer, hearSpeech } from "../src/lib/pipeline/hear";
import { relistenGaps } from "../src/lib/pipeline/relisten";
import type { Gap, SoundEvent, SpeechSegment } from "../src/lib/pipeline/schemas";
import { projectDir, readAnalysis, readProject } from "../src/lib/store/projects";

const span = (s: { start: number; end: number }) =>
  `${s.start.toFixed(2).padStart(6)}–${s.end.toFixed(2).padStart(6)}`;

function printSpeech(title: string, speech: SpeechSegment[]): void {
  console.log(`\n${title} (${speech.length})`);
  for (const s of speech)
    console.log(`  ${span(s)}  ${s.heard === "relisten" ? "[re-listen] " : ""}${s.text}`);
}

function printGaps(title: string, gaps: Gap[]): void {
  const total = gaps.reduce((s, g) => s + g.end - g.start, 0);
  console.log(`\n${title}: ${gaps.length} gaps, ${total.toFixed(2)} s`);
  for (const g of gaps)
    console.log(`  ${g.id.padEnd(4)}${span(g)}  (${(g.end - g.start).toFixed(2)} s)`);
}

async function main(): Promise<void> {
  const [projectId, languageArg] = process.argv.slice(2);
  if (!projectId) throw new Error("Usage: npm run relisten -- <projectId> [languageCode]");
  const project = await readProject(projectId);
  const languageCode = languageArg ?? project.filmLanguageCode;
  const clipFile = join(projectDir(project.id), "clip.mp4");
  const clipSeconds = project.clipSeconds;
  const ledgerFile = join(await mkdtemp(join(tmpdir(), "scene-relisten-")), "ledger.jsonl");
  console.log(`${project.id}: ${clipSeconds} s, recognizer language ${languageCode}`);

  const firstPass = await hearSpeech({ clipFile, clipSeconds, languageCode, ledgerFile });
  const { speech, report } = await relistenGaps({
    speech: firstPass,
    clipSeconds,
    ledgerFile,
    recognize: chirpRecognizer(clipFile, languageCode),
  });

  // A run also keeps narration off protected sounds; use the saved ones when there are any.
  const saved = await readAnalysis(project.id);
  const sounds: SoundEvent[] = saved?.scene.sounds ?? [];
  printSpeech("First pass", firstPass);
  printSpeech("After re-listen", speech);
  const soundNote = saved ? `speech + ${sounds.length} saved sounds` : "speech only";
  printGaps(`Gaps before (${soundNote})`, findGaps({ speech: firstPass, sounds }, clipSeconds));
  printGaps(`Gaps after (${soundNote})`, findGaps({ speech, sounds }, clipSeconds));
  console.log(`\nRe-listen: ${JSON.stringify(report)}`);

  const calls = await readCallRecords(ledgerFile);
  for (const c of calls)
    console.log(
      `STT ${c.label}: billed ${c.billedSeconds ?? "?"} s, $${c.costUsd.toFixed(4)}` +
        `${c.costKnown === false ? " (charge unknown)" : ""}, ${c.latencyMs} ms`,
    );
  const total = calls.reduce((s, c) => s + c.costUsd, 0);
  console.log(`STT total: $${total.toFixed(4)}  ledger: ${ledgerFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
