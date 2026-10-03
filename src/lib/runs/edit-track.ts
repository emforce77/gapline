/**
 * Rebuilds an edited result from its changed cues. Text edits and removals share this path: every
 * line's WAV (the exact bytes of the parent unless the edit re-voiced that line), the narration stem,
 * the mix, the WebVTT track, and the run's records. What is reviewed differs. A text edit reviews the
 * editor's line, with the rest of the track as context; a removal audits what the whole track now
 * misses.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readCallRecords, summarizeCosts } from "../llm/ledger";
import { watchingVideoFor } from "../media/proxies";
import { buildNarrationTrack, encodeWav, type TrimmedLine } from "../media/narration-track";
import { describedVtt, mixDescribedFilm } from "../media/mix";
import { parseWav } from "../media/wav";
import { MODELS } from "../models";
import type { ClipContext } from "../pipeline/context";
import type { RunFiles, RunSummary, TimedRunEvent } from "../pipeline/events";
import { LINE_SPACING_SECONDS } from "../pipeline/cues";
import { unitBudget } from "../pipeline/length";
import { reviewLines } from "../pipeline/review";
import type { Cue, Gap, SceneMap, SpeechSegment, Verdict } from "../pipeline/schemas";
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
 * Each shipped line may speak until LINE_SPACING_SECONDS before the next shipped line in its gap
 * starts, or until the gap ends: the room placeCues gives a generated line. A removed line gives its
 * room back to the line before it. An editor may place a line closer to the next one (the editor's
 * placement bounds end at the next line's start), and its room then ends where its voice does: the
 * result never reports an editor's own line as overrunning.
 */
export function shipLines(cues: Cue[], gaps: Gap[]): Cue[] {
  const shipped = cues.filter((c) => c.status === "fits");
  for (const c of shipped) {
    const next = shipped
      .filter((p) => p.gapId === c.gapId && p.start > c.start)
      .sort((a, b) => a.start - b.start)[0];
    c.windowEnd = next
      ? Math.max(next.start - LINE_SPACING_SECONDS, c.start + (c.seconds ?? 0))
      : gaps.find((g) => g.id === c.gapId)!.end;
  }
  return shipped;
}

/**
 * Told to the reviewer with an editor's line. The editor chose the words while watching the clip, so
 * they are judged against the picture and the rules, never against the words the line had before or
 * a vaguer word another line used: a reviewer once failed "a small dragon" after "winged creatures"
 * and suggested the old noun back (QA round 3), though the clip's own notes say "the small dragon".
 */
function editorLineNote(cueId: string): string {
  return (
    `${cueId} is an editor's own wording. Judge it against the picture and the soundtrack at that ` +
    "moment and against the rules, as written now; what the line said before is not a standard and " +
    "is not shown. A more specific noun the picture supports for one member of a group an earlier " +
    "line named in general terms ('a small dragon' after 'winged creatures') is consistent naming, " +
    "not a new name. A fix keeps the editor's words and changes only the words that break a rule."
  );
}

/**
 * Reviews an editor's line on its own: the clip in view, every other line in the track as already
 * approved (so naming and who has been introduced are judged as a listener hears them), at the effort
 * of a re-review (about 10 s; the whole-track final check at high effort took 70 s to refuse one
 * line, QA round 3). The whole-track final check is generation's; an edit changes one line.
 */
export async function reviewEditorLine(input: {
  context: ClipContext;
  ledgerFile: string;
  shipped: Cue[];
  cueId: string;
}): Promise<Verdict> {
  const { context, shipped, cueId } = input;
  const edited = shipped.find((c) => c.id === cueId)!;
  const [verdict] = (
    await reviewLines({
      context,
      model: MODELS.flash,
      ledgerFile: input.ledgerFile,
      label: "review:edit-line",
      stage: "rereview",
      wholeScript: false,
      approved: shipped
        .filter((c) => c.id !== cueId)
        .map((c) => ({ id: c.id, start: c.start, text: c.versions.at(-1)!.text })),
      lines: [
        {
          id: edited.id,
          start: edited.start,
          end: edited.start + edited.seconds!,
          text: edited.versions.at(-1)!.text,
          maxUnits: unitBudget(edited.windowEnd - edited.start, context.language),
        },
      ],
      note: editorLineNote(cueId),
    })
  ).verdicts;
  return verdict;
}

/**
 * The parent's final check brought up to date with an edited line's verdict, as the fix stage brings
 * its own check up to date with its rewrites (run.ts): the other lines' verdicts and the moments it
 * found missing still stand, since the edit changed only this line.
 */
export function withLineVerdict(parent: FinalReview | undefined, verdict: Verdict): FinalReview {
  const others = (parent?.verdicts ?? []).filter((v) => v.cueId !== verdict.cueId);
  return { verdicts: [...others, verdict], missing: parent?.missing ?? [] };
}

/**
 * Reviews the edit and writes the result. A text edit reviews the editor's line (reviewEditorLine),
 * which the caller may refuse (`acceptLine` throws to stop the edit before any file is written). A
 * removal audits the whole track for what it now misses; nothing is refused for it.
 */
export async function writeEditedRun(
  run: EditedRun,
  acceptLine: (verdict: Verdict) => void,
): Promise<void> {
  const { base, first, dir, cues, project } = run;
  const shipped = shipLines(cues, base.gaps);
  const clipFile = join(projectDir(run.projectId), "clip.mp4");
  const video = await watchingVideoFor(clipFile);
  const context: ClipContext = {
    language: first.language,
    density: first.density,
    clipSeconds: project.clipSeconds,
    gaps: base.gaps,
    speech: base.speech,
    scene: base.scene,
    videoDataUrl: `data:video/mp4;base64,${video.toString("base64")}`,
  };
  let finalReview: FinalReview;
  if (run.revoiced) {
    const verdict = await reviewEditorLine({
      context,
      ledgerFile: run.ledgerFile,
      shipped,
      cueId: run.revoiced.cueId,
    });
    acceptLine(verdict);
    finalReview = withLineVerdict(base.summary.finalReview, verdict);
  } else {
    finalReview = await reviewLines({
      context,
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
  }

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
  const spans = shipped.map((c) => ({
    start: c.start,
    end: c.start + c.seconds!,
    text: c.versions.at(-1)!.text,
  }));
  await mixDescribedFilm({
    clipFile,
    rawNarrationWav: rawNarration,
    spans,
    language: first.language,
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
    // What the automatic run's fix stage did belongs to that run, not to an edit of it.
    finalFix: undefined,
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
