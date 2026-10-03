import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readResult } from "../src/components/workspace/result-notes";
import { en } from "../src/i18n/en";
import { ko } from "../src/i18n/ko";
import type { RunSummary } from "../src/lib/pipeline/events";
import type { Cue, Gap } from "../src/lib/pipeline/schemas";

const cue = (id: string, status: Cue["status"]): Cue => ({
  id,
  gapId: "g1",
  start: 12,
  windowEnd: 15,
  versions: [{ text: `${id} text`, by: "write", model: "m" }],
  status,
  seconds: 2,
});
/** A result with no voiced line left, in a clip with room (the sample's measure). */
const noneVoiced = (cuesDropped: number): RunSummary => ({
  clipSeconds: 65,
  gapCount: 5,
  gapSeconds: 27.5,
  cuesWritten: 3,
  cuesShipped: 0,
  cuesDropped,
  cuesRejected: 0,
  violationsByRule: {},
  cuesFitting: 0,
  narrationSeconds: 0,
  overlapWithSpeechSeconds: 0,
  costUsd: 0.2,
  costByStage: {},
  wallSeconds: 300,
  llmCalls: 10,
});
const ROOMY: Gap[] = [{ id: "g1", start: 10, end: 37.5 }];

describe("why a result has no voiced line", () => {
  it("names the editor when one removed the last voiced line, whatever Gapline dropped before", () => {
    // Only a voiced line can be removed (edit-run.ts), so here the editor took out what was spoken.
    const mixed = readResult(
      noneVoiced(2),
      [cue("L1", "removed"), cue("L2", "dropped"), cue("L3", "dropped")],
      ROOMY,
    );
    assert.equal(mixed.noLines, "removed");
    // The lines Gapline dropped are still listed as written but not voiced.
    assert.deepEqual(
      mixed.unvoiced.map((c) => c.id),
      ["L2", "L3"],
    );
    assert.equal(readResult(noneVoiced(0), [cue("L1", "removed")], ROOMY).noLines, "removed");
  });

  it("blames Gapline only when no editor removed anything", () => {
    const dropped = readResult(noneVoiced(2), [cue("L1", "dropped"), cue("L2", "dropped")], ROOMY);
    assert.equal(dropped.noLines, "dropped");
  });

  it("says so in words true of both cases, in both languages", () => {
    assert.match(en.editor.noLinesWhy.removed, /every voiced line/);
    assert.doesNotMatch(en.editor.noLinesWhy.removed, /too long|broke a rule/);
    assert.match(ko.editor.noLinesWhy.removed, /낭독되던 문장/);
  });
});
