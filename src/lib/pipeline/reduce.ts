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
  state: "waiting" | "running" | "done" | "reused";
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
  error: string | null;
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
      return { ...next, stages: { ...next.stages, [event.stage]: stage } };
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
      return updateCue(next, event.cueId, (c) => ({
        ...withLatest(c, (v) => ({ ...v, voice: { seconds: event.seconds, rate: event.rate } })),
        ...(event.fits
          ? { status: "fits" as const, seconds: event.seconds, rate: event.rate }
          : {}),
      }));
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
      return { ...next, error: event.code ?? event.error };
  }
}

export function foldRun(events: TimedRunEvent[], clipSeconds: number): RunView {
  return events.reduce(reduceRun, emptyRun(clipSeconds));
}
