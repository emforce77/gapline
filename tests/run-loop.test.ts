import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCallRecord, readCallRecords, type CallRecord } from "../src/lib/llm/ledger";
import { reasoningEffort } from "../src/lib/models";
import type { ClipContext } from "../src/lib/pipeline/context";
import { summarizeRun } from "../src/lib/pipeline/finish-run";
import { reviewerSystem } from "../src/lib/pipeline/review";
import { BufferedAppend } from "../src/lib/store/buffered-append";

describe("reviewer thinking", () => {
  it("is high for the first pass and the final check, medium for a re-review", () => {
    const saved = { ...process.env };
    delete process.env.SCENE_EFFORT_REVIEW;
    delete process.env.SCENE_EFFORT_REREVIEW;
    try {
      assert.equal(reasoningEffort("review"), "high");
      assert.equal(reasoningEffort("rereview"), "medium");
      process.env.SCENE_EFFORT_REREVIEW = "high";
      assert.equal(reasoningEffort("rereview"), "high");
    } finally {
      process.env = saved;
    }
  });
});

describe("the reviewer's length limit", () => {
  const context: ClipContext = {
    language: "en",
    density: "standard",
    clipSeconds: 65,
    speech: [],
    scene: { shots: [], characters: [], sounds: [] },
    gaps: [],
    videoDataUrl: "data:video/mp4;base64,",
  };

  it("is asked of a fix only when the lines carry one (re-reviews)", () => {
    // On the first pass it raised thinking from 28–33k to 35–36k tokens in a replay (2026-10-03).
    assert.doesNotMatch(reviewerSystem(context), /length limit/);
    assert.doesNotMatch(reviewerSystem(context, true), /length limit/);
    assert.match(
      reviewerSystem(context, false, true).replace(/\s+/g, " "),
      /any wording it suggests must pass this same review, and must fit the line's length limit/,
    );
  });
});

describe("BufferedAppend", () => {
  it("writes queued lines together, in order, and at once on flush", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "scene-append-")), "nested", "events.jsonl");
    const log = new BufferedAppend(file);
    log.add("a\n");
    log.add("b\n");
    await assert.rejects(readFile(file, "utf8"), { code: "ENOENT" });
    await log.flush();
    assert.equal(await readFile(file, "utf8"), "a\nb\n");
    assert.ok(log.idle);
    log.add("c\n");
    assert.ok(!log.idle);
    // Written by the timer within a second when nobody flushes.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(await readFile(file, "utf8"), "a\nb\nc\n");
    assert.ok(log.idle);
  });

  it("raises a failed flush and writes its lines, in order, on the next one", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "scene-append-")), "events.jsonl");
    // The file's place is taken by a directory, so appending to it fails.
    await mkdir(file);
    const log = new BufferedAppend(file);
    log.add("x\n");
    await assert.rejects(log.flush(), { code: "EISDIR" });
    log.add("y\n");
    await assert.rejects(log.flush(), { code: "EISDIR" });
    await rm(file, { recursive: true });
    log.add("z\n");
    await log.flush();
    assert.equal(await readFile(file, "utf8"), "x\ny\nz\n");
    assert.ok(log.idle);
  });

  it("keeps the lines of a failed timed write for the next flush", async (t) => {
    const errors = t.mock.method(console, "error", () => {});
    const file = join(await mkdtemp(join(tmpdir(), "scene-append-")), "events.jsonl");
    await mkdir(file);
    const log = new BufferedAppend(file);
    log.add("a\n");
    // The timer's write fails while nobody waits on it: logged, and the line stays queued.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    assert.equal(errors.mock.callCount(), 1);
    assert.ok(!log.idle);
    await rm(file, { recursive: true });
    log.add("b\n");
    await log.flush();
    assert.equal(await readFile(file, "utf8"), "a\nb\n");
  });
});

describe("the ledger", () => {
  const record = (label: string): CallRecord => ({
    at: "2026-10-03T00:00:00.000Z",
    label,
    model: "gemini-3.8-flash",
    provider: "Google Gemini API",
    promptTokens: 1,
    completionTokens: 1,
    costUsd: 0.01,
    latencyMs: 1,
    firstTokenMs: 1,
    finishReason: "STOP",
    ok: true,
  });

  it("returns records still queued in this process", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "scene-ledger-")), "ledger.jsonl");
    await appendCallRecord(file, record("write"));
    await appendCallRecord(file, record("review:1"));
    assert.deepEqual(
      (await readCallRecords(file)).map((r) => r.label),
      ["write", "review:1"],
    );
    await appendCallRecord(file, record("review:final"));
    assert.equal((await readCallRecords(file)).length, 3);
  });

  it("returns a record whose timed write failed, so a run's cost is not lost", async (t) => {
    t.mock.method(console, "error", () => {});
    const file = join(await mkdtemp(join(tmpdir(), "scene-ledger-")), "ledger.jsonl");
    await mkdir(file);
    await appendCallRecord(file, record("write"));
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await rm(file, { recursive: true });
    assert.deepEqual(
      (await readCallRecords(file)).map((r) => r.label),
      ["write"],
    );
  });
});

describe("summarizeRun", () => {
  it("gives a run that checked nothing no final-check status", () => {
    const summary = summarizeRun({
      calls: [],
      cues: [],
      shipped: [],
      analysisReused: { speech: true, scene: true },
      clipSeconds: 45,
      gaps: [],
      room: { gapSeconds: 0, little: true },
      speech: [],
      wallSeconds: 4,
    });
    assert.equal(summary.qualityStatus, undefined);
    assert.equal(summary.finalReview, undefined);
    assert.equal(summary.cuesShipped, 0);
  });

  it("still reads notes when the check left anything listed", () => {
    const summary = summarizeRun({
      calls: [],
      cues: [],
      shipped: [],
      finalReview: { verdicts: [], missing: [{ gapId: "g1", at: 3, what: "A title." }] },
      analysisReused: { speech: true, scene: true },
      clipSeconds: 45,
      gaps: [],
      room: { gapSeconds: 0, little: true },
      speech: [],
      wallSeconds: 4,
    });
    assert.equal(summary.qualityStatus, "review_needed");
  });
});
