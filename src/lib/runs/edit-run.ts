import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readCallRecords, summarizeCosts } from "../llm/ledger";
import { encodeWatchingVideo } from "../media/proxies";
import {
  buildNarrationTrack,
  encodeWav,
  trimSilence,
  type TrimmedLine,
} from "../media/narration-track";
import { describedVtt, mixDescribedFilm } from "../media/mix";
import { parseWav } from "../media/wav";
import { MODELS } from "../models";
import type { RunFiles, RunSummary, TimedRunEvent } from "../pipeline/events";
import { reviewLines } from "../pipeline/review";
import { sameWords } from "../pipeline/run";
import type { Cue, Density, Gap, Language, SceneMap, SpeechSegment } from "../pipeline/schemas";
import { synthesizeLine } from "../pipeline/voice";
import { updateJson } from "../store/atomic";
import { projectDir, readProject, runDir } from "../store/projects";
import { reserveRun, settleRun, withRunBudget, type BudgetScope } from "./budget";

export const EditSchema = z
  .object({
    cueId: z.string().regex(/^L\d+$/),
    text: z.string().trim().min(1).max(2000),
    start: z.number().nonnegative(),
    requestId: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/),
  })
  .strict();
export type EditInput = z.infer<typeof EditSchema>;
export class EditError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
interface Script {
  runId: string;
  cues: Cue[];
  gaps: Gap[];
  scene: SceneMap;
  speech: SpeechSegment[];
  summary: RunSummary;
}
interface RequestState {
  fingerprint: string;
  state: "new" | "running" | "done" | "failed";
  runId?: string;
  error?: string;
}

/** Placement bounds are derived from real audio ends, never from estimated word counts. */
export function editBounds(cues: Cue[], gaps: Gap[], cueId: string): { min: number; max: number } {
  const cue = cues.find((c) => c.id === cueId && (c.status === "fits" || c.status === "dropped"));
  if (!cue) throw new EditError("cue_unavailable", "Only a finished line can be edited.");
  const gap = gaps.find((g) => g.id === cue.gapId);
  if (!gap) throw new EditError("invalid_gap", "The original line has no valid gap.");
  const ordered = cues
    .filter((c) => (c.status === "fits" || c.id === cueId) && c.gapId === gap.id)
    .sort((a, b) => a.start - b.start);
  const index = ordered.findIndex((c) => c.id === cueId);
  const previous = ordered[index - 1];
  const next = ordered[index + 1];
  return {
    min: Math.max(
      gap.start,
      previous ? previous.start + (previous.seconds ?? Infinity) : gap.start,
    ),
    max: Math.min(gap.end, next?.start ?? gap.end),
  };
}

export async function editRun(
  projectId: string,
  baseRunId: string,
  raw: EditInput,
  owner: string,
  scope?: BudgetScope,
): Promise<{ runId: string }> {
  const input = EditSchema.parse(raw);
  const project = await readProject(projectId);
  const baseDir = runDir(projectId, baseRunId);
  let base: Script;
  let first: Extract<TimedRunEvent, { type: "run_started" }>;
  try {
    base = JSON.parse(await readFile(join(baseDir, "script.json"), "utf8"));
    first = JSON.parse((await readFile(join(baseDir, "events.jsonl"), "utf8")).split("\n")[0]);
  } catch {
    throw new EditError("not_found", "Original run not found.", 404);
  }
  if (first.type !== "run_started")
    throw new EditError("legacy", "Generate a new result before editing this older run.");
  const bounds = editBounds(base.cues, base.gaps, input.cueId);
  const cue = base.cues.find((c) => c.id === input.cueId)!;
  if (input.start < bounds.min || input.start >= bounds.max)
    throw new EditError(
      "placement",
      `Start must stay between ${bounds.min.toFixed(3)} and ${bounds.max.toFixed(3)} seconds, in the same gap and order.`,
    );
  if (sameWords(cue.versions.at(-1)!.text, input.text) && cue.start === input.start)
    throw new EditError("unchanged", "Change the words or start time before submitting.");
  const audio = new Map<string, Buffer>();
  for (const c of base.cues.filter((c) => c.status === "fits")) {
    if (c.audioFile !== `voice/${c.id}.wav`)
      throw new EditError(
        "legacy",
        "Generate a new result before editing: this run has no per-line audio.",
      );
    try {
      const bytes = await readFile(join(baseDir, c.audioFile));
      audio.set(c.id, bytes);
      c.seconds = parseWav(bytes).seconds;
    } catch {
      throw new EditError(
        "legacy",
        "Generate a new result before editing: per-line audio is missing.",
      );
    }
  }
  Object.assign(bounds, editBounds(base.cues, base.gaps, input.cueId));
  if (input.start < bounds.min || input.start >= bounds.max)
    throw new EditError("placement", "The start overlaps a neighboring line's measured audio.");
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const requestKey = createHash("sha256")
    .update(`${owner}:${baseRunId}:${input.requestId}`)
    .digest("hex");
  const key = `projects/${projectId}/edits/${requestKey}.json`;
  const claim = await updateJson<RequestState, RequestState>(
    key,
    () => ({ fingerprint, state: "new" }),
    (state) => {
      if (state.fingerprint !== fingerprint)
        throw new EditError(
          "request_conflict",
          "requestId was already used with a different edit.",
          409,
        );
      const previous = { ...state };
      if (state.state === "new") state.state = "running";
      return previous;
    },
  );
  if (claim.state === "done") return { runId: claim.runId! };
  if (claim.state !== "new")
    throw new EditError(
      claim.state,
      claim.error ?? "This edit is already processing. Keep the original result open.",
      409,
    );
  const runId = `edit-${requestKey.slice(0, 40)}`;
  const dir = runDir(projectId, runId);
  const ledgerFile = join(dir, "ledger.jsonl");
  let reservation: Awaited<ReturnType<typeof reserveRun>> | undefined;
  try {
    reservation = await reserveRun(scope);
    await withRunBudget(reservation, async () => {
      const started = Date.now();
      await mkdir(join(dir, "voice"), { recursive: true });
      const cues = structuredClone(base.cues);
      const edited = cues.find((c) => c.id === input.cueId)!;
      edited.status = "fits";
      delete edited.droppedReason;
      edited.audioFile = `voice/${edited.id}.wav`;
      edited.start = input.start;
      edited.windowEnd = bounds.max;
      edited.versions.push({ text: input.text, start: input.start, by: "human", model: "human" });
      const voiced = await synthesizeLine({
        text: input.text,
        language: first.language,
        speakingRate: 1,
        ledgerFile,
        label: "voice:edit",
      });
      const line = trimSilence(voiced.wav);
      if (line.seconds > bounds.max - input.start)
        throw new EditError(
          "too_long",
          `The edited voice takes ${line.seconds.toFixed(2)} seconds; only ${(bounds.max - input.start).toFixed(2)} are available. Shorten it or move it earlier.`,
        );
      edited.seconds = line.seconds;
      edited.rate = 1;
      edited.versions.at(-1)!.voice = { seconds: line.seconds, rate: 1 };
      const shipped = cues.filter((c) => c.status === "fits");
      for (const c of shipped) {
        const peers = shipped
          .filter((p) => p.gapId === c.gapId && p.start > c.start)
          .sort((a, b) => a.start - b.start);
        c.windowEnd = peers[0]?.start ?? base.gaps.find((g) => g.id === c.gapId)!.end;
      }
      const video = await encodeWatchingVideo(join(projectDir(projectId), "clip.mp4"));
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
        ledgerFile,
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
      const verdict = finalReview.verdicts.find((v) => v.cueId === edited.id)!;
      if (!verdict.pass)
        throw new EditError(
          "review",
          verdict.violations.map((v) => v.reason).join(" ") + " " + verdict.fix,
        );
      edited.versions.at(-1)!.review = verdict;
      const lines = new Map<string, TrimmedLine>();
      for (const c of shipped) {
        if (c.id === edited.id) {
          lines.set(c.id, line);
          await writeFile(join(dir, c.audioFile!), encodeWav(line.pcm, line.sampleRate));
        } else {
          const wav = audio.get(c.id)!;
          const info = parseWav(wav);
          if (info.channels !== 1 || info.bitsPerSample !== 16)
            throw new EditError("legacy", "Generate a new result with mono per-line audio.");
          const existing = {
            sampleRate: info.sampleRate,
            seconds: info.seconds,
            pcm: new Int16Array(
              wav.buffer.slice(
                wav.byteOffset + info.dataOffset,
                wav.byteOffset + info.dataOffset + info.dataLength,
              ),
            ),
          };
          // Reuse the exact WAV bytes; do not call TTS for unchanged cues.
          lines.set(c.id, existing);
          // GCS FUSE does not support copy_file_range; write the already-read exact bytes.
          await writeFile(join(dir, c.audioFile!), wav);
        }
      }
      const files: RunFiles = {
        described: "described.mp4",
        narration: "narration.wav",
        vtt: "descriptions.vtt",
        script: "script.json",
      };
      const rawNarration = join(dir, "narration.raw.wav");
      await writeFile(
        rawNarration,
        buildNarrationTrack(
          shipped.map((c) => ({ start: c.start, line: lines.get(c.id)! })),
          project.clipSeconds,
          line.sampleRate,
        ),
      );
      const spans = shipped.map((c) => ({ start: c.start, end: c.start + c.seconds! }));
      await mixDescribedFilm({
        clipFile: join(projectDir(projectId), "clip.mp4"),
        rawNarrationWav: rawNarration,
        spans,
        describedMp4: join(dir, files.described),
        narrationWav: join(dir, files.narration),
      });
      await writeFile(
        join(dir, files.vtt),
        describedVtt(
          shipped.map((c) => ({
            start: c.start,
            end: c.start + c.seconds!,
            text: c.versions.at(-1)!.text,
          })),
        ),
      );
      const calls = await readCallRecords(ledgerFile);
      const summary: RunSummary = {
        ...base.summary,
        ...summarizeCosts(calls),
        parentRunId: baseRunId,
        cuesShipped: shipped.length,
        cuesDropped: cues.filter((c) => c.status === "dropped").length,
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
        wallSeconds: (Date.now() - started) / 1000,
        llmCalls: calls.filter((c) => c.model === MODELS.flash).length,
        costByStage: Object.fromEntries(
          ["voice", "review"].map((s) => [
            s,
            calls.filter((c) => c.label.startsWith(s)).reduce((t, c) => t + c.costUsd, 0),
          ]),
        ),
        analysisReused: { speech: true, scene: true },
      };
      const humanEdits = [
        {
          cueId: input.cueId,
          before: cue.versions.at(-1)!.text,
          after: input.text,
          from: cue.start,
          to: input.start,
          at: new Date().toISOString(),
        },
      ];
      const events: TimedRunEvent[] = [
        { ...first, runId, t: 0 },
        { type: "speech", segments: base.speech, t: 0 },
        { type: "scene", map: base.scene, t: 0 },
        { type: "gaps", gaps: base.gaps, t: 0 },
        { type: "run_done", summary, cues, files, t: summary.wallSeconds },
      ];
      await writeFile(
        join(dir, "events.jsonl"),
        events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      );
      await writeFile(
        join(dir, files.script),
        JSON.stringify(
          { ...base, runId, parentRunId: baseRunId, humanEdits, summary, cues },
          null,
          2,
        ),
      );
    });
    await updateJson<RequestState, void>(
      key,
      () => claim,
      (state) => {
        state.state = "done";
        state.runId = runId;
      },
    );
    return { runId };
  } catch (error) {
    await updateJson<RequestState, void>(
      key,
      () => claim,
      (state) => {
        state.state = "failed";
        state.error = error instanceof Error ? error.message : String(error);
      },
    );
    throw error;
  } finally {
    if (reservation) {
      const cost = await readCallRecords(ledgerFile).then(summarizeCosts, () => null);
      await settleRun(reservation, cost?.costStatus === "known" ? cost.costUsd : null);
    }
  }
}
