import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { diffWords } from "../src/components/workspace/diff";
import {
  lineNumbers,
  noteFromScript,
  runLabel,
  sampleRunFigures,
} from "../src/components/workspace/labels";
import { fill } from "../src/i18n";
import { en } from "../src/i18n/en";
import { ko } from "../src/i18n/ko";
import type { RunSummary } from "../src/lib/pipeline/events";
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
    assert.equal(runLabel(runs[0], runs, undefined, en, "en", false), "Generated · Sep 21");
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

describe("sample run figures", () => {
  /** The pinned Korean sample's original run (20260922t051536291-ko-standard-d88b71, script.json). */
  const summary = { wallSeconds: 349.29, costUsd: 0.2407 } as RunSummary;

  it("quotes one run and names its narration language in both interface languages", () => {
    assert.deepEqual(sampleRunFigures("ko", summary, "en"), {
      language: "Korean",
      time: "5 min 49 s",
      cost: "$0.241",
    });
    assert.deepEqual(sampleRunFigures("ko", summary, "ko"), {
      language: "한국어",
      time: "5분 49초",
      cost: "$0.241",
    });
  });

  it("fills every placeholder of the upload card and fresh-workspace hints", () => {
    for (const [t, lang] of [
      [en, "en"],
      [ko, "ko"],
    ] as const) {
      for (const hint of [t.landing.uploadHint, t.workspace.noRunHint]) {
        const text = fill(hint, sampleRunFigures("ko", summary, lang));
        assert.doesNotMatch(text, /\{\w+\}/, text);
        assert.match(
          text,
          lang === "en" ? /Korean.*5 min 49 s.*\$0\.241/ : /한국어.*5분 49초.*\$0\.241/,
        );
      }
    }
  });
});

describe("interface copy", () => {
  /** Every string in a catalog, however deeply nested. */
  const strings = (value: unknown): string[] =>
    typeof value === "string"
      ? [value]
      : typeof value === "object" && value !== null
        ? Object.values(value).flatMap(strings)
        : [];
  /**
   * Scene's copy states what the default run does; it does not insist nobody touched a result
   * (owner decision, 23 Sep 2026). These phrasings kept coming back in drafts.
   */
  const DEFENSIVE =
    /no one (edited|stepped|touched)|in the loop|without an editor|unattended|\b0 edits|no edits|편집자 없이|사람 개입 없이|손대지 않/i;

  it("never insists that no person stepped in, in either language", () => {
    for (const catalog of [en, ko]) {
      for (const text of strings(catalog)) assert.doesNotMatch(text, DEFENSIVE, text);
    }
  });

  /**
   * What a run does, as the sample's records show it (verification panel, 23 Sep 2026): a silence
   * can hold several lines, the final check sends lines back rather than fixing all it finds, and an
   * edit re-voices one line but checks the whole track again.
   */
  const OVERCLAIM =
    /a line for each|one line per silence|fixes what|re-checks and re-voices|침묵마다|침묵 하나에 한 문장|문제를 고쳐|문제를 고침|그 문장만 다시 검수/i;

  it("describes a run as the sample's records show it, in either language", () => {
    for (const catalog of [en, ko]) {
      for (const text of strings(catalog)) assert.doesNotMatch(text, OVERCLAIM, text);
    }
  });

  it("keeps one Korean word for voicing and calls Scene by its Korean name", () => {
    for (const text of strings(ko)) assert.doesNotMatch(text, /녹음|재합성|재검수|Scene/, text);
  });

  it("names the final check the same way in the stage list and the editor", () => {
    assert.equal(en.stages.verify, "Final check");
    assert.equal(ko.stages.verify, "최종 점검");
    assert.ok(ko.editor.checked.startsWith(ko.stages.verify), ko.editor.checked);
    assert.ok(en.editor.checked.startsWith(en.stages.verify), en.editor.checked);
  });
});
