import type { RelistenReport, RunFiles, RunSummary, StageId, TimedRunEvent } from "./events";
import type { Cue, Density, Gap, Language, MissingItem, SceneMap, SpeechSegment } from "./schemas";

export const STAGES: StageId[] = [
  "hear",
  "relisten",
  "watch",
  "gaps",
  "write",
  "review",
  "voice",
  "verify",
  "fix",
  "mix",
];

export interface StageView {
  /**
   * "stopped": where the run failed or was interrupted (see endRunning). "lost": where the run was
   * when the page could no longer reach the server, so whether it finished is not known. "skipped":
   * a stage the run decided it did not need (see skippedFix).
   */
  state: "waiting" | "running" | "done" | "reused" | "stopped" | "lost" | "skipped";
  startedAt?: number;
  seconds?: number;
}

/** What the workspace shows for one run; built by folding its events, live or replayed. */
export interface RunView {
  runId: string | null;
  language: Language | null;
  density: Density | null;
  clipSeconds: number;
  stages: Record<StageId, StageView>;
  speech: SpeechSegment[];
  scene: SceneMap | null;
  gaps: Gap[];
  cues: Cue[];
  coverage: { round: number; missing: MissingItem[] }[];
  summary: RunSummary | null;
  files: RunFiles | null;
  /**
   * Why the run stopped: the run_failed code (raw text in runs before 2026-09-23), or
   * "interrupted" when it had no final event within the time limit. Null while it goes or once done.
   */
  error: string | null;
  /**
   * run_failed's `retryable`: false when trying again would fail the same way (run_allowance,
   * provider_failed, media_failed). Null when the run did not fail, or its failure did not say.
   */
  retryable: boolean | null;
  /** Set when the clip leaves too little room to describe much (little_room event). */
  littleRoom: { gapSeconds: number; thresholdSeconds: number } | null;
  /** What this run's re-listen of each silence found; null when it did not run one. */
  relisten: RelistenReport | null;
  /** Seconds since the run started, from the latest event. */
  t: number;
  writerChars: number;
}

export function emptyRun(clipSeconds: number): RunView {
  return {
    runId: null,
    language: null,
    density: null,
    clipSeconds,
    stages: Object.fromEntries(STAGES.map((s) => [s, { state: "waiting" }])) as RunView["stages"],
    speech: [],
    scene: null,
    gaps: [],
    cues: [],
    coverage: [],
    summary: null,
    files: null,
    error: null,
    retryable: null,
    littleRoom: null,
    relisten: null,
    t: 0,
    writerChars: 0,
  };
}

function updateCue(view: RunView, id: string, change: (cue: Cue) => Cue): RunView {
  return { ...view, cues: view.cues.map((c) => (c.id === id ? change(c) : c)) };
}

function withLatest(
  cue: Cue,
  change: (v: Cue["versions"][number]) => Cue["versions"][number],
): Cue {
  const versions = [...cue.versions];
  versions[versions.length - 1] = change(versions[versions.length - 1]);
  return { ...cue, versions };
}

export function reduceRun(view: RunView, event: TimedRunEvent): RunView {
  const next = { ...view, t: event.t };
  switch (event.type) {
    case "run_started":
      return {
        ...emptyRun(event.clipSeconds),
        runId: event.runId,
        language: event.language,
        density: event.density,
        t: event.t,
      };
    case "stage": {
      const stage =
        event.state === "started"
          ? { state: "running" as const, startedAt: event.t }
          : { ...next.stages[event.stage], state: "done" as const, seconds: event.seconds };
      return { ...next, stages: skippedFix({ ...next.stages, [event.stage]: stage }) };
    }
    case "speech":
    case "scene": {
      // A run that reuses an earlier analysis emits the data without the stages.
      const keys: StageId[] =
        event.type === "scene" ? ["watch"] : event.relistened ? ["hear", "relisten"] : ["hear"];
      const stages = { ...next.stages };
      for (const key of keys)
        if (stages[key].state === "waiting") stages[key] = { state: "reused" as const };
      return event.type === "speech"
        ? { ...next, stages, speech: event.segments }
        : { ...next, stages, scene: event.map };
    }
    case "relisten":
      return {
        ...next,
        relisten: {
          gapsChecked: event.gapsChecked,
          wordsFound: event.wordsFound,
          blockedSeconds: event.blockedSeconds,
          ...(event.soundless ? { soundless: true as const } : {}),
        },
      };
    case "gaps":
      return { ...next, gaps: event.gaps };
    case "little_room":
      return {
        ...next,
        littleRoom: { gapSeconds: event.gapSeconds, thresholdSeconds: event.thresholdSeconds },
      };
    case "writer_delta":
      return { ...next, writerChars: next.writerChars + event.text.length };
    case "cue_written":
      return {
        ...next,
        cues: [...next.cues.filter((c) => c.id !== event.cue.id), structuredClone(event.cue)].sort(
          (a, b) => a.start - b.start,
        ),
      };
    case "cue_window":
      return updateCue(next, event.cueId, (c) => ({ ...c, windowEnd: event.windowEnd }));
    case "cue_reviewed":
      return updateCue(next, event.cueId, (c) => ({
        ...withLatest(c, (v) => ({ ...v, review: event.verdict })),
        status: event.verdict.pass ? "approved" : c.status,
      }));
    case "cue_revised":
      return updateCue(next, event.cueId, (c) => ({
        ...c,
        status: "pending",
        versions: [...c.versions, { text: event.text, by: event.by, model: event.model }],
      }));
    case "cue_voiced":
      return updateCue(next, event.cueId, (c) => {
        const voiced = withLatest(c, (v) => ({
          ...v,
          voice: { seconds: event.seconds, rate: event.rate },
        }));
        if (!event.fits) return voiced;
        // A line the final check's fix put back to its voiced words was dropped a moment earlier.
        delete voiced.droppedReason;
        return { ...voiced, status: "fits" as const, seconds: event.seconds, rate: event.rate };
      });
    case "cue_dropped":
      return updateCue(next, event.cueId, (c) => ({
        ...c,
        status: "dropped",
        droppedReason: event.reason,
      }));
    case "coverage":
      return {
        ...next,
        coverage: [...next.coverage, { round: event.round, missing: event.missing }],
      };
    case "run_done":
      return {
        ...next,
        cues: structuredClone(event.cues).sort((a, b) => a.start - b.start),
        summary: event.summary,
        files: event.files,
      };
    case "run_failed":
      return {
        ...next,
        stages: endRunning(next.stages, "stopped"),
        error: event.code ?? event.error,
        retryable: event.retryable ?? null,
      };
  }
}

/**
 * The run applies the final check ("fix") only when the check failed a line or found a moment it can
 * still place, and emits nothing for it otherwise. So the mix starting after a finished final check,
 * with "fix" never started, means the check found nothing to fix: the row says so instead of waiting
 * under a ticked "Final check" and then vanishing. Runs from before the final check never finish
 * "verify", so this never marks theirs.
 */
function skippedFix(stages: RunView["stages"]): RunView["stages"] {
  if (stages.mix.state !== "running" && stages.mix.state !== "done") return stages;
  if (stages.verify.state !== "done" || stages.fix.state !== "waiting") return stages;
  return { ...stages, fix: { state: "skipped" } };
}

/**
 * Where a run that ended without finishing (or that the page lost) ends, as `to`, so the stage list
 * never reads as a success beside the alert: the stages still running. When none was (it failed
 * between two stages, e.g. encoding the watching copy after "gaps", or saving the result after
 * "mix"), the stage after the last one it reached, or that last one when none follows; with none
 * reached, the first. The rest keep their state, and a view that already ended stays as it is.
 */
function endRunning(stages: RunView["stages"], to: "stopped" | "lost"): RunView["stages"] {
  const states = STAGES.map((s) => stages[s].state);
  if (states.some((s) => s === "stopped" || s === "lost")) return stages;
  if (states.includes("running"))
    return Object.fromEntries(
      STAGES.map((s) => [
        s,
        stages[s].state === "running" ? { ...stages[s], state: to } : stages[s],
      ]),
    ) as RunView["stages"];
  const reached = states.findLastIndex((s) => s !== "waiting");
  const at = STAGES[Math.min(reached + 1, STAGES.length - 1)];
  return { ...stages, [at]: { ...stages[at], state: to } };
}

export function foldRun(events: TimedRunEvent[], clipSeconds: number): RunView {
  return events.reduce(reduceRun, emptyRun(clipSeconds));
}

/** A run with no final event past the time limit (RunStatus "interrupted"): it stopped where it was. */
export function interruptRun(view: RunView): RunView {
  return { ...view, stages: endRunning(view.stages, "stopped"), error: "interrupted" };
}

/**
 * A followed run the page stopped checking on because the server could not be reached: where it was
 * reads "lost", and no error is set, since the run may still finish on the server. Checking again
 * keeps the lost view, so one that is lost a second time stays as it was.
 */
export function loseRun(view: RunView): RunView {
  return { ...view, stages: endRunning(view.stages, "lost") };
}
