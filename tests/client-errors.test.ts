import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fill } from "../src/i18n";
import { en } from "../src/i18n/en";
import { ko } from "../src/i18n/ko";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_SECONDS } from "../src/lib/api-contract";
import {
  formatReset,
  liveStatusMessage,
  readUploadResponse,
  runErrorMessage,
  uploadErrorMessage,
} from "../src/lib/client/api-errors";
import { checkClipFile } from "../src/lib/client/upload";

const labels = { tooLong: en.landing.uploadTooLong, failed: en.landing.uploadFailed };
const json = (status: number, body: unknown) => ({
  status,
  contentType: "application/json",
  text: JSON.stringify(body),
});
const FILE_BYTES = 45 * 1024 * 1024;
/** 2026-09-23 03:00 UTC; the allowance renews at 2026-09-24 00:00 UTC, 21 hours later. */
const NOW = Date.UTC(2026, 8, 23, 3, 0);
const RESET = "2026-09-24T00:00:00.000Z";

describe("readUploadResponse", () => {
  it("returns the project id on success", () => {
    assert.deepEqual(readUploadResponse(json(200, { id: "u-abc" }), 10), { id: "u-abc" });
  });

  it("reads Cloud Run's HTML 413 page as too large, with the file's own size", () => {
    const html = { status: 413, contentType: "text/html; charset=UTF-8", text: "<html>413</html>" };
    assert.deepEqual(readUploadResponse(html, FILE_BYTES), {
      code: "too_large",
      bytes: FILE_BYTES,
    });
  });

  it("keeps the measured length of a too-long clip", () => {
    const answer = json(422, { error: "too_long", maxSeconds: 90, seconds: 125 });
    assert.deepEqual(readUploadResponse(answer, 10), { code: "too_long", seconds: 125 });
  });

  it("passes the other API codes through", () => {
    for (const code of ["not_video", "no_video_stream", "unreadable", "forbidden", "internal"]) {
      assert.deepEqual(readUploadResponse(json(422, { error: code }), 10), { code });
    }
  });

  it("names non-API answers by their status", () => {
    const gateway = { status: 502, contentType: "text/html", text: "Bad Gateway" };
    assert.deepEqual(readUploadResponse(gateway, 10), { code: "unexpected", status: 502 });
    assert.deepEqual(readUploadResponse(json(500, { error: "surprise" }), 10), {
      code: "unexpected",
      status: 500,
    });
  });
});

describe("checkClipFile", () => {
  const video = { type: "video/mp4", size: 1024 };

  it("accepts a small short video, and one the browser cannot measure", () => {
    assert.equal(checkClipFile(video, 30), null);
    assert.equal(checkClipFile(video, null), null);
  });

  it("rejects files that are not videos, too big or too long", () => {
    assert.deepEqual(checkClipFile({ type: "audio/mpeg", size: 10 }, null), { code: "not_video" });
    assert.deepEqual(checkClipFile({ type: "video/mp4", size: MAX_UPLOAD_BYTES + 1 }, null), {
      code: "too_large",
      bytes: MAX_UPLOAD_BYTES + 1,
    });
    assert.deepEqual(checkClipFile(video, 125), { code: "too_long", seconds: 125 });
  });

  it("leaves the server's half-second slack to the server", () => {
    assert.equal(checkClipFile(video, MAX_UPLOAD_SECONDS + 0.4), null);
  });
});

describe("uploadErrorMessage", () => {
  it("says the size, the limit and what to do", () => {
    const message = uploadErrorMessage({ code: "too_large", bytes: FILE_BYTES }, en, "en", labels);
    assert.equal(
      message,
      "This file is 45 MB; Gapline takes up to 30 MB. Export it at 720p, or trim it to one scene, and try again.",
    );
  });

  it("says the clip length when it is known, and the page label when it is not", () => {
    assert.equal(
      uploadErrorMessage({ code: "too_long", seconds: 125 }, en, "en", labels),
      "This clip runs 2 min 5 s; Gapline takes clips up to 90 seconds. Trim it to one scene and try again.",
    );
    assert.equal(uploadErrorMessage({ code: "too_long" }, en, "en", labels), labels.tooLong);
    assert.equal(uploadErrorMessage({ code: "unreadable" }, en, "en", labels), labels.failed);
  });

  it("has a Korean sentence for every code", () => {
    for (const code of Object.keys(ko.upload.errors)) {
      assert.ok(ko.upload.errors[code as keyof typeof ko.upload.errors].length > 0, code);
    }
    assert.match(
      uploadErrorMessage({ code: "too_long", seconds: 125 }, ko, "ko", labels),
      /2분 5초.*90초까지/,
    );
  });
});

describe("runErrorMessage", () => {
  it("names the renewal time for the daily limit", () => {
    const message = runErrorMessage({ code: "budget_daily", resetAt: RESET }, en, "en", null, NOW);
    assert.ok(message.startsWith(en.live.errors.budget_daily));
    assert.match(message, /It renews at .+ \(in 21 hours\)\.$/);
  });

  it("tells busy apart from the daily limit, without a run reference", () => {
    assert.equal(
      runErrorMessage({ code: "budget_busy" }, en, "en", "r-1"),
      en.live.errors.budget_busy,
    );
  });

  it("adds the run id as a reference to failures after the run started", () => {
    assert.equal(
      runErrorMessage({ code: "speech_failed" }, en, "en", "r-1"),
      `${en.live.errors.speech_failed} Reference: r-1.`,
    );
  });

  it("follows the run's retryable flag where the code alone does not say if it would repeat", () => {
    for (const [dict, lang] of [
      [en, "en"],
      [ko, "ko"],
    ] as const) {
      for (const code of ["speech_failed", "voice_failed"] as const) {
        assert.equal(
          runErrorMessage({ code, retryable: false }, dict, lang),
          dict.live.noRetry[code],
        );
        assert.equal(
          runErrorMessage({ code, retryable: true }, dict, lang),
          dict.live.errors[code],
        );
        // Edit failures and older runs do not say; the page offers a retry for those too.
        assert.equal(runErrorMessage({ code }, dict, lang), dict.live.errors[code]);
        assert.notEqual(dict.live.noRetry[code], dict.live.errors[code]);
      }
      // describeFailure never marks media_failed retryable: its one sentence is for that case.
      assert.equal(
        runErrorMessage({ code: "media_failed", retryable: false }, dict, lang, "r-1"),
        `${dict.live.errors.media_failed} ${fill(dict.live.reference, { runId: "r-1" })}`,
      );
    }
  });

  it("never shows raw text from runs recorded before the codes existed", () => {
    assert.equal(
      runErrorMessage({ code: "ffmpeg exited 234: …" }, en, "en"),
      en.live.errors.unknown,
    );
    assert.equal(runErrorMessage({}, en, "en"), en.live.errors.unknown);
  });
});

describe("formatReset and liveStatusMessage", () => {
  it("counts minutes when the renewal is under an hour away", () => {
    const soon = Date.parse(RESET) - 25 * 60_000;
    assert.equal(formatReset(RESET, "en", soon).wait, "in 25 minutes");
    assert.equal(formatReset(RESET, "ko", soon).wait, "25분 후");
  });

  it("uses the page's own busy and daily sentences", () => {
    assert.equal(
      liveStatusMessage("budget_busy", RESET, en.upload.status, en, "en", NOW),
      en.upload.status.budget_busy,
    );
    assert.match(
      liveStatusMessage("budget_daily", RESET, ko.live.status, ko, "ko", NOW),
      /다시 채워집니다\(21시간 후\)\.$/,
    );
  });
});
