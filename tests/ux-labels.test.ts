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
      time: "5\u00a0min 49\u00a0s",
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
          lang === "en" ? /Korean.*5\u00a0min 49\u00a0s.*\$0\.241/ : /한국어.*5분 49초.*\$0\.241/,
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
   * Gapline's copy states what the default run does; it does not insist nobody touched a result
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
    /a line for each|one line per silence|fix(es)? what|re-checks and re-voices|침묵마다|침묵 하나에 한 문장|문제를 고쳐|문제를 고침|그 문장만 다시 검수/i;

  it("describes a run as the sample's records show it, in either language", () => {
    for (const catalog of [en, ko]) {
      for (const text of strings(catalog)) assert.doesNotMatch(text, OVERCLAIM, text);
    }
  });

  it("keeps one Korean word for voicing and calls Gapline by its Korean name", () => {
    for (const text of strings(ko)) {
      assert.doesNotMatch(text, /녹음|재합성|재검수|목소리로 읽|Gapline/, text);
    }
  });

  it("keeps 자리 for one line's room and calls a stretch without speech a silence", () => {
    assert.equal(ko.line.room, "자리");
    assert.equal(ko.timeline.room, "해설 가능 침묵");
    assert.equal(ko.landing.timelineRows.room, ko.timeline.room);
    assert.equal(ko.stages.gaps, "침묵 찾기");
    for (const text of strings([ko.timeline, ko.landing.timelineRows, ko.stages])) {
      assert.doesNotMatch(text, /자리/, text);
    }
  });

  it("gives one measured duration for a new track wherever a wait is mentioned", () => {
    // 66 live runs (QA rounds 2–3, 2026-10-03): short clips a median 64 s, 60–90 s clips with lines
    // up to 8 min 22 s (BBB). "2–6 minutes" was contradicted by the showcase runs (6:27, 8:06).
    for (const catalog of [en, ko]) {
      for (const text of strings(catalog)) {
        assert.doesNotMatch(text, /few minutes|several minutes|몇 분/, text);
        assert.doesNotMatch(text, /10 minutes|up to 10\b|about 2 minutes|10분|2분쯤/, text);
        assert.doesNotMatch(text, /2–6|2~6분|long or busy/, text);
      }
    }
    const english = [
      en.landing.uploadIntro,
      en.upload.status.budget_busy,
      en.live.elapsed,
      en.live.status.budget_busy,
      en.live.errors.budget_busy,
      en.workspace.liveNote,
    ];
    const korean = [
      ko.landing.uploadIntro,
      ko.upload.status.budget_busy,
      ko.live.elapsed,
      ko.live.status.budget_busy,
      ko.live.errors.budget_busy,
      ko.workspace.liveNote,
    ];
    // Where the wait has a sentence of its own, it says what makes a run long; elsewhere the range.
    const detailed =
      /about 1\u00a0to\u00a03\u00a0minutes for most short clips, and up to about 9\u00a0minutes for a clip with many pauses to describe/;
    const koDetailed = /짧은 영상이면 대개 1~3분, 해설할 쉼이 많은 영상이면 9분 가까이/;
    for (const text of english)
      assert.match(text, /1\u00a0to\u00a09\u00a0minutes|about 1\u00a0to\u00a03\u00a0minutes/, text);
    for (const text of korean) assert.match(text, /1~9분|1~3분/, text);
    for (const text of [en.landing.uploadIntro, en.live.elapsed, en.workspace.liveNote]) {
      assert.match(text, detailed, text);
    }
    for (const text of [ko.landing.uploadIntro, ko.live.elapsed, ko.workspace.liveNote]) {
      assert.match(text, koDetailed, text);
    }
  });

  it("says who holds the allowance in plain words", () => {
    // QA round 3: "Descriptions other visitors started hold the rest of today's allowance" was a
    // word-for-word rendering of the Korean; "checks again what the track now misses" likewise.
    for (const text of strings(en)) {
      assert.doesNotMatch(text, /hold the rest|checks again what|behaviour/, text);
    }
    for (const text of strings(ko)) assert.doesNotMatch(text, /남은 몫을/, text);
    assert.match(en.live.errors.budget_busy, /^Other visitors' runs are using the rest of today's/);
    assert.equal(fill(en.landing.shortest, { s: "2.1 s" }), "shortest silence: 2.1 s");
    assert.equal(fill(ko.landing.shortest, { s: "2.1초" }), "가장 짧은 침묵: 2.1초");
  });

  it("keeps mouse and keyboard instructions apart from the hints a touch screen shows", () => {
    // A phone hides .pointer-hint (tokens.css); the hint around it must still read whole.
    for (const t of [en, ko]) {
      assert.doesNotMatch(t.landing.uploadHint, /Drop|끌어/, t.landing.uploadHint);
      assert.doesNotMatch(t.line.pickHint, /keyboard|Enter|키보드/, t.line.pickHint);
      assert.match(t.upload.dropHint, /Drop|끌어/);
      assert.match(t.line.pickHintKeys, /Enter/);
    }
  });

  it("keeps each English number on the line of its unit", () => {
    // QA round 3 at 390 px: "up to 30 / MB" and "took 6 / min 27 s"; round-4 review at 390 px:
    // "the 65- / second sample", and at 360 px "about 1 to / 3 minutes". A no-break hyphen is no
    // fix: no Pretendard subset has U+2011, so it would render in a fallback font.
    const unit = /(\d|\{\w+\}) (seconds?|minutes?|months?|MB|lines?|silences|stretches)\b/;
    for (const text of strings(en)) {
      assert.doesNotMatch(text, unit, text);
      assert.doesNotMatch(text, /\d-(second|minute)/, text);
      for (const [range] of text.matchAll(/\d\s+to\s+\d/g)) assert.doesNotMatch(range, / /, text);
    }
    assert.match(en.editor.lines.other, /^\{n\} lines$/);
  });

  it("dates the cost of making a film accessible by its sources, not as current", () => {
    const [, cost] = en.landing.why;
    assert.doesNotMatch(cost.text, /still/);
    assert.match(cost.text, /as reported in 2019/);
    assert.doesNotMatch(ko.landing.why[1].text, /지금도/);
    assert.match(ko.landing.why[1].text, /2019년 보도 기준/);
  });

  it("names the landing's seven seconds by the window its player plays (53.8–60.8 s)", () => {
    // page.tsx fills the label with the window's rounded ends, so it cannot drift from the player.
    const window = { from: Math.round(53.8), to: Math.round(60.8) };
    assert.equal(fill(en.landing.seven.label, window), "Tears of Steel, 54–61 s");
    assert.equal(fill(ko.landing.seven.label, window), "Tears of Steel, 54–61초");
  });

  it("names the final check the same way in the stage list and the editor", () => {
    assert.equal(en.stages.verify, "Final check");
    assert.equal(ko.stages.verify, "최종 점검");
    assert.equal(en.stages.fix, "Rewrite flagged lines");
    assert.equal(ko.stages.fix, "점검 결과 반영");
    assert.ok(ko.editor.checked.startsWith(ko.stages.verify), ko.editor.checked);
    assert.ok(en.editor.checked.startsWith(en.stages.verify), en.editor.checked);
  });

  it("links every landing citation, and keeps Hangul out of the English ones", () => {
    for (const catalog of [en, ko]) {
      for (const item of catalog.landing.why) {
        assert.ok(item.sources.length > 0, item.figure);
        for (const source of item.sources) assert.match(source.url, /^https:\/\//, source.label);
      }
      // Each {name} in the footer becomes a link labelled by footerLinks.
      for (const template of [
        catalog.landing.footerFilm,
        catalog.landing.footerGuides,
        catalog.landing.footerSource,
      ]) {
        for (const [, name] of template.matchAll(/\{(\w+)\}/g)) {
          assert.ok(name in catalog.landing.footerLinks, `${name} in ${template}`);
        }
      }
    }
    const english = strings([en.landing.why, en.landing.footerLinks, en.landing.footerGuides]);
    for (const text of english) assert.doesNotMatch(text, /[\uac00-\ud7a3]/, text);
  });

  it("calls the KMCC by its name once in English, wherever the footer cites it", () => {
    assert.match(en.landing.footerLinks.kmcc, /Korea Media and Communications Commission, KMCC/);
  });

  it("says one word for a line the check turned down, and spells out its jargon", () => {
    for (const text of strings([en.landing, en.line, en.metrics, en.stages])) {
      assert.doesNotMatch(text, /sen[dt]s? back|room closed|\bducks\b|Find room|Re-listen\b/, text);
    }
  });

  it("calls one line's room the time it has, in the inspector and in a refused edit", () => {
    assert.equal(en.line.room, "Time available");
    for (const text of strings([en.line, en.editor])) {
      assert.doesNotMatch(text, /^Room$|\bof room\b/, text);
    }
  });

  it("gives the upload button one fixed name while the progress counts up", () => {
    // UploadCard names the focused button with sendingName while sending, so a screen reader does
    // not read each percent; the polite region announces quarters with `uploading`.
    for (const catalog of [en, ko]) {
      assert.doesNotMatch(catalog.upload.sendingName, /\{/, catalog.upload.sendingName);
      assert.match(catalog.upload.uploading, /\{percent\}/);
    }
  });
});
