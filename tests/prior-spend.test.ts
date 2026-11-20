import assert from "node:assert/strict";
import { it } from "node:test";
import type { CallRecord } from "../src/lib/llm/ledger";
import { priorSpend } from "../src/lib/runs/prior-spend";

const row = (costUsd: number, extra: Partial<CallRecord> = {}): CallRecord => ({
  at: "",
  model: "test",
  label: "review",
  provider: "test",
  ok: true,
  latencyMs: 0,
  promptTokens: 0,
  completionTokens: 0,
  firstTokenMs: null,
  finishReason: "STOP",
  costUsd,
  ...extra,
});
it("reconstructs known and unresolved spend and holds one maximum unlogged call per unclean task", () => {
  const calls = [
    row(0.2),
    row(0.01, { costKnown: false, boundUsd: 0.29 }),
    row(0, { costKnown: true, boundUsd: 1.1 }),
  ];
  assert.equal(priorSpend(calls, 1, 2.5), 1.59);
  assert.equal(priorSpend(calls, 2, 2.5), 2.5);
  assert.equal(priorSpend([row(0, { costKnown: false })], 0, 2.5), 2.5);
  assert.equal(priorSpend([], 0, 2.5), 0);
  assert.throws(() => priorSpend([row(NaN)], 0, 2.5));
});
