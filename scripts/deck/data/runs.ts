/**
 * Reading Gapline's run records, and the helpers every data module shares. The one sample run the app,
 * the film and the deck show is pinned in runtime/showcase.json; `pin` is read from there, so moving
 * the pin moves all three.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECTS, SHOWCASE_CLIP, SHOWCASE_PIN } from "../paths";
import {
  CueReviewedEventSchema,
  LedgerEntrySchema,
  parseJsonLine,
  readJsonFile,
  RelistenEventSchema,
  ScriptSchema,
  ShowcasePinSchema,
  StageEventSchema,
  type CueReviewedEvent,
  type LedgerEntry,
  type RelistenEvent,
  type RunCue,
  type Script,
  type StageEvent,
} from "./schema";

/** Timings in the run records are rounded to 0.01 s; sums may drift by one step. */
export const TOLERANCE_S = 0.011;
/** Dollar sums recomputed from a ledger may differ from the recorded ones by float rounding only. */
export const TOLERANCE_USD = 1e-6;
export const round2 = (x: number): number => Math.round(x * 100) / 100;
export const lastVersion = (c: RunCue) => c.versions[c.versions.length - 1];
export const span = (s: { start: number; end: number }) => s.end - s.start;
/** Seconds two spans share (0 when they do not touch). */
export const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

export function cueOf(run: Script, id: string): RunCue {
  const found = run.cues.find((c) => c.id === id);
  if (!found) throw new Error(`cue ${id} missing in ${run.runId}`);
  return found;
}

/** Stops the build when a number the deck computes disagrees with what the run recorded. */
export function agree(label: string, computed: number, recorded: number): void {
  if (Math.abs(computed - recorded) > TOLERANCE_S)
    throw new Error(`${label}: computed ${computed} but the run records ${recorded}`);
}

/**
 * Spans merged where they overlap, in time order. The sample's speech holds the re-listen's segment on
 * top of the first pass's (2.32–3.96 and 3.71–6.47 s), so summing it would count 0.25 s twice.
 */
export function unionOf(spans: readonly { start: number; end: number }[]) {
  const merged: { start: number; end: number }[] = [];
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ start: s.start, end: s.end });
  }
  return merged;
}

// ------------------------------------------------------------------ the pin and the run folders
export const pin = readJsonFile(SHOWCASE_PIN, ShowcasePinSchema);
/**
 * The narration language of the sample the deck and the film describe (English since 2026-09-28: the
 * judges read English). The app pins a result per language; this picks the one the story follows.
 */
export const SAMPLE_LANGUAGE = "en" as const;
if (SHOWCASE_CLIP !== join(PROJECTS, pin.projectId, "clip.mp4"))
  throw new Error(`the pinned project ${pin.projectId} is not the clip paths.ts names`);

export const runDir = (runId: string, projectId: string = pin.projectId): string =>
  join(PROJECTS, projectId, "runs", runId);

export const readRun = (runId: string, projectId: string = pin.projectId): Script =>
  readJsonFile(join(runDir(runId, projectId), "script.json"), ScriptSchema);

/** One run's events.jsonl: the stage timings, every review verdict, and the re-listen's report. */
export function readRunEvents(runId: string, projectId: string = pin.projectId) {
  const path = join(runDir(runId, projectId), "events.jsonl");
  const stages: StageEvent[] = [];
  const reviews: CueReviewedEvent[] = [];
  const relisten: RelistenEvent[] = [];
  readFileSync(path, "utf8")
    .split("\n")
    .forEach((text, i) => {
      if (!text.trim()) return;
      const raw = JSON.parse(text) as { type?: unknown };
      if (raw.type === "stage") stages.push(parseJsonLine(path, i + 1, raw, StageEventSchema));
      if (raw.type === "cue_reviewed")
        reviews.push(parseJsonLine(path, i + 1, raw, CueReviewedEventSchema));
      if (raw.type === "relisten")
        relisten.push(parseJsonLine(path, i + 1, raw, RelistenEventSchema));
    });
  return { stages, reviews, relisten };
}

/** One run's ledger.jsonl: every billed call, in order. */
export function readLedger(runId: string, projectId: string = pin.projectId): LedgerEntry[] {
  const path = join(runDir(runId, projectId), "ledger.jsonl");
  return readFileSync(path, "utf8")
    .split("\n")
    .map((text, i) => ({ text, line: i + 1 }))
    .filter(({ text }) => text.trim())
    .map(({ text, line }) => parseJsonLine(path, line, JSON.parse(text), LedgerEntrySchema));
}

/** When a run started: the time of the first call in its ledger. */
export function runDay(runId: string, projectId: string = pin.projectId): Date {
  const first = readLedger(runId, projectId)[0];
  if (!first) throw new Error(`${runId} has an empty ledger`);
  return new Date(first.at);
}

/** Stages in the order they started, each with the seconds it took. */
export function stagesOf(events: { stages: StageEvent[] }): { id: string; seconds: number }[] {
  return events.stages
    .filter((s) => s.state === "started")
    .map((s) => {
      const done = events.stages.find((d) => d.stage === s.stage && d.state === "done");
      if (done?.seconds === undefined) throw new Error(`stage ${s.stage} never finished`);
      return { id: s.stage, seconds: done.seconds };
    });
}
