import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { summarizeCosts, type CallRecord } from "../llm/ledger";
import { describedVtt, mixDescribedFilm } from "../media/mix";
import { buildNarrationTrack, encodeWav, type TrimmedLine } from "../media/narration-track";
import { latest } from "./cues";
import type { RunFiles, RunSummary } from "./events";
import type { Cue, Gap, Language, SpeechSegment, Verdict } from "./schemas";

/** Sample rate of an empty narration track (no line shipped); Chirp 3 HD voices at 24 kHz. */
const EMPTY_TRACK_SAMPLE_RATE = 24000;

export const RUN_FILES: RunFiles = {
  described: "described.mp4",
  narration: "narration.wav",
  vtt: "descriptions.vtt",
  script: "script.json",
};

/** Writes each shipped line's audio, the narration track, the described film and its captions. */
export async function mixRun(input: {
  runDir: string;
  clipFile: string;
  clipSeconds: number;
  shipped: Cue[];
  lines: Map<string, TrimmedLine>;
  language: Language;
}): Promise<void> {
  const { runDir, shipped, lines } = input;
  for (const cue of shipped) {
    const line = lines.get(cue.id)!;
    cue.audioFile = `voice/${cue.id}.wav`;
    await writeFile(join(runDir, cue.audioFile), encodeWav(line.pcm, line.sampleRate));
  }
  const sampleRate =
    shipped.length > 0 ? lines.get(shipped[0].id)!.sampleRate : EMPTY_TRACK_SAMPLE_RATE;
  const rawNarration = join(runDir, "narration.raw.wav");
  await writeFile(
    rawNarration,
    buildNarrationTrack(
      shipped.map((c) => ({ start: c.start, line: lines.get(c.id)! })),
      input.clipSeconds,
      sampleRate,
    ),
  );
  const spans = shipped.map((c) => ({
    start: c.start,
    end: c.start + (c.seconds ?? 0),
    text: latest(c).text,
  }));
  await mixDescribedFilm({
    clipFile: input.clipFile,
    rawNarrationWav: rawNarration,
    spans,
    language: input.language,
    describedMp4: join(runDir, RUN_FILES.described),
    narrationWav: join(runDir, RUN_FILES.narration),
  });
  await writeFile(
    join(runDir, RUN_FILES.vtt),
    describedVtt(
      shipped.map((c) => ({
        start: c.start,
        end: c.start + (c.seconds ?? 0),
        text: latest(c).text,
      })),
    ),
  );
}

function overlapSeconds(spans: { start: number; end: number }[], speech: SpeechSegment[]): number {
  let total = 0;
  for (const a of spans) {
    for (const b of speech)
      total += Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  }
  return total;
}

/** The run's numbers, from the ledger and the final cues. */
export function summarizeRun(input: {
  calls: CallRecord[];
  cues: Cue[];
  shipped: Cue[];
  /** Absent when the run had no silence to write for, so nothing was checked (no badge). */
  finalReview?: NonNullable<RunSummary["finalReview"]>;
  finalFix?: RunSummary["finalFix"];
  analysisReused: NonNullable<RunSummary["analysisReused"]>;
  clipSeconds: number;
  gaps: Gap[];
  room: { gapSeconds: number; little: boolean };
  speech: SpeechSegment[];
  wallSeconds: number;
}): RunSummary {
  const { calls, cues, shipped, finalReview } = input;
  const costByStage: Record<string, number> = {};
  for (const call of calls) {
    const key = call.label.split(":")[0];
    costByStage[key] = (costByStage[key] ?? 0) + call.costUsd;
  }
  const violationsByRule: Record<string, number> = {};
  let rejected = 0;
  for (const cue of cues) {
    const reviews = cue.versions.map((v) => v.review).filter((r): r is Verdict => Boolean(r));
    if (reviews.some((r) => !r.pass)) rejected++;
    for (const r of reviews)
      for (const v of r.violations) violationsByRule[v.rule] = (violationsByRule[v.rule] ?? 0) + 1;
  }
  const spans = shipped.map((c) => ({ start: c.start, end: c.start + (c.seconds ?? 0) }));
  return {
    ...(finalReview
      ? {
          qualityStatus:
            finalReview.missing.length || finalReview.verdicts.some((v) => !v.pass)
              ? ("review_needed" as const)
              : ("model_checked" as const),
          finalReview,
        }
      : {}),
    ...(input.finalFix ? { finalFix: input.finalFix } : {}),
    costStatus: summarizeCosts(calls).costStatus,
    analysisReused: input.analysisReused,
    clipSeconds: input.clipSeconds,
    gapCount: input.gaps.length,
    gapSeconds: input.room.gapSeconds,
    littleRoom: input.room.little,
    cuesWritten: cues.length,
    cuesShipped: shipped.length,
    cuesDropped: cues.filter((c) => c.status === "dropped").length,
    cuesRejected: rejected,
    violationsByRule,
    cuesFitting: shipped.filter((c) => (c.seconds ?? Infinity) <= c.windowEnd - c.start).length,
    narrationSeconds: round(spans.reduce((s, x) => s + x.end - x.start, 0)),
    overlapWithSpeechSeconds: round(overlapSeconds(spans, input.speech)),
    costUsd: calls.reduce((s, c) => s + c.costUsd, 0),
    costByStage,
    wallSeconds: input.wallSeconds,
    llmCalls: calls.filter(
      (c) => !c.model.startsWith("text-to-speech") && !c.model.startsWith("speech-to-text"),
    ).length,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
