import type { UploadErrorCode } from "./api-contract";

/** A Google Cloud API (Speech-to-Text, Text-to-Speech) answered with an error or was unreachable. */
export class ServiceError extends Error {
  constructor(
    public code: "speech_failed" | "voice_failed",
    message: string,
    public retryable: boolean,
    /** The HTTP status the service answered with; absent when it could not be reached. */
    public status?: number,
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

const HTTP_CLIENT_ERROR = 400;
const HTTP_SERVER_ERROR = 500;
const HTTP_TOO_MANY_REQUESTS = 429;

/**
 * A Google Cloud refusal that is not billed: a 4xx other than 429 (bad request, unauthenticated,
 * forbidden, not found) is answered before any audio is recognized or synthesized.
 */
export function notBilledStatus(status: number): boolean {
  return (
    status >= HTTP_CLIENT_ERROR && status < HTTP_SERVER_ERROR && status !== HTTP_TOO_MANY_REQUESTS
  );
}

/** A failed Speech-to-Text or Text-to-Speech request that cost nothing (notBilledStatus). */
export function refusedUnbilled(error: unknown): boolean {
  return (
    error instanceof ServiceError && error.status !== undefined && notBilledStatus(error.status)
  );
}
