import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { editErrorMessage } from "../src/components/workspace/edit-errors";
import { postEdit } from "../src/components/workspace/edit-request";
import { fill } from "../src/i18n";
import { en, type Dictionary } from "../src/i18n/en";
import { ko } from "../src/i18n/ko";
import { refusedStartMessage } from "../src/lib/client/api-errors";
import { RunRequestError } from "../src/lib/client/run-stream";

const placement = { min: 53.97, max: 57, start: 54.2 };
/** What the edits route sends when a step of the edit failed (edits/route.ts). */
const stopped = (cause: string, retryable?: boolean) => ({
  error: "edit_failed",
  cause,
  message: "The edit stopped. The original result is preserved.",
  ...(retryable === undefined ? {} : { retryable }),
});

describe("an edit that stopped is said as an edit, not a run", () => {
  for (const t of [en, ko]) {
    it(`uses the edit's own sentence for failures the run catalog words as a run (${t === en ? "en" : "ko"})`, () => {
      const lang = t === en ? "en" : "ko";
      assert.equal(
        editErrorMessage(stopped("internal"), placement, t, lang).text,
        t.editor.errors.stopped.internal,
      );
      assert.equal(
        editErrorMessage(stopped("model_output"), placement, t, lang).text,
        t.editor.errors.stopped.model_output,
      );
      // budget_busy and the spending cap come as their own codes, not as edit_failed.
      assert.equal(
        editErrorMessage({ error: "budget_busy" }, placement, t, lang).text,
        t.editor.errors.stopped.budget_busy,
      );
      assert.equal(
        editErrorMessage({ error: "run_allowance" }, placement, t, lang).text,
        t.editor.errors.stopped.run_allowance,
      );
      // A missing project or a missing base result: either way, the result is not here.
      assert.equal(
        editErrorMessage({ error: "not_found" }, placement, t, lang).text,
        t.editor.errors.stopped.not_found,
      );
      // A failure that would repeat has its own sentence, without "try again in a minute".
      assert.equal(
        editErrorMessage(stopped("voice_failed", false), placement, t, lang).text,
        t.editor.errors.stoppedNoRetry.voice_failed,
      );
      assert.equal(
        editErrorMessage(stopped("voice_failed", true), placement, t, lang).text,
        t.editor.errors.stopped.voice_failed,
      );
    });
  }

  it("never says the run stopped or did not start, in either language", () => {
    const sentences = (t: Dictionary) => [
      ...Object.values(t.editor.errors.stopped),
      ...Object.values(t.editor.errors.stoppedNoRetry),
      t.editor.errors.server_busy,
    ];
    for (const text of sentences(en)) assert.doesNotMatch(text, /\brun\b/, text);
    for (const text of sentences(ko)) assert.doesNotMatch(text, /생성이 멈|생성을 시작하지/, text);
  });

  it("keeps the run catalog where its sentence already fits an edit", () => {
    // A busy model, and the daily allowance ("finished results still play"), read right as they are.
    assert.equal(
      editErrorMessage(stopped("provider_busy"), placement, en, "en").text,
      en.live.errors.provider_busy,
    );
    assert.equal(
      editErrorMessage({ error: "visitor_daily" }, placement, en, "en").text,
      en.live.errors.visitor_daily,
    );
  });

  it("gives both catalogs the same keys and placeholders for the edit's sentences", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(Object.keys(ko.editor.errors.stopped), Object.keys(en.editor.errors.stopped));
    assert.deepEqual(
      Object.keys(ko.editor.errors.stoppedNoRetry),
      Object.keys(en.editor.errors.stoppedNoRetry),
    );
    assert.deepEqual(placeholders(ko.editor.unavailable), placeholders(en.editor.unavailable));
    assert.deepEqual(placeholders(en.editor.unavailable), ["reason"]);
    assert.equal(
      fill(en.editor.unavailable, { reason: en.live.status.budget_daily }),
      "Lines cannot be edited or removed right now. Today's live allowance is used up; finished results still play.",
    );
  });
});

describe("an edit answered by the platform instead of the app", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });
  const answer = (status: number, body: string, type: string) => {
    globalThis.fetch = (async () =>
      new Response(body, { status, headers: { "content-type": type } })) as typeof fetch;
    return postEdit("p", "r", { cueId: "c", action: "remove", requestId: "id-1" });
  };

  it("calls Cloud Run's plain-text 429 and a gateway's HTML 502 busy, not a failed edit", async () => {
    assert.deepEqual(await answer(429, "Rate exceeded.", "text/plain"), {
      kind: "busy",
      status: 429,
    });
    assert.deepEqual(await answer(502, "<html>Bad Gateway</html>", "text/html"), {
      kind: "busy",
      status: 502,
    });
  });

  it("still reads the app's own JSON refusal, whatever its status", async () => {
    const body = JSON.stringify({ error: "edit_failed", cause: "internal" });
    assert.deepEqual(await answer(502, body, "application/json"), {
      kind: "refused",
      status: 502,
      body: { error: "edit_failed", cause: "internal" },
    });
    // A non-JSON answer that will not change on retry stays a refusal with no body.
    assert.deepEqual(await answer(400, "Bad Request", "text/plain"), {
      kind: "refused",
      status: 400,
      body: null,
    });
  });
});

describe("a start refused before any stream", () => {
  it("says the run did not start, not that it stopped, for a failure code", () => {
    for (const code of ["internal", "media_failed", "model_output", "provider_failed"]) {
      assert.equal(
        refusedStartMessage(new RunRequestError(500, { error: code }), en, "en"),
        en.live.notStarted,
        code,
      );
    }
  });

  it("keeps the catalog's reason when it explains why none could start", () => {
    assert.equal(
      refusedStartMessage(new RunRequestError(429, { error: "budget_busy" }), en, "en"),
      en.live.errors.budget_busy,
    );
    assert.equal(
      refusedStartMessage(new RunRequestError(503, { error: "provider_busy" }), ko, "ko"),
      ko.live.errors.provider_busy,
    );
    assert.equal(
      refusedStartMessage(new RunRequestError(404, { error: "not_found" }), en, "en"),
      en.live.errors.not_found,
    );
  });
});
