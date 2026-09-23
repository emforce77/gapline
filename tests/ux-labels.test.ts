import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffWords } from "../src/components/workspace/diff";
import { lineNumbers, noteFromScript, runLabel } from "../src/components/workspace/labels";
import { en } from "../src/i18n/en";
import { ko } from "../src/i18n/ko";
import type { Cue } from "../src/lib/pipeline/schemas";
import type { RunListing } from "../src/lib/store/projects";

const cue = (id: string, start: number, versions: Cue["versions"], windowEnd = start + 3): Cue => ({
  id,
  gapId: "g1",
  start,
  windowEnd,
  versions,
  status: "fits",
});
const fail = { cueId: "x", pass: false, violations: [], fix: "" };
const pass = { cueId: "x", pass: true, violations: [], fix: "" };

describe("diffWords", () => {
  it("keeps shared words and marks what was removed and added", () => {
    const parts = diffWords("시뮬레이션 준비 완료라는 문구가 뜬다.", "시뮬레이션 준비 완료.");
    assert.deepEqual(
      parts.map((p) => [p.kind, p.text]),
      [
        ["same", "시뮬레이션 준비 "],
        ["removed", "완료라는 문구가 뜬다."],
        ["added", "완료."],
      ],
    );
  });
  it("reports identical text as one unchanged part", () => {
    assert.deepEqual(diffWords("a b", "a b"), [{ kind: "same", text: "a b" }]);
  });
});

describe("line labels", () => {
  it("numbers lines by time, not by writing order", () => {
    const numbers = lineNumbers([cue("L6", 4.5, []), cue("L1", 11.2, []), cue("L4", 1, [])]);
    assert.deepEqual(
      [...numbers],
      [
        ["L4", 1],
        ["L6", 2],
        ["L1", 3],
      ],
    );
  });

  it("calls an edit a restore when the replaced version never made the track", () => {
    const restored = noteFromScript({
      cues: [
        cue("L1", 1, [{ text: "a", by: "write", model: "m", voice: { seconds: 1, rate: 1 } }]),
        cue("L4", 54.2, [
          { text: "b", by: "write", model: "m", review: fail },
          { text: "c", by: "human", model: "human", review: pass },
        ]),
      ],
      humanEdits: [{ cueId: "L4", after: "c" }],
    });
    assert.deepEqual(restored, { line: 2, kind: "restored" });
    const changed = noteFromScript({
      cues: [
        cue("L3", 45.5, [
          { text: "a", by: "revise", model: "m", review: pass, voice: { seconds: 0.7, rate: 1 } },
          { text: "b", by: "human", model: "human", review: pass },
        ]),
      ],
      humanEdits: [{ cueId: "L3", after: "b" }],
    });
    assert.deepEqual(changed, { line: 1, kind: "changed" });
  });

  it("names a removed line by its place in time, and calls putting it back a restore", () => {
    const voiced = { voice: { seconds: 1.9, rate: 1 }, review: pass };
    const removal = { cueId: "L6", action: "remove" as const };
    const removed = noteFromScript({
      cues: [
        cue("L1", 11.2, [{ text: "a", by: "write", model: "m", ...voiced }]),
        {
          ...cue("L6", 4.5, [
            { text: "b", by: "write", model: "m", ...voiced },
            { text: "b", by: "remove", model: "human" },
          ]),
          status: "removed",
        },
      ],
      humanEdits: [removal],
    });
    assert.deepEqual(removed, { line: 1, kind: "removed" });
    const restored = noteFromScript({
      cues: [
        cue("L6", 4.5, [
          { text: "b", by: "write", model: "m", ...voiced },
          { text: "b", by: "remove", model: "human" },
          { text: "b", by: "human", model: "human", ...voiced },
        ]),
      ],
      humanEdits: [{ cueId: "L6", after: "b" }],
    });
    assert.deepEqual(restored, { line: 1, kind: "restored" });
  });

  it("labels originals by their start date and edits by depth and line", () => {
    const summary = (parentRunId?: string) => ({ parentRunId }) as RunListing["summary"];
    const runs: RunListing[] = [
      {
        runId: "20260921t082401167-en-standard",
        language: "en",
        density: "standard",
        summary: summary(),
        createdAt: "2026-09-22T02:17:00Z",
      },
      {
        runId: "edit-a",
        language: "en",
        density: "standard",
        summary: summary("20260921t082401167-en-standard"),
        createdAt: "2026-09-22T03:00:00Z",
      },
      {
        runId: "edit-b",
        language: "en",
        density: "standard",
        summary: summary("edit-a"),
        createdAt: "2026-09-22T04:00:00Z",
      },
    ];
    assert.equal(runLabel(runs[0], runs, undefined, en, "en", false), "Original · Sep 21");
    assert.equal(runLabel(runs[1], runs, undefined, en, "en", false), "Edit 1");
    assert.equal(
      runLabel(runs[2], runs, { line: 5, kind: "restored" }, en, "en", false),
      "Edit 2 · Line 5 restored",
    );
    assert.equal(
      runLabel(runs[2], runs, { line: 1, kind: "removed" }, en, "en", false),
      "Edit 2 · Line 1 removed",
    );
    assert.equal(
      runLabel(runs[2], runs, { line: 1, kind: "removed" }, ko, "ko", false),
      "수정 2 · 해설 1 삭제",
    );
  });
});
