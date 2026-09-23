import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { editErrorMessage } from "../src/components/workspace/edit-errors";
import { en } from "../src/i18n/en";
import { ko } from "../src/i18n/ko";

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
    const reasons = "'문구가 뜬다'는 시청자 시점 표현이다. 문구 자체를 읽는다.";
    assert.deepEqual(editErrorMessage({ error: "review", message: reasons }, placement, en, "en"), {
      text: en.editor.errors.review,
      reviewer: reasons,
    });
  });

  it("says how much room the start leaves when the voiced words run long", () => {
    const body = { error: "too_long", message: "The edited voice takes 3.10 seconds; only 2.80…" };
    assert.equal(
      editErrorMessage(body, placement, en, "en").text,
      "Spoken, these words run past the 2.8 s of room from 54.2 s. Shorten them or start earlier.",
    );
  });

  it("gives the allowed start range with two decimals", () => {
    const { text } = editErrorMessage({ error: "placement" }, placement, en, "en");
    assert.match(text, /between 53\.97 and 57\.00 seconds/);
  });

  it("falls back to the generic sentence for unknown codes and non-JSON answers", () => {
    assert.deepEqual(editErrorMessage({ error: "cue_unavailable" }, placement, en, "en"), {
      text: en.editor.failed,
    });
    assert.deepEqual(editErrorMessage(null, placement, ko, "ko"), { text: ko.editor.failed });
  });
});
