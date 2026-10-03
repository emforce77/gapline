import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { restated } from "../src/components/workspace/announcements";
import { StageList } from "../src/components/workspace/Inspector";
import { LinePicker } from "../src/components/workspace/LinePicker";
import {
  keyBelongsToControl,
  nextSliderHold,
  seekFromHold,
  seekKeyTarget,
  sliderPosition,
  type SliderHoldEvent,
} from "../src/components/workspace/player-controls";
import { speechTrackLang } from "../src/components/workspace/text-tracks";
import type { UiLang } from "../src/i18n";
import { I18nProvider } from "../src/i18n/client";
import { en, type Dictionary } from "../src/i18n/en";
import { ko } from "../src/i18n/ko";
import { foldRun } from "../src/lib/pipeline/reduce";
import type { Cue, SpeechSegment } from "../src/lib/pipeline/schemas";

function render(children: ReactElement, t: Dictionary = en, lang: UiLang = "en"): string {
  return renderToStaticMarkup(createElement(I18nProvider, { lang, t, children }));
}

function segment(text: string, lang?: string): SpeechSegment {
  return { start: 0, end: 1, speaker: "", text, ...(lang ? { lang } : {}) };
}

describe("the dialogue track's language", () => {
  it("is the one language the recognizer heard, even when the film was set to detect it", () => {
    assert.equal(speechTrackLang([segment("Hi", "en"), segment("Bye", "en")], "auto"), "en");
    // Segments without a tag (older analyses) do not count against the ones that have one.
    assert.equal(speechTrackLang([segment("Hi", "en"), segment("Bye")], "auto"), "en");
  });

  it("stays unknown for a clip heard in two languages, and falls back to the film's setting", () => {
    assert.equal(speechTrackLang([segment("Hi", "en"), segment("안녕", "ko")], "auto"), "");
    assert.equal(speechTrackLang([segment("Hi")], "auto"), "");
    assert.equal(speechTrackLang([segment("Hi")], "en-US"), "en-US");
    assert.equal(speechTrackLang([], "ko-KR"), "ko-KR");
  });
});

describe("the position slider during playback", () => {
  const hold = (...events: SliderHoldEvent[]) => events.reduce(nextSliderHold, null);

  it("holds still once focus reaches it without a pointer press: Tab, or a screen reader", () => {
    // The screen reader path QA measured: Play pressed through the accessibility interface, then
    // focus moved to the slider. Neither sends a pointer event to the slider.
    const held = hold({ type: "focus", byPointer: false, at: 31.5 });
    assert.equal(held, 31.5);
    assert.equal(sliderPosition(39.5, held, true), 31.5);
    // Paused, it says where the film is.
    assert.equal(sliderPosition(39.5, held, false), 39.5);
  });

  it("follows the film after a pointer press, until one of its own keys moves it", () => {
    const clicked = hold({ type: "focus", byPointer: true, at: 5 });
    assert.equal(clicked, null);
    assert.equal(sliderPosition(9, clicked, true), 9);
    assert.equal(hold({ type: "focus", byPointer: true, at: 5 }, { type: "key", at: 9 }), 9);
    // A press on a held slider lets go of it; leaving the slider does too.
    assert.equal(hold({ type: "focus", byPointer: false, at: 5 }, { type: "press" }), null);
    assert.equal(hold({ type: "focus", byPointer: false, at: 5 }, { type: "blur" }), null);
  });

  it("moves its hold to a seek or a resume, and never starts one from them", () => {
    const focused: SliderHoldEvent = { type: "focus", byPointer: false, at: 5 };
    assert.equal(hold(focused, { type: "seek", to: 12 }), 12);
    assert.equal(hold(focused, { type: "resume", at: 20 }), 20);
    assert.equal(hold({ type: "seek", to: 12 }), null);
    assert.equal(hold({ type: "resume", at: 20 }), null);
  });

  it("takes its keys from where the film is, not from a held spot", () => {
    // QA: held at 5 s with the film at 11.31 s, Page Up went to 11.5 s instead of +6.5 s.
    assert.equal(seekKeyTarget("PageUp", false, 11.31, 65), 11.31 + 6.5);
    assert.equal(seekKeyTarget("PageDown", false, 15.33, 65), 15.33 - 6.5);
    assert.equal(seekKeyTarget("ArrowRight", false, 30, 65), 31);
    assert.equal(seekKeyTarget("ArrowLeft", true, 30, 65), 25);
    assert.equal(seekKeyTarget("Home", false, 30, 65), 0);
    assert.equal(seekKeyTarget("End", false, 30, 65), 65);
    assert.equal(seekKeyTarget("k", false, 30, 65), null);
  });

  it("takes a screen reader's step from a held spot as a step from the film", () => {
    assert.equal(seekFromHold(5.1, 5, 11.3, 65), 11.3 + 0.1);
    assert.equal(seekFromHold(4.9, 5, 11.3, 65), 11.3 - 0.1);
    // Either end is where the viewer asked to go.
    assert.equal(seekFromHold(0, 5, 11.3, 65), 0);
    assert.equal(seekFromHold(65, 5, 11.3, 65), 65);
  });
});

describe("the player's keys from a focused control", () => {
  const range = { tag: "INPUT", type: "range", editable: false };
  const button = { tag: "BUTTON", editable: false };

  it("reach the player from the position slider, Space included", () => {
    for (const key of [" ", "k", "d", "e"]) assert.equal(keyBelongsToControl(range, key), false);
  });

  it("stay with typing and with a button's own Space", () => {
    assert.equal(keyBelongsToControl({ tag: "INPUT", type: "text", editable: false }, "k"), true);
    assert.equal(keyBelongsToControl({ tag: "SELECT", editable: false }, "d"), true);
    assert.equal(keyBelongsToControl({ tag: "DIV", editable: true }, "e"), true);
    assert.equal(keyBelongsToControl(button, " "), true);
    assert.equal(keyBelongsToControl(button, "k"), false);
  });
});

describe("a live region text said again", () => {
  it("changes, so a repeat of the same words is still said", () => {
    const first = restated("", "Description off");
    assert.equal(first, "Description off");
    const again = restated(first, "Description off");
    assert.notEqual(again, first);
    assert.equal(again.trim(), "Description off");
    assert.equal(restated(again, "Description off"), "Description off");
    assert.equal(restated(again, "Eyes closed"), "Eyes closed");
  });
});

describe("the stage list", () => {
  const view = foldRun(
    [
      { type: "stage", stage: "hear", state: "started", t: 0 },
      { type: "stage", stage: "hear", state: "done", seconds: 35.2, t: 35.2 },
    ],
    30,
  );

  for (const [t, lang] of [
    [en, "en"],
    [ko, "ko"],
  ] as const) {
    it(`is named by a "${t.stages.title}" heading and says a finished stage is done (${lang})`, () => {
      const html = render(createElement(StageList, { view, trace: null, clockRate: 0 }), t, lang);
      const heading = html.match(/<h2 class="inspector-heading" id="([^"]+)">([^<]+)<\/h2>/);
      assert.ok(heading, html);
      assert.equal(heading[2], t.stages.title);
      assert.match(
        html,
        new RegExp(`<ol class="stages" tabindex="-1" aria-labelledby="${heading[1]}"`),
      );
      assert.ok(html.includes(`<span class="sr-only">${t.stages.doneState}, </span>`), html);
    });
  }
});

describe("the line picker's description", () => {
  const cue = {
    id: "c1",
    start: 1,
    windowEnd: 3,
    status: "fits",
    seconds: 1,
    versions: [{ text: "A door opens.", round: 1 }],
  } as unknown as Cue;

  it("points at a hint the picker renders itself, so it exists whether or not a line is open", () => {
    for (const openCueId of [null, "c1"]) {
      const html = render(
        createElement(LinePicker, {
          cues: [cue],
          lineNumbers: new Map([["c1", 1]]),
          language: "en",
          openCueId,
          disabled: false,
          onOpen: () => {},
        }),
      );
      const describedBy = html.match(/<select[^>]* aria-describedby="([^"]+)"/)?.[1];
      assert.ok(describedBy, html);
      assert.ok(
        html.includes(
          `<p id="${describedBy}" hidden="">${escapeHtml(`${en.line.pickHint} ${en.line.pickHintKeys}`)}</p>`,
        ),
        html,
      );
    }
  });
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
