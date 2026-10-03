import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  changesNothing,
  editErrorMessage,
  shownStartRange,
} from "../src/components/workspace/edit-errors";
import { editStep, reviewStep } from "../src/components/workspace/use-elapsed";
import { en } from "../src/i18n/en";
import { ko } from "../src/i18n/ko";
import type { Cue } from "../src/lib/pipeline/schemas";

const placement = { min: 53.97, max: 57, start: 54.2 };
/** What the edits route sends when the model provider failed mid-edit (route.ts). */
const providerFailed = {
  error: "edit_failed",
  cause: "provider_busy",
  message: "The edit stopped. The original result is preserved.",
};

describe("editErrorMessage", () => {
  it("reads edit_failed by its cause, in the viewer's language, never the server's English", () => {
    assert.deepEqual(editErrorMessage(providerFailed, placement, en, "en"), {
      text: en.live.errors.provider_busy,
    });
    assert.deepEqual(editErrorMessage(providerFailed, placement, ko, "ko"), {
      text: ko.live.errors.provider_busy,
    });
  });

  it("names the renewal time for a spent daily allowance", () => {
    const body = {
      error: "budget_daily",
      resetAt: "2026-09-24T00:00:00.000Z",
      message: "Today's live allowance is spent. The original result is preserved.",
    };
    const { text } = editErrorMessage(body, placement, ko, "ko");
    assert.ok(text.startsWith(ko.live.errors.budget_daily), text);
    assert.doesNotMatch(text, /allowance is spent/);
  });

  it("keeps the reviewer's reasons for a rejected edit, apart from the catalog sentence", () => {
    // A server that sends only `message` (its reasons) still gets them shown.
    const reasons = "'문구가 뜬다'는 시청자 시점 표현이다.";
    assert.deepEqual(editErrorMessage({ error: "review", message: reasons }, placement, en, "en"), {
      text: en.editor.errors.review,
      reviewer: reasons,
      field: "text",
    });
  });

  it("says each reason once and keeps the suggested fix apart, for its own label", () => {
    // Two emojis break one rule twice: one violation each, with the same reason.
    const reason = "Emojis are not spoken words.";
    const body = {
      error: "review",
      message: `${reason} ${reason}`,
      reasons: [reason, ` ${reason}`],
      fix: " Describe the rocket without the emojis. ",
    };
    assert.deepEqual(editErrorMessage(body, placement, en, "en"), {
      text: en.editor.errors.review,
      reviewer: reason,
      fix: "Describe the rocket without the emojis.",
      field: "text",
    });
  });

  it("says how much room the start leaves when the voiced words run long", () => {
    const body = { error: "too_long", message: "The edited voice takes 3.10 seconds; only 2.80…" };
    assert.deepEqual(editErrorMessage(body, placement, en, "en"), {
      text: "Spoken, these words run longer than the 2.80 s available from 54.20 s. Shorten them or start earlier.",
      field: "text",
    });
  });

  it("says how long the words ran, how much to cut, and the latest start that fits", () => {
    // Room from 54.2 s: 2.8 s. Spoken 3.06 s: cut 0.26 s; starting by 53.94 s would fit, but the
    // line cannot start before 53.97 s, so no earlier start is offered.
    const near = { error: "too_long", spokenSeconds: 3.06 };
    assert.equal(
      editErrorMessage(near, placement, en, "en").text,
      "Spoken, these words take 3.06 s, but from 54.20 s there are only 2.80 s. Cut about 0.26 s.",
    );
    // From 55.5 s there is 1.5 s; 2.5 s of words fit from 54.5 s, inside the line's range.
    const later = { ...placement, start: 55.5 };
    const body = { error: "too_long", spokenSeconds: 2.5 };
    assert.equal(
      editErrorMessage(body, later, en, "en").text,
      "Spoken, these words take 2.50 s, but from 55.50 s there are only 1.50 s. Cut about 1.00 s, or start at 54.50 s or earlier.",
    );
    assert.equal(
      editErrorMessage(body, later, ko, "ko").text,
      "읽으면 2.50초가 걸리는데, 55.50초부터 남은 자리는 1.50초뿐입니다. 약 1.00초 줄이거나, 54.50초까지 앞당겨 시작해 주세요.",
    );
  });

  it("never prints a length equal to the room, or a latest start that is no earlier", () => {
    // Fix round 3 review: in tenths, 4.01 s of words "took 4.0 s" of a 4.0 s room.
    const room = { min: 10, max: 19, start: 15 };
    assert.equal(
      editErrorMessage({ error: "too_long", spokenSeconds: 4.01 }, room, en, "en").text,
      "Spoken, these words take 4.01 s, but from 15.00 s there are only 4.00 s. Cut about 0.01 s, or start at 14.99 s or earlier.",
    );
    // A raw length rounds up and the room down, so cutting the printed amount always fits.
    assert.match(
      editErrorMessage({ error: "too_long", spokenSeconds: 4.0042 }, room, en, "en").text,
      /take 4\.01 s, .* only 4\.00 s\. Cut about 0\.01 s, or start at 14\.99 s/,
    );
    // From 15.04 s, 3.99 s of words fit from 15.01 s: not "start at 15.0 s", the start already asked.
    assert.match(
      editErrorMessage(
        { error: "too_long", spokenSeconds: 3.99 },
        { ...room, start: 15.04 },
        en,
        "en",
      ).text,
      /from 15\.04 s there are only 3\.96 s\. Cut about 0\.03 s, or start at 15\.01 s or earlier\./,
    );
    // A raw start a hair after the latest that fits still gets an earlier start than it prints.
    assert.match(
      editErrorMessage(
        { error: "too_long", spokenSeconds: 3.957 },
        { ...room, start: 15.0431 },
        en,
        "en",
      ).text,
      /from 15\.04 s .* start at 15\.03 s or earlier\./,
    );
  });

  it("offers an earlier start down to the first start the page prints, not below it", () => {
    // 4.05 s of words fit from 14.95 s at the latest; the line may start from 14.93 s.
    const room = { min: 14.93, max: 19, start: 15 };
    assert.match(
      editErrorMessage({ error: "too_long", spokenSeconds: 4.05 }, room, en, "en").text,
      /Cut about 0\.05 s, or start at 14\.95 s or earlier\.$/,
    );
    // From 14.96 s the earliest start, 14.96 s, is already too late: no earlier start is offered.
    assert.equal(
      editErrorMessage(
        { error: "too_long", spokenSeconds: 4.05 },
        { ...room, min: 14.96 },
        en,
        "en",
      ).text,
      "Spoken, these words take 4.05 s, but from 15.00 s there are only 4.00 s. Cut about 0.05 s.",
    );
  });

  it("never asks to cut a negative amount or to start later when the voiced length fits this room", () => {
    // 2.5 s from 54.2 s fits the 2.8 s this page knows: the server measured another room.
    const body = { error: "too_long", spokenSeconds: 2.5 };
    assert.equal(
      editErrorMessage(body, placement, en, "en").text,
      "Spoken, these words run longer than the 2.80 s available from 54.20 s. Shorten them or start earlier.",
    );
    assert.equal(
      editErrorMessage(body, placement, ko, "ko").text,
      "읽는 시간이 54.20초부터 남은 자리(2.80초)보다 깁니다. 문장을 줄이거나 더 일찍 시작해 주세요.",
    );
  });

  it("gives the allowed starts with two decimals, the end of the room excluded", () => {
    const { text, field } = editErrorMessage({ error: "placement" }, placement, en, "en");
    assert.match(text, /between 53\.97 and 56\.99 seconds/);
    assert.equal(field, "start");
  });

  it("ties each refusal the editor can fix to its field, and none to a service failure", () => {
    const field = (error: string) => editErrorMessage({ error }, placement, en, "en").field;
    assert.equal(field("unchanged"), "both");
    assert.equal(field("legacy"), undefined);
    assert.equal(field("running"), undefined);
    assert.equal(editErrorMessage(providerFailed, placement, en, "en").field, undefined);
  });

  it("falls back to the generic sentence for unknown codes and non-JSON answers", () => {
    assert.deepEqual(editErrorMessage({ error: "cue_unavailable" }, placement, en, "en"), {
      text: en.editor.failed,
    });
    assert.deepEqual(editErrorMessage(null, placement, ko, "ko"), { text: ko.editor.failed });
  });
});

describe("shownStartRange", () => {
  it("prints starts the server takes: from min, rounded up, to before the end of the room", () => {
    assert.deepEqual(shownStartRange(13.5585, 15), { first: 13.56, last: 14.99, end: 15 });
    assert.deepEqual(shownStartRange(56.218, 60.63), { first: 56.22, last: 60.62, end: 60.63 });
    // An edited start leaves a room end with more decimals: never print a later one.
    assert.deepEqual(shownStartRange(2.9249, 9.837), { first: 2.93, last: 9.83, end: 9.83 });
  });
});

describe("changesNothing", () => {
  const line: Cue = {
    id: "L1",
    gapId: "g1",
    start: 4,
    windowEnd: 8,
    status: "fits",
    versions: [{ text: "A rocket rises.", by: "write", model: "m" }],
  };

  it("follows the server: spacing, line breaks and full-width forms are no change", () => {
    for (const text of [
      "A rocket rises.",
      " A  rocket rises. ",
      "A rocket\nrises.",
      "Ａ rocket rises.",
    ])
      assert.equal(changesNothing(line, text, 4), true, JSON.stringify(text));
    assert.equal(changesNothing(line, "A rocket rose.", 4), false);
    assert.equal(changesNothing(line, "A rocket rises.", 4.5), false);
  });

  it("counts putting a removed line back, in its own words, as a change", () => {
    assert.equal(changesNothing({ ...line, status: "removed" }, "A rocket rises.", 4), false);
  });
});

describe("what a running edit says it is doing", () => {
  it("voices first, then reviews, then says the review runs long", () => {
    // A 9.0 s line's voicing refusal came 5.9 s after the click (fix round 3): still "voicing".
    assert.deepEqual([0, 3, 6, 7, 45, 89, 90, 200].map(editStep), [
      "voicing",
      "voicing",
      "voicing",
      "reviewing",
      "reviewing",
      "reviewing",
      "long",
      "long",
    ]);
    // A removal voices nothing.
    assert.deepEqual([0, 89, 90].map(reviewStep), ["reviewing", "reviewing", "long"]);
  });
});
