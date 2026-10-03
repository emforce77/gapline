import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { EditLine } from "../src/components/workspace/CueEditor";
import { LineDetail, StageList } from "../src/components/workspace/Inspector";
import { I18nProvider } from "../src/i18n/client";
import { fill, type UiLang } from "../src/i18n";
import { en, type Dictionary } from "../src/i18n/en";
import { ko } from "../src/i18n/ko";
import type { RelistenReport } from "../src/lib/pipeline/events";
import { foldRun } from "../src/lib/pipeline/reduce";
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
      [en, "en", "2.8\u00a0s"],
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
      "↺Rejected by the final check, then passed after a rewrite",
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

  const editor = (cue: Cue) =>
    createElement(EditLine, {
      projectId: "p",
      runId: "r",
      cue,
      cues: [line5, line6, line7],
      gaps: [G4],
      language: "ko",
      onSaved: async () => {},
      onBusy: () => {},
    });

  it("states where an edited line can start in words, not notation", () => {
    for (const [t, lang] of [
      [en, "en"],
      [ko, "ko"],
    ] as const) {
      const html = render(line7, t, lang, editor(line7));
      // Line 6 ends at 56.218 s; the silence ends at 60.63 s.
      const range = fill(t.editor.startRange, { first: "56.22", last: "60.62", end: "60.63" });
      assert.ok(html.includes(range), html);
      assert.ok(!html.includes("≤"), html);
    }
  });

  it("lets the start field take what the server takes: from the exact end of the line before, to before the room ends", () => {
    const html = render(line7, en, "en", editor(line7));
    const input = /<input[^>]*name="start"[^>]*>/.exec(html)![0];
    assert.match(input, /min="56.218"/);
    assert.match(input, /max="60.62"/);
    // The range under it describes the field.
    const range = /<p class="label" id="([^"]+)">Start between 56.22 and 60.62 s/.exec(html)!;
    assert.ok(input.includes(`aria-describedby="${range[1]}"`), input);
  });

  it("offers Remove beside the folded editor, not inside it", () => {
    const html = render(line7, en, "en", editor(line7));
    const folded = html.slice(html.indexOf("<details"), html.indexOf("</details>"));
    assert.ok(!folded.includes(en.editor.remove.open), folded);
    assert.ok(html.indexOf(en.editor.remove.open) > html.indexOf("</details>"), html);
  });
});

describe("version history for a screen reader", () => {
  const rewritten: Cue = {
    ...line7,
    versions: [
      { text: "The rocket rises over the skyline.", by: "write", model: "m", review: pass },
      {
        text: "The rocket rises over the city ascends.",
        by: "human",
        model: "human",
        review: pass,
      },
    ],
  };

  it("keeps a real space between struck and added words, and says which is which", () => {
    const html = render(rewritten, en, "en");
    const versions = html.slice(html.indexOf('class="versions"'));
    const second = versions.slice(versions.indexOf("<li", versions.indexOf("<li") + 1));
    const diff = second.slice(second.indexOf('class="version-text"'), second.indexOf("</p>"));
    const read = diff.slice(diff.indexOf(">") + 1).replace(/<[^>]+>/g, "");
    assert.equal(
      read,
      `The rocket rises over the ${en.editor.diff.removed} skyline. ${en.editor.diff.added} city ascends.`,
    );
    // On screen, without the screen reader's words, the space stays.
    const seen = diff
      .replace(/<span class="sr-only"[^>]*>[^<]*<\/span>/g, "")
      .slice(diff.indexOf(">") + 1)
      .replace(/<[^>]+>/g, "");
    assert.match(seen, /skyline\. city ascends\.$/);
  });
});

describe("a reviewer's note in another language", () => {
  const unglossed: Verdict = {
    cueId: "x",
    pass: false,
    violations: [{ rule: "viewer_frame", quote: "보인다", reason: "화면을 매개하는 표현이다." }],
    fix: "보이는 것을 직접 서술한다.",
  };
  const cue: Cue = {
    ...line7,
    versions: [
      { text: "로켓이 보인다.", by: "write", model: "m", review: unglossed },
      { text: "로켓이 솟아오른다.", by: "revise", model: "m", review: pass },
    ],
  };

  /** The page's text, with the apostrophe React escapes put back. */
  const page = (c: Cue, t: Dictionary, lang: UiLang) =>
    render(c, t, lang).replaceAll("&#x27;", "'");

  it("says which language it is in when the English page has no gloss of it", () => {
    const html = page(cue, en, "en");
    const label = fill(en.editor.reviewerLanguage, { language: "Korean" });
    // Once under the reason, once under the fix.
    assert.equal(html.split(label).length - 1, 2, html);
  });

  it("shows the gloss instead when there is one, and nothing on a page in the note's language", () => {
    const glossed: Cue = {
      ...cue,
      versions: [
        { ...cue.versions[0], text: "홀로그램 재생창이 뜬다.", review: fail },
        cue.versions[1],
      ],
    };
    const label = fill(en.editor.reviewerLanguage, { language: "Korean" });
    const withGloss: Verdict = {
      ...unglossed,
      violations: [
        {
          rule: "viewer_frame",
          quote: "뜬다",
          reason: "'뜬다'는 화면이나 시청자 입장에서 요소를 프레임화하는 표현입니다.",
        },
      ],
      fix: "'전체 기억 재생.'과 같이 화면에 나타난 문구를 읽어주는 것으로 수정합니다.",
    };
    const html = render(
      {
        ...glossed,
        versions: [{ ...glossed.versions[0], review: withGloss }, glossed.versions[1]],
      },
      en,
      "en",
    );
    assert.ok(!html.includes(label), html);
    assert.ok(html.includes("frames the element"), html);
    assert.ok(!render(cue, ko, "ko").includes("검수 의견 원문"));
  });
});

describe("the re-check stage's note", () => {
  function note(relisten: RelistenReport, t: Dictionary, lang: UiLang): string {
    const view = foldRun(
      [
        { type: "stage", stage: "relisten", state: "started", t: 1 },
        { type: "relisten", ...relisten, t: 2 },
        { type: "stage", stage: "relisten", state: "done", seconds: 1, t: 2 },
      ],
      30,
    );
    const children = createElement(StageList, { view, trace: null, clockRate: 0 });
    const html = renderToStaticMarkup(createElement(I18nProvider, { lang, t, children }));
    return textOf(html, "stage-detail");
  }

  it("says the clip has no sound instead of counting zero silences", () => {
    const quiet = { gapsChecked: 0, wordsFound: 0, blockedSeconds: 0 };
    assert.equal(note({ ...quiet, soundless: true }, en, "en"), en.stages.relistenSoundless);
    assert.equal(note({ ...quiet, soundless: true }, ko, "ko"), ko.stages.relistenSoundless);
    assert.equal(note(quiet, en, "en"), en.stages.relistenNone);
    assert.equal(
      note({ ...quiet, gapsChecked: 3 }, en, "en"),
      fill(en.stages.relistenQuiet, { gaps: 3 }),
    );
  });
});
