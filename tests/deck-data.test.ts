import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cost, analysis } from "../scripts/deck/data/analysis";
import { launchCall } from "../scripts/deck/data/recognizers";
import { overlap, stagesOf, unionOf } from "../scripts/deck/data/runs";
import { line, missing, opening, run } from "../scripts/deck/data/sample";
import type { StageEvent } from "../scripts/deck/data/schema";
import { film } from "../scripts/demo/facts";

const stage = (id: string, state: "started" | "done", t: number, seconds?: number): StageEvent => ({
  type: "stage",
  stage: id,
  state,
  t,
  seconds,
});

describe("deck data helpers", () => {
  it("counts overlapping speech once", () => {
    const union = unionOf([
      { start: 3.71, end: 6.47 },
      { start: 2.32, end: 3.96 },
      { start: 6.84, end: 8.92 },
    ]);
    assert.deepEqual(union, [
      { start: 2.32, end: 6.47 },
      { start: 6.84, end: 8.92 },
    ]);
    assert.equal(
      overlap({ start: 2.32, end: 3.96 }, { start: 3.71, end: 6.47 }).toFixed(2),
      "0.25",
    );
  });

  it("lists stages in the order they started and stops on one that never finished", () => {
    const events = [
      stage("hear", "started", 0),
      stage("watch", "started", 0),
      stage("hear", "done", 17.97, 17.963),
      stage("watch", "done", 24.5, 24.497),
    ];
    assert.deepEqual(stagesOf({ stages: events }), [
      { id: "hear", seconds: 17.963 },
      { id: "watch", seconds: 24.497 },
    ]);
    assert.throws(() => stagesOf({ stages: [stage("mix", "started", 1)] }), /never finished/);
  });
});

describe("the pinned sample, as the deck and the film read it", () => {
  it("loads every data module without a guard failing, and both artifacts tell the same line", () => {
    assert.equal(opening.lines.length, run.summary.cuesShipped);
    assert.equal(film.line.cueId, line.cueId);
    assert.equal(film.line.gloss, line.rewrite.gloss);
    assert.equal(film.line.rejectedBy, "final check");
    assert.equal(film.analysis.costUsd, analysis.costUsd);
    assert.equal(cost.allInCostUsd, cost.runCostUsd + cost.analysisCostUsd);
    assert.ok(missing.every((m) => m.gloss.length > 0));
    // The launch call: the before-run spoke over it, the sample has no line there.
    assert.ok(overlap(launchCall.before.gap, launchCall.heard) > 0);
    assert.ok(
      opening.lines.every(
        (l) => overlap({ start: l.start, end: l.start + l.voiced }, launchCall.heard) === 0,
      ),
    );
  });
});
