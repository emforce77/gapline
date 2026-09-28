import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  featuredLine,
  nextStep,
  RejectionStory,
  sentBackByFinalCheck,
} from "../src/components/landing/RejectionStory";
import { en } from "../src/i18n/en";
import { ko } from "../src/i18n/ko";
import type { Cue, CueVersion, Verdict } from "../src/lib/pipeline/schemas";

const pass: Verdict = { cueId: "x", pass: true, violations: [], fix: "" };
const fail = (fix: string): Verdict => ({
  cueId: "x",
  pass: false,
  violations: [{ rule: "viewer_frame", quote: "뜬다", reason: "r" }],
  fix,
});
const cue = (
  id: string,
  start: number,
  versions: CueVersion[],
  status: Cue["status"] = "fits",
): Cue => ({ id, gapId: "g1", start, windowEnd: start + 2.63, versions, status });

/** Text as renderToStaticMarkup writes it: apostrophes are escaped. */
const markup = (text: string) => text.replaceAll("'", "&#x27;");

/**
 * Line 5 of the pinned automatic sample (20260923t065852164-ko-standard-350b05, script.json): the
 * draft passed review and was voiced (2.32 s), the final check failed it, and Gapline's rewrite passed
 * and was voiced in 1.74 s of 2.63 s.
 */
const line5 = cue("L5", 47.2, [
  {
    text: "홀로그램 재생창이 뜬다.",
    by: "write",
    model: "m",
    review: fail("'전체 기억 재생.'과 같이 화면에 나타난 문구를 읽어주는 것으로 수정합니다."),
    voice: { seconds: 2.32, rate: 1 },
  },
  {
    text: "전체 기억 재생.",
    by: "revise",
    model: "m",
    review: pass,
    voice: { seconds: 1.74, rate: 1 },
  },
]);
/** A line the per-line reviewer rejected before it was ever voiced, then passed after a rewrite. */
const reviewed = cue("L2", 16.8, [
  { text: "a", by: "write", model: "m", review: fail("f") },
  { text: "b", by: "revise", model: "m", review: pass, voice: { seconds: 2, rate: 1 } },
]);
/** Line 8 of the sample: three rejections, then dropped unvoiced. */
const line8 = cue(
  "L8",
  63,
  [
    { text: "화면이 암전된다.", by: "write", model: "m", review: fail("f") },
    { text: "암전된다.", by: "revise", model: "m", review: fail("f") },
    { text: "남자가 뇌를 응시한다.", by: "revise", model: "m", review: fail("암전된다.") },
  ],
  "dropped",
);
/** An earlier edited track: Gapline dropped the line, a person typed the version that shipped. */
const rescued = cue("L4", 54.2, [
  { text: "a", by: "write", model: "m", review: fail("f") },
  { text: "b", by: "revise", model: "m", review: fail("f") },
  { text: "c", by: "human", model: "human", review: pass, voice: { seconds: 2.26, rate: 1 } },
]);

describe("landing rejection story", () => {
  it("tells a final-check rejection from a per-line one by whether the version was voiced", () => {
    assert.equal(sentBackByFinalCheck(line5.versions[0]), true);
    assert.equal(sentBackByFinalCheck(reviewed.versions[0]), false);
    assert.equal(sentBackByFinalCheck(line5.versions[1]), false);
  });

  it("features the line the final check sent back, even when an earlier line was rejected", () => {
    assert.equal(featuredLine([line8, line5, reviewed])?.id, "L5");
  });

  it("falls back to the earliest shipped rejected line, whoever rewrote it, then to any rejection", () => {
    assert.equal(featuredLine([rescued, reviewed])?.id, "L2");
    assert.equal(featuredLine([line8])?.id, "L8");
    assert.equal(
      featuredLine([cue("L1", 1, [{ text: "a", by: "write", model: "m", review: pass }])]),
      null,
    );
  });

  it("explains every rejected version that is followed by a rewrite, not only a person's", () => {
    assert.equal(nextStep(line5.versions[0], line5.versions[1]), "final");
    assert.equal(nextStep(reviewed.versions[0], reviewed.versions[1]), "revise");
    assert.equal(nextStep(rescued.versions[1], rescued.versions[2]), "human");
    assert.equal(nextStep(line8.versions[2], undefined), null);
    assert.equal(nextStep(line5.versions[1], undefined), null);
  });

  it("ends Gapline's own rewrite with its measured fit, and says who sent the draft back", () => {
    for (const [t, lang, fitted] of [
      [en, "en", "Voiced in 1.7 s of the 2.6 s available"],
      [ko, "ko", "주어진 2.6초 가운데 1.7초 동안 읽음"],
    ] as const) {
      const html = renderToStaticMarkup(
        createElement(RejectionStory, { cue: line5, language: "ko", lang, t }),
      );
      assert.ok(html.includes(fitted), html);
      assert.ok(html.includes(markup(t.landing.rejection.sentBack)), html);
      assert.ok(html.includes(markup(t.landing.rejection.next.final)), html);
      assert.ok(!html.includes(markup(t.landing.rejection.human)), html);
      assert.equal(
        html.match(/class="story-fit"/g)?.length,
        1,
        "only the shipped version is measured",
      );
    }
  });

  it("keeps the note on a person's words for a version typed by hand", () => {
    const html = renderToStaticMarkup(
      createElement(RejectionStory, { cue: rescued, language: "ko", lang: "en", t: en }),
    );
    assert.ok(html.includes(markup(en.landing.rejection.human)), html);
    assert.ok(html.includes(markup(en.landing.rejection.next.human)), html);
    assert.ok(!html.includes(markup(en.landing.rejection.sentBack)), html);
  });

  it("measures nothing for a dropped line", () => {
    const html = renderToStaticMarkup(
      createElement(RejectionStory, { cue: line8, language: "ko", lang: "en", t: en }),
    );
    assert.ok(!html.includes('class="story-fit"'), html);
  });
});
