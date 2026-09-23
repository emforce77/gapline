import type { UploadErrorCode } from "./api-contract";

/** A Google Cloud API (Speech-to-Text, Text-to-Speech) answered with an error or was unreachable. */
export class ServiceError extends Error {
  constructor(
    public code: "speech_failed" | "voice_failed",
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}

/** The model answered, but not in a form the pipeline can use. */
export class ModelOutputError extends Error {}

/** An uploaded file that cannot become a clip; the code goes to the browser, the message to the log. */
export class UploadError extends Error {
  constructor(
    public code: Exclude<UploadErrorCode, "forbidden" | "missing_file" | "not_video" | "internal">,
    message: string,
    public seconds?: number,
  ) {
    super(message);
  }
}

/** 429 and 5xx are worth another try later; other statuses are not. */
export function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}
