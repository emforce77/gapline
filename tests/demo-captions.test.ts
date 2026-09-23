import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAPTION_CHARS, sentenceCaptions, type CaptionTiming } from "../scripts/demo/ass";

const TIMING: CaptionTiming = { show: 10, hide: 20, speechFrom: 10.4, speechTo: 19.6 };
const lines = (text: string, lang: "en" | "ko") =>
  sentenceCaptions(text, lang, TIMING).flatMap((c) => c.lines);

describe("sentenceCaptions", () => {
  it("keeps a two-word name on one line and never ends a line on an article", () => {
    const text =
      "In September, Korea's Supreme Court confirmed that the three big cinema chains discriminate when films lack audio description and captions.";
    const all = lines(text, "en");
    assert.ok(all.every((l) => l.length <= CAPTION_CHARS.en));
    assert.ok(all.some((l) => l.includes("Supreme Court")));
    assert.ok(all.every((l) => !/ (the|of|and)$/.test(l)));
    assert.equal(all.join(" "), text);
  });

  it("changes caption at a clause end rather than inside a noun phrase", () => {
    const text =
      "In this 65-second clip, that leaves 6 usable silences, the shortest only 2.1 seconds.";
    const captions = sentenceCaptions(text, "en", TIMING);
    assert.equal(captions.length, 2);
    assert.match(captions[0].lines.join(" "), /silences,$/);
  });

  it("keeps a Korean number with its counter and a bound word with its noun", () => {
    const rule = lines("그리고 가이드라인의 규칙 8가지로 모든 문장을 검수합니다.", "ko");
    assert.ok(rule.some((l) => l.includes("규칙 8가지로")));
    const bound = lines("시작 시각은 같은 침묵 안에서만 옮길 수 있습니다.", "ko");
    assert.ok(bound.some((l) => l.includes("침묵 안에서만")));
    assert.ok([...rule, ...bound].every((l) => l.length <= CAPTION_CHARS.ko));
  });

  it("shows from `show` to `hide` with no gap between split captions, changing inside the speech", () => {
    const captions = sentenceCaptions(
      "Speech-to-Text finds the words, Gemini watches, writes and reviews, and Text-to-Speech speaks.",
      "en",
      TIMING,
    );
    assert.ok(captions.length > 1);
    assert.equal(captions[0].start, TIMING.show);
    assert.equal(captions.at(-1)!.end, TIMING.hide);
    for (let i = 1; i < captions.length; i++) {
      assert.equal(captions[i].start, captions[i - 1].end);
      assert.ok(captions[i].start > TIMING.speechFrom && captions[i].start < TIMING.speechTo);
    }
  });
});

describe("sentenceCaptions with given groups", () => {
  const text =
    "Speech-to-Text finds the words, Gemini watches, writes and reviews, and Text-to-Speech speaks.";
  const groups = [
    ["Speech-to-Text finds the words,", "Gemini watches, writes and reviews,"],
    ["and Text-to-Speech speaks."],
  ];

  it("uses the groups as captions", () => {
    const captions = sentenceCaptions(text, "en", TIMING, groups);
    assert.deepEqual(
      captions.map((c) => c.lines),
      groups,
    );
  });

  it("refuses groups that do not read as the sentence or pass the line limit", () => {
    assert.throws(() =>
      sentenceCaptions(text, "en", TIMING, [["Speech-to-Text finds the words,"]]),
    );
    assert.throws(() => sentenceCaptions(text, "en", TIMING, [[text]]));
  });
});
