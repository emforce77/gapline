/**
 * Rebuilds an edited result from its changed cues. Text edits and removals share this path, so both
 * audit and measure the finished track the same way: the final audit of what the track still misses,
 * every line's WAV (the exact bytes of the parent unless the edit re-voiced that line), the narration
 * stem, the mix, the WebVTT track, and the run's records.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readCallRecords, summarizeCosts } from "../llm/ledger";
import { encodeWatchingVideo } from "../media/proxies";
import { buildNarrationTrack, encodeWav, type TrimmedLine } from "../media/narration-track";
import { describedVtt, mixDescribedFilm } from "../media/mix";
import { parseWav } from "../media/wav";
import { MODELS } from "../models";
import type { RunFiles, RunSummary, TimedRunEvent } from "../pipeline/events";
import { reviewLines } from "../pipeline/review";
import type { Cue, Gap, SceneMap, SpeechSegment } from "../pipeline/schemas";
import { projectDir, type Project } from "../store/projects";

/** The parent run's script.json, as an edit reads it. */
export interface EditBase {
  runId: string;
  cues: Cue[];
  gaps: Gap[];
  scene: SceneMap;
  speech: SpeechSegment[];
  summary: RunSummary;
}

/** What one edit did, as its result's script.json records it (humanEdits). */
export type HumanEdit =
  | { cueId: string; before: string; after: string; from: number; to: number; at: string }
  | { cueId: string; action: "remove"; before: string; from: number; at: string };

export type FinalReview = NonNullable<RunSummary["finalReview"]>;

export interface EditedRun {
  projectId: string;
  project: Project;
  base: EditBase;
  /** The parent run's id, as the edits route named it. */
  baseRunId: string;
  first: Extract<TimedRunEvent, { type: "run_started" }>;
  runId: string;
  dir: string;
  ledgerFile: string;
  /** Date.now() when the edit started, for wallSeconds. */
  started: number;
  /** The parent's cues after the edit; those with status "fits" are the new track. */
  cues: Cue[];
  /** Exact WAV bytes of every line the parent shipped, by cue id (checked mono 16-bit on read). */
  audio: Map<string, Buffer>;
  /** The line the edit re-voiced, if any. Every other shipped line reuses its parent WAV. */
  revoiced?: { cueId: string; line: TrimmedLine };
  humanEdit: HumanEdit;
}

const FILES: RunFiles = {
  described: "described.mp4",
  narration: "narration.wav",
  vtt: "descriptions.vtt",
  script: "script.json",
};

/** The PCM samples of a mono 16-bit WAV, without copying its header. */
function wavLine(wav: Buffer): TrimmedLine {
  const info = parseWav(wav);
  return {
    sampleRate: info.sampleRate,
    seconds: info.seconds,
    pcm: new Int16Array(
      wav.buffer.slice(
        wav.byteOffset + info.dataOffset,
        wav.byteOffset + info.dataOffset + info.dataLength,
      ),
    ),
  };
}

/**
 * Each shipped line may speak until the next shipped line in its gap starts, or the gap ends. A
 * removed line gives its room back to the line before it.
 */
function shipLines(cues: Cue[], gaps: Gap[]): Cue[] {
  const shipped = cues.filter((c) => c.status === "fits");
  for (const c of shipped) {
    const peers = shipped
      .filter((p) => p.gapId === c.gapId && p.start > c.start)
      .sort((a, b) => a.start - b.start);
    c.windowEnd = peers[0]?.start ?? gaps.find((g) => g.id === c.gapId)!.end;
  }
  return shipped;
}

/**
 * Audits the edited track, lets the caller refuse it (`accept` throws to stop the edit before any
 * file is written), then writes the result.
 */
export async function writeEditedRun(
  run: EditedRun,
  accept: (finalReview: FinalReview) => void,
): Promise<void> {
  const { base, first, dir, cues, project } = run;
  const shipped = shipLines(cues, base.gaps);
  const clipFile = join(projectDir(run.projectId), "clip.mp4");
  const video = await encodeWatchingVideo(clipFile);
  const finalReview = await reviewLines({
    context: {
      language: first.language,
      density: first.density,
      clipSeconds: project.clipSeconds,
      gaps: base.gaps,
      speech: base.speech,
      scene: base.scene,
      videoDataUrl: `data:video/mp4;base64,${video.toString("base64")}`,
    },
    model: MODELS.flash,
    ledgerFile: run.ledgerFile,
    label: "review:edit",
    wholeScript: true,
    finalOutput: true,
    approved: [],
    lines: shipped.map((c) => ({
      id: c.id,
      start: c.start,
      end: c.start + c.seconds!,
      text: c.versions.at(-1)!.text,
    })),
  });
  accept(finalReview);

  const lines = new Map<string, TrimmedLine>();
  for (const c of shipped) {
    if (c.id === run.revoiced?.cueId) {
      lines.set(c.id, run.revoiced.line);
      await writeFile(
        join(dir, c.audioFile!),
        encodeWav(run.revoiced.line.pcm, run.revoiced.line.sampleRate),
      );
      continue;
    }
    // Reuse the exact WAV bytes; do not call TTS for unchanged cues. GCS FUSE does not support
    // copy_file_range, so the already-read bytes are written rather than copied.
    const wav = run.audio.get(c.id)!;
    lines.set(c.id, wavLine(wav));
    await writeFile(join(dir, c.audioFile!), wav);
  }
  // Every parent line comes from one voice at one rate; a removal of the last line still needs it.
  const sampleRate =
    run.revoiced?.line.sampleRate ?? parseWav([...run.audio.values()][0]).sampleRate;
  const rawNarration = join(dir, "narration.raw.wav");
  await writeFile(
    rawNarration,
    buildNarrationTrack(
      shipped.map((c) => ({ start: c.start, line: lines.get(c.id)! })),
      project.clipSeconds,
      sampleRate,
    ),
  );
  const spans = shipped.map((c) => ({ start: c.start, end: c.start + c.seconds! }));
  await mixDescribedFilm({
    clipFile,
    rawNarrationWav: rawNarration,
    spans,
    describedMp4: join(dir, FILES.described),
    narrationWav: join(dir, FILES.narration),
  });
  await writeFile(
    join(dir, FILES.vtt),
    describedVtt(
      shipped.map((c) => ({
        start: c.start,
        end: c.start + c.seconds!,
        text: c.versions.at(-1)!.text,
      })),
    ),
  );

  const calls = await readCallRecords(run.ledgerFile);
  const summary: RunSummary = {
    ...base.summary,
    ...summarizeCosts(calls),
    parentRunId: run.baseRunId,
    cuesShipped: shipped.length,
    cuesDropped: cues.filter((c) => c.status === "dropped").length,
    cuesRemoved: cues.filter((c) => c.status === "removed").length,
    cuesFitting: shipped.filter((c) => c.seconds! <= c.windowEnd - c.start).length,
    overlapWithSpeechSeconds: spans.reduce(
      (total, a) =>
        total +
        base.speech.reduce(
          (sum, b) => sum + Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)),
          0,
        ),
      0,
    ),
    qualityStatus:
      finalReview.missing.length || finalReview.verdicts.some((v) => !v.pass)
        ? "review_needed"
        : "model_checked",
    finalReview,
    narrationSeconds: shipped.reduce((s, c) => s + c.seconds!, 0),
    wallSeconds: (Date.now() - run.started) / 1000,
    llmCalls: calls.filter((c) => c.model === MODELS.flash).length,
    costByStage: Object.fromEntries(
      ["voice", "review"].map((s) => [
        s,
        calls.filter((c) => c.label.startsWith(s)).reduce((t, c) => t + c.costUsd, 0),
      ]),
    ),
    analysisReused: { speech: true, scene: true },
  };
  const events: TimedRunEvent[] = [
    { ...first, runId: run.runId, t: 0 },
    { type: "speech", segments: base.speech, t: 0 },
    { type: "scene", map: base.scene, t: 0 },
    { type: "gaps", gaps: base.gaps, t: 0 },
    { type: "run_done", summary, cues, files: FILES, t: summary.wallSeconds },
  ];
  await writeFile(
    join(dir, "events.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  await writeFile(
    join(dir, FILES.script),
    JSON.stringify(
      {
        ...base,
        runId: run.runId,
        parentRunId: run.baseRunId,
        humanEdits: [run.humanEdit],
        summary,
        cues,
      },
      null,
      2,
    ),
  );
}
