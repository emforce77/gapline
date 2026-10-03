import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { sendClip, UploadCancelledError, UploadNetworkError } from "../src/lib/client/upload";

/** Just enough of XMLHttpRequest for sendClip: the test drives it through `last`. */
class FakeRequest {
  static last: FakeRequest;
  upload: { onprogress?: (e: ProgressEvent) => void; onload?: () => void } = {};
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  status = 0;
  responseText = "";
  sent = false;
  aborted = false;
  constructor() {
    FakeRequest.last = this;
  }
  open() {}
  send() {
    this.sent = true;
  }
  abort() {
    this.aborted = true;
    this.onabort?.();
  }
  getResponseHeader() {
    return "application/json";
  }
}

const file = new File([new Uint8Array(8)], "clip.mp4", { type: "video/mp4" });
const realRequest = globalThis.XMLHttpRequest;

describe("sendClip", () => {
  beforeEach(() => {
    globalThis.XMLHttpRequest = FakeRequest as unknown as typeof XMLHttpRequest;
  });
  afterEach(() => {
    globalThis.XMLHttpRequest = realRequest;
  });

  it("reports progress and resolves with the answer", async () => {
    const seen: number[] = [];
    const answer = sendClip(file, (f) => seen.push(f));
    const request = FakeRequest.last;
    request.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 8 } as ProgressEvent);
    request.upload.onload?.();
    request.status = 201;
    request.responseText = '{"id":"u-1"}';
    request.onload?.();
    assert.deepEqual(await answer, {
      status: 201,
      contentType: "application/json",
      text: '{"id":"u-1"}',
    });
    assert.deepEqual(seen, [0.25, 1]);
  });

  it("stops the request when the signal aborts and says it was cancelled", async () => {
    const controller = new AbortController();
    const answer = sendClip(file, () => {}, controller.signal);
    controller.abort();
    await assert.rejects(answer, UploadCancelledError);
    assert.equal(FakeRequest.last.aborted, true);
  });

  it("keeps a dropped connection a network failure, not a cancellation", async () => {
    const answer = sendClip(file, () => {}, new AbortController().signal);
    FakeRequest.last.onerror?.();
    await assert.rejects(answer, UploadNetworkError);
  });
});
