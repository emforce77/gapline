import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { uploadTitle } from "../src/lib/store/ingest";

describe("an upload's title from its file name", () => {
  it("falls back when the name shows nothing", () => {
    for (const invisible of [
      "​​", // zero-width spaces
      "‎‏", // left-to-right and right-to-left marks
      "⁠­", // word joiner, soft hyphen
      "ㅤ", // Hangul filler
      "⠀", // blank Braille pattern
      "\uFE0F\uFE0F", // variation selectors (review, 2026-10-04)
      "\u034F", // combining grapheme joiner
      "\u17B4", // Khmer inherent vowel
      "\u180B", // Mongolian free variation selector
      "\u{E0020}\u{E007F}", // tag space, cancel tag
      "﻿",
      "   ",
      "",
    ])
      assert.equal(uploadTitle(`${invisible}.mp4`), "Untitled clip", JSON.stringify(invisible));
  });

  it("drops direction overrides, so a name cannot read reversed", () => {
    assert.equal(uploadTitle("‮gnp.exe‬ clip.mp4"), "gnp.exe clip");
    assert.equal(uploadTitle("⁦Trailer⁩.mov"), "Trailer");
  });

  it("keeps every name that shows something, joiners and right-to-left scripts included", () => {
    const family = "\u{1F468}‍\u{1F469}‍\u{1F467}";
    assert.equal(uploadTitle(`${family}.mp4`), family);
    assert.equal(uploadTitle("\u2764\uFE0F clip.mp4"), "\u2764\uFE0F clip");
    assert.equal(uploadTitle("فيلم قصير.mp4"), "فيلم قصير");
    assert.equal(uploadTitle("a​b.mp4"), "a​b");
    assert.equal(uploadTitle("Sintel trailer.mp4"), "Sintel trailer");
  });
});
