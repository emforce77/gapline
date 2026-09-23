import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EditLine } from "../src/components/workspace/CueEditor";
import { LineDetail } from "../src/components/workspace/Inspector";
import { I18nProvider } from "../src/i18n/client";
import type { UiLang } from "../src/i18n";
import { en, type Dictionary } from "../src/i18n/en";
import { ko } from "../src/i18n/ko";
import type { Cue, Gap, Verdict } from "../src/lib/pipeline/schemas";

const pass: Verdict = { cueId: "x", pass: true, violations: [], fix: "" };
const fail: Verdict = {
  cueId: "x",
  pass: false,
  violations: [{ rule: "viewer_frame", quote: "뜬다", reason: "r" }],
  fix: "f",
};

/**
 * Lines 5 to 7 of the pinned automatic sample (20260923t065852164-ko-standard-350b05, script.json).
 * Line 5's draft passed review and was voiced, then the final check sent it back; line 7's trimmed
 * audio is 2.746 s long and its version records 2.75 s.
 */
const G4: Gap = { id: "g4", start: 53.97, end: 60.63 };
const line5: Cue = {
  id: "L5",
  gapId: "g3",
  start: 47.2,
  windowEnd: 49.83,
  versions: [
    {
      text: "홀로그램 재생창이 뜬다.",
      by: "write",
      model: "m",
      review: fail,
      voice: { seconds: 2.32, rate: 1 },
    },
    {
      text: "전체 기억 재생.",
      by: "revise",
      model: "m",
      review: pass,
      voice: { seconds: 1.74, rate: 1 },
    },
  ],
  status: "fits",
  seconds: 1.7440833333333334,
  rate: 1,
  audioFile: "voice/L5.wav",
};
const line6: Cue = {
  id: "L6",
  gapId: "g4",
  start: 54.2,
  windowEnd: 56.8,
  versions: [
    {
      text: "시뮬레이션 준비 완료.",
      by: "write",
      model: "m",
      review: pass,
      voice: { seconds: 2.02, rate: 1 },
    },
  ],
  status: "fits",
  seconds: 2.018,
  rate: 1,
  audioFile: "voice/L6.wav",
};
const line7: Cue = {
  id: "L7",
  gapId: "g4",
  start: 56.8,
  windowEnd: 60.63,
  versions: [
    {
      text: "기계 눈을 한 남자가 뇌를 들여다본다.",
      by: "write",
      model: "m",
      review: pass,
      voice: { seconds: 2.75, rate: 1 },
    },
  ],
  status: "fits",
  seconds: 2.7460416666666667,
  rate: 1,
  audioFile: "voice/L7.wav",
};
/** A line the per-line reviewer rejected before it was ever voiced, then passed after a rewrite. */
const reviewed: Cue = {
  ...line5,
  id: "L2",
  versions: [
    { text: "a", by: "write", model: "m", review: fail },
    { text: "b", by: "revise", model: "m", review: pass, voice: { seconds: 1.74, rate: 1 } },
  ],
};

function render(cue: Cue, t: Dictionary, lang: UiLang, editor: React.ReactNode = null): string {
  const children = createElement(LineDetail, {
    cue,
    lineNumber: 1,
    language: "ko",
    onPlay: () => {},
    editor,
  });
  return renderToStaticMarkup(createElement(I18nProvider, { lang, t, children }));
}

/** The text of the first element with this class, tags stripped. */
function textOf(html: string, className: string): string {
  const start = html.indexOf(`class="${className}`);
  assert.ok(start >= 0, `${className} missing from ${html}`);
  const open = html.indexOf(">", start) + 1;
  const tag = html.lastIndexOf("<", start);
  const name = /^<(\w+)/.exec(html.slice(tag))![1];
  return html.slice(open, html.indexOf(`</${name}>`, open)).replace(/<[^>]+>/g, "");
}

describe("line inspector", () => {
  it("prints the same voiced seconds in the meter as in the version history", () => {
    for (const [t, lang, seconds] of [
      [en, "en", "2.8 s"],
      [ko, "ko", "2.8초"],
    ] as const) {
      const html = render(line7, t, lang);
      assert.ok(textOf(html, "fit-legend").includes(`${t.line.spoken} ${seconds}`), html);
      assert.ok(textOf(html, "voiced").includes(seconds), html);
    }
  });

  it("says the final check sent a line back, and keeps the count for a reviewer's rejection", () => {
    assert.equal(
      textOf(render(line5, en, "en"), "verdict-chip"),
      "↺Sent back by the final check, then passed after a rewrite",
    );
    assert.equal(
      textOf(render(line5, ko, "ko"), "verdict-chip"),
      "↺최종 점검에서 반려된 뒤, 다시 써서 통과",
    );
    assert.equal(
      textOf(render(reviewed, en, "en"), "verdict-chip"),
      "↺Rejected once, then passed after a rewrite",
    );
    assert.equal(textOf(render(reviewed, ko, "ko"), "verdict-chip"), "↺한 번 반려, 다시 써서 통과");
  });

  it("states where an edited line can start in words, not notation", () => {
    for (const [t, lang, range] of [
      [en, "en", "Can start: 56.22–60.63 s"],
      [ko, "ko", "시작 가능: 56.22–60.63초"],
    ] as const) {
      const editor = createElement(EditLine, {
        projectId: "p",
        runId: "r",
        cue: line7,
        cues: [line5, line6, line7],
        gaps: [G4],
        language: "ko",
        onSaved: async () => {},
        onBusy: () => {},
      });
      const html = render(line7, t, lang, editor);
      assert.ok(html.includes(range), html);
      assert.ok(!html.includes("≤"), html);
    }
  });
});
