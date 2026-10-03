/**
 * Browser side of an upload: check the file against the API limits before sending it, then send it
 * with progress. The server checks everything again; these checks only spare a pointless wait.
 */
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_SECONDS } from "@/lib/api-contract";
import type { UploadFailure } from "./api-errors";

/** Same slack as the server's duration check (DURATION_SLACK_SECONDS in store/ingest.ts). */
const DURATION_SLACK_SECONDS = 0.5;
/** A browser that cannot read the metadata this fast will not read it at all; the server measures. */
const METADATA_TIMEOUT_MS = 8_000;

/**
 * What the browser can already rule out. `seconds` is null when this browser cannot read the file's
 * metadata (an unsupported codec, for example); the server's own probe then decides.
 */
export function checkClipFile(
  file: { type: string; size: number },
  seconds: number | null,
): UploadFailure | null {
  if (!file.type.startsWith("video/")) return { code: "not_video" };
  if (file.size > MAX_UPLOAD_BYTES) return { code: "too_large", bytes: file.size };
  if (seconds !== null && seconds > MAX_UPLOAD_SECONDS + DURATION_SLACK_SECONDS)
    return { code: "too_long", seconds };
  return null;
}

/** The clip length as this browser reads it from the file's metadata, or null when it cannot. */
export function readVideoSeconds(file: File): Promise<number | null> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  return new Promise((resolve) => {
    const finish = (seconds: number | null) => {
      window.clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(seconds);
    };
    const timer = window.setTimeout(() => {
      console.info("upload: no metadata from the browser in time; the server will measure");
      finish(null);
    }, METADATA_TIMEOUT_MS);
    video.onloadedmetadata = () =>
      // WebM from MediaRecorder can report Infinity until played through.
      finish(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => {
      console.info(
        "upload: this browser cannot read the file; the server will measure",
        video.error,
      );
      finish(null);
    };
    video.src = url;
  });
}

/** Thrown when the upload never got an HTTP answer (offline, connection reset). */
export class UploadNetworkError extends Error {}

/** Thrown when `signal` stopped the upload: the visitor cancelled it, or its page went away. */
export class UploadCancelledError extends Error {}

/**
 * POSTs the file as multipart `video` and reports sending progress (0 to 1). XMLHttpRequest is used
 * because fetch cannot report upload progress. Resolves with the raw answer, whatever its status.
 * Aborting `signal` stops the request and rejects with UploadCancelledError.
 */
export function sendClip(
  file: File,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ status: number; contentType: string; text: string }> {
  const body = new FormData();
  body.append("video", file);
  const request = new XMLHttpRequest();
  return new Promise((resolve, reject) => {
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.upload.onload = () => onProgress(1);
    request.onload = () =>
      resolve({
        status: request.status,
        contentType: request.getResponseHeader("content-type") ?? "",
        text: request.responseText,
      });
    request.onerror = () => reject(new UploadNetworkError("The upload got no answer"));
    request.onabort = () =>
      reject(
        signal?.aborted
          ? new UploadCancelledError("The upload was cancelled")
          : new UploadNetworkError("The upload was aborted"),
      );
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.open("POST", "/api/projects");
    request.send(body);
  });
}
