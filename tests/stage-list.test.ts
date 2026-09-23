import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listedStages } from "../src/components/workspace/listed-stages";
import type { RunSummary, StageId, TimedRunEvent } from "../src/lib/pipeline/events";
import { emptyRun, foldRun, STAGES } from "../src/lib/pipeline/reduce";

const CLIP_SECONDS = 65;

/** A started and a done event for each stage, from its [stage, start, end] span. */
function staged(spans: [StageId, number, number][]): TimedRunEvent[] {
  return spans.flatMap(([stage, start, end]): TimedRunEvent[] => [
    { type: "stage", stage, state: "started", t: start },
    { type: "stage", stage, state: "done", seconds: end - start, t: end },
  ]);
}

const started: TimedRunEvent = {
  type: "run_started",
  runId: "r1",
  language: "ko",
  density: "standard",
  writerModel: "w",
  reviewerModel: "r",
  clipSeconds: CLIP_SECONDS,
  t: 0,
};
const done: TimedRunEvent = {
  type: "run_done",
  summary: {} as RunSummary,
  files: { described: "d", narration: "n", vtt: "v", script: "s" },
  cues: [],
  t: 349.29,
};

/**
 * The stages of the pinned Korean sample's original run (runs/20260922t051536291-ko-standard-d88b71,
 * events.jsonl), which predates the re-listen and the final check.
 */
const SAVED_TRACE: TimedRunEvent[] = [
  started,
  ...staged([
    ["hear", 0, 20.8],
    ["watch", 0, 20.03],
    ["gaps", 20.8, 20.8],
    ["write", 20.81, 111.78],
    ["review", 111.78, 284.97],
    ["voice", 284.97, 286.52],
    ["mix", 346.52, 349.29],
  ]),
  done,
].sort((a, b) => a.t - b.t);
const WENT_THROUGH: StageId[] = ["hear", "watch", "gaps", "write", "review", "voice", "mix"];

describe("listedStages", () => {
  it("lists every stage during a live run", () => {
    const live = foldRun(SAVED_TRACE.slice(0, 5), CLIP_SECONDS);
    assert.deepEqual(listedStages(live, null), STAGES);
  });

  it("keeps a replay to the stages its saved trace goes through, from first frame to last", () => {
    const trace = foldRun(SAVED_TRACE, CLIP_SECONDS);
    const rows = SAVED_TRACE.map((_, i) =>
      listedStages(foldRun(SAVED_TRACE.slice(0, i), CLIP_SECONDS), trace),
    );
    assert.deepEqual(listedStages(emptyRun(CLIP_SECONDS), trace), WENT_THROUGH);
    for (const row of rows) assert.deepEqual(row, WENT_THROUGH);
    assert.deepEqual(listedStages(trace, trace), WENT_THROUGH);
  });

  it("lists a finished run's stages without a trace, counting reused analysis", () => {
    const reused: TimedRunEvent[] = [
      started,
      { type: "speech", segments: [], relistened: true, t: 0.1 },
      { type: "scene", map: { shots: [], sounds: [] } as never, t: 0.1 },
      ...staged([["write", 0.2, 10]]),
      done,
    ];
    assert.deepEqual(listedStages(foldRun(reused, CLIP_SECONDS), null), [
      "hear",
      "relisten",
      "watch",
      "write",
    ]);
  });
});
