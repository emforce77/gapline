import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CAPTION_CHARS, captionGroups } from "../scripts/demo/ass";
import type { Scene } from "../scripts/demo/storyboard";
import { MIN_CAPTION_S, planScene, READING_CPS, readingSeconds } from "../scripts/demo/timing";

const lines = (text: string, lang: "en" | "ko") => captionGroups(text, lang).flat();

describe("captionGroups", () => {
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
    const groups = captionGroups(text, "en");
    assert.equal(groups.length, 2);
    assert.match(groups[0].join(" "), /silences,$/);
  });

  it("starts the second line with a conjunction rather than split a phrase", () => {
    assert.deepEqual(
      captionGroups("Scene rewrites it from the reviewer's fix and reviews it again.", "en"),
      [["Scene rewrites it from the reviewer's fix", "and reviews it again."]],
    );
  });

  it("keeps a Korean number with its counter and a bound word with its noun", () => {
    const rule = lines("그리고 가이드라인의 규칙 8가지로 모든 문장을 검수합니다.", "ko");
    assert.ok(rule.some((l) => l.includes("규칙 8가지로")));
    const bound = lines("시작 시각은 같은 침묵 안에서만 옮길 수 있습니다.", "ko");
    assert.ok(bound.some((l) => l.includes("침묵 안에서만")));
    assert.ok([...rule, ...bound].every((l) => l.length <= CAPTION_CHARS.ko));
  });

  it("uses groups given by hand, and refuses ones that do not read as the sentence or fit", () => {
    const text =
      "Speech-to-Text finds the words, Gemini watches, writes and reviews, and Text-to-Speech speaks.";
    const groups = [
      ["Speech-to-Text finds the words,", "Gemini watches, writes and reviews,"],
      ["and Text-to-Speech speaks."],
    ];
    assert.deepEqual(captionGroups(text, "en", groups), groups);
    assert.throws(() => captionGroups(text, "en", [["Speech-to-Text finds the words,"]]));
    assert.throws(() => captionGroups(text, "en", [[text]]));
  });
});

describe("caption timing", () => {
  const scene: Scene = {
    id: "test",
    show: { page: "cloud" },
    parts: [
      {
        caption: {
          en: "Speech-to-Text times the words, Gemini watches, writes and reviews, and Text-to-Speech voices each line.",
          ko: "음성 인식이 단어의 시각을 재고, 제미나이가 보고 쓰고 검수하고, 음성 합성이 문장을 읽습니다.",
        },
      },
      { pause: 1.5 },
      { caption: { en: "Try it.", ko: "해 보세요." } },
    ],
    hold: 1,
  };

  it("gives every caption its reading time, back to back, never under the minimum", () => {
    const plan = planScene(scene, "en");
    const shown = plan.parts.flatMap((p) => p.captions ?? []);
    assert.ok(shown.length >= 3);
    for (const [i, c] of shown.entries()) {
      assert.ok(c.end - c.start >= MIN_CAPTION_S);
      assert.ok(c.lines.join(" ").length / (c.end - c.start) <= READING_CPS.en);
      if (i > 0 && plan.parts[0].captions!.includes(c)) assert.equal(c.start, shown[i - 1].end);
    }
    assert.ok(Math.abs(shown.at(-1)!.end - shown.at(-1)!.start - MIN_CAPTION_S) < 1e-9);
  });

  it("keys the picture to sentence starts and keeps pauses as they are", () => {
    const plan = planScene(scene, "ko");
    const [first, gap, last] = plan.parts;
    assert.deepEqual(plan.captionStarts, [first.start, last.start]);
    assert.equal(gap.seconds, 1.5);
    assert.equal(last.start, gap.start + gap.seconds);
    assert.equal(plan.seconds, last.start + last.seconds + scene.hold);
    assert.equal(readingSeconds(["해 보세요."], "ko"), MIN_CAPTION_S);
  });
});
