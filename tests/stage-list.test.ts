import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listedStages } from "../src/components/workspace/listed-stages";
import type { RunSummary, StageId, TimedRunEvent } from "../src/lib/pipeline/events";
import { emptyRun, foldRun, interruptRun, loseRun, STAGES } from "../src/lib/pipeline/reduce";

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

describe("a run that stops before its result", () => {
  // Hear and watch run side by side; the run fails 9.4 s into watch, after hear and re-listen.
  const failing: TimedRunEvent[] = [
    started,
    { type: "stage", stage: "hear", state: "started", t: 0 },
    { type: "stage", stage: "watch", state: "started", t: 0 },
    { type: "stage", stage: "hear", state: "done", seconds: 4.8, t: 4.8 },
    { type: "stage", stage: "relisten", state: "started", t: 4.8 },
    { type: "stage", stage: "relisten", state: "done", seconds: 4, t: 8.8 },
  ];
  const failed: TimedRunEvent = {
    type: "run_failed",
    code: "provider_failed",
    error: "provider_failed",
    retryable: false,
    t: 9.4,
  };

  it("marks the stage that was running as stopped, and lists only the stages it reached", () => {
    const view = foldRun([...failing, failed], CLIP_SECONDS);
    assert.equal(view.error, "provider_failed");
    assert.equal(view.stages.watch.state, "stopped");
    assert.equal(view.stages.hear.state, "done");
    assert.ok(STAGES.every((s) => view.stages[s].state !== "running"));
    assert.deepEqual(listedStages(view, null), ["hear", "relisten", "watch"]);
  });

  it("stops every stage running side by side when the failure comes", () => {
    const early: TimedRunEvent = { ...failed, t: 2 };
    const view = foldRun([...failing.slice(0, 3), early], CLIP_SECONDS);
    assert.equal(view.stages.hear.state, "stopped");
    assert.equal(view.stages.watch.state, "stopped");
    assert.deepEqual(listedStages(view, null), ["hear", "watch"]);
  });

  it("stops an interrupted run where it was, with no final event to fold", () => {
    const going = foldRun(failing, CLIP_SECONDS);
    assert.equal(going.stages.watch.state, "running");
    assert.deepEqual(listedStages(going, null), STAGES);
    const view = interruptRun(going);
    assert.equal(view.error, "interrupted");
    assert.equal(view.stages.watch.state, "stopped");
    assert.equal(view.stages.relisten.state, "done");
    assert.deepEqual(listedStages(view, null), ["hear", "relisten", "watch"]);
  });

  it("keeps whether the failure would repeat, so the page offers a retry only when it would not", () => {
    const fold = (end: TimedRunEvent) => foldRun([...failing, end], CLIP_SECONDS).retryable;
    assert.equal(fold(failed), false);
    assert.equal(fold({ ...failed, code: "run_allowance", error: "run_allowance" }), false);
    assert.equal(
      fold({ ...failed, code: "model_output", error: "model_output", retryable: true }),
      true,
    );
    // describeFailure sends no flag for "internal"; runs before 2026-09-23 sent raw text only.
    assert.equal(fold({ type: "run_failed", code: "internal", error: "internal", t: 9.4 }), null);
    assert.equal(interruptRun(foldRun(failing, CLIP_SECONDS)).retryable, null);
    assert.equal(foldRun(failing, CLIP_SECONDS).retryable, null);
  });

  it("shows a run that stopped before any stage at the first stage, not as an empty list", () => {
    const early: TimedRunEvent = { ...failed, code: "internal", error: "internal", t: 0.4 };
    const view = foldRun([started, early], CLIP_SECONDS);
    assert.equal(view.stages.hear.state, "stopped");
    assert.deepEqual(listedStages(view, null), ["hear"]);
    const interrupted = interruptRun(foldRun([started], CLIP_SECONDS));
    assert.equal(interrupted.stages.hear.state, "stopped");
    assert.deepEqual(listedStages(interrupted, null), ["hear"]);
  });

  it("leaves reused analysis as it was and stops at the next stage when none of its own began", () => {
    const reused: TimedRunEvent[] = [
      started,
      { type: "speech", segments: [], relistened: false, t: 0.1 },
      { type: "scene", map: { shots: [], sounds: [] } as never, t: 0.1 },
      { ...failed, t: 0.2 },
    ];
    const view = foldRun(reused, CLIP_SECONDS);
    assert.equal(view.stages.hear.state, "reused");
    assert.equal(view.stages.watch.state, "reused");
    assert.equal(view.stages.gaps.state, "stopped");
    assert.deepEqual(listedStages(view, null), ["hear", "watch", "gaps"]);
  });

  // Reused analysis (the sample's usual case), then "gaps"; the watching copy is awaited after it.
  const pastGaps: TimedRunEvent[] = [
    started,
    { type: "speech", segments: [], relistened: true, t: 0.1 },
    { type: "scene", map: { shots: [], sounds: [] } as never, t: 0.1 },
    ...staged([["gaps", 0.1, 0.1]]),
  ];

  it("stops at the next stage when it fails between two, not with every row ticked", () => {
    const view = foldRun([...pastGaps, { ...failed, code: "media_failed", t: 2.3 }], CLIP_SECONDS);
    assert.equal(view.stages.gaps.state, "done");
    assert.equal(view.stages.write.state, "stopped");
    assert.deepEqual(listedStages(view, null), ["hear", "relisten", "watch", "gaps", "write"]);
    const interrupted = interruptRun(foldRun(pastGaps, CLIP_SECONDS));
    assert.equal(interrupted.stages.write.state, "stopped");
  });

  it("stops at the last stage when it fails after it, while saving the result", () => {
    const all = staged(STAGES.map((stage, i): [StageId, number, number] => [stage, i, i + 1]));
    const view = foldRun(
      [started, ...all, { ...failed, code: "internal", error: "internal", t: 10.2 }],
      CLIP_SECONDS,
    );
    assert.equal(view.stages.mix.state, "stopped");
    assert.equal(view.stages.mix.seconds, 1);
    assert.ok(STAGES.slice(0, -1).every((s) => view.stages[s].state === "done"));
    assert.deepEqual(listedStages(view, null), STAGES);
    // With nothing for the final check to fix, "fix" never runs and stays unlisted.
    const skipped = all.filter((e) => e.type !== "stage" || e.stage !== "fix");
    const unfixed = foldRun([started, ...skipped, { ...failed, t: 10.2 }], CLIP_SECONDS);
    assert.equal(unfixed.stages.mix.state, "stopped");
    assert.deepEqual(
      listedStages(unfixed, null),
      STAGES.filter((s) => s !== "fix"),
    );
  });

  describe("when the page loses touch with it", () => {
    it("marks what was running as lost, without calling the run failed", () => {
      const view = loseRun(foldRun(failing, CLIP_SECONDS));
      assert.equal(view.stages.watch.state, "lost");
      assert.equal(view.stages.relisten.state, "done");
      assert.ok(STAGES.every((s) => view.stages[s].state !== "running"));
      assert.equal(view.error, null);
      assert.equal(view.retryable, null);
      assert.deepEqual(listedStages(view, null), ["hear", "relisten", "watch"]);
    });

    it("marks the first stage when it lost the run before any stage started", () => {
      const view = loseRun(foldRun([started], CLIP_SECONDS));
      assert.equal(view.stages.hear.state, "lost");
      assert.deepEqual(listedStages(view, null), ["hear"]);
    });

    it("marks the next stage when it lost the run between two", () => {
      const view = loseRun(foldRun(pastGaps, CLIP_SECONDS));
      assert.equal(view.stages.write.state, "lost");
      assert.deepEqual(listedStages(view, null), ["hear", "relisten", "watch", "gaps", "write"]);
    });

    it("keeps where it lost the run when checking again cannot reach the server either", () => {
      const lost = loseRun(foldRun(failing, CLIP_SECONDS));
      const again = loseRun(lost);
      assert.deepEqual(again.stages, lost.stages);
      assert.equal(again.stages.hear.state, "done");
      assert.equal(again.stages.watch.state, "lost");
      assert.deepEqual(listedStages(again, null), ["hear", "relisten", "watch"]);
    });
  });
});
