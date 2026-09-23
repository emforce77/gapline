/**
 * What the browser and the API agree on: upload limits, stable error codes and response shapes.
 * No server imports here, so client components can import it. Full error details stay in the
 * server log; payloads carry only a code (and numbers the client needs to explain it).
 */
import type { Density, Language } from "./pipeline/schemas";

/**
 * Cloud Run rejects HTTP/1 request bodies over 32 MiB before they reach the app; the file limit
 * leaves room for the multipart envelope. Keep in sync with the upload hint in the catalogs.
 */
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
/** Uploads are analysed as a short clip; longer films belong to the batch path, not the live demo. */
export const MAX_UPLOAD_SECONDS = 90;

/**
 * A live run ends within this time: the runs route's maxDuration and Cloud Run's --timeout (both
 * 900 s). A run with no final event after this is reported as interrupted.
 */
export const RUN_TIME_LIMIT_SECONDS = 900;

/** POST /api/projects failures. */
export type UploadErrorCode =
  | "forbidden" // 403: no Origin header, or another site
  | "missing_file" // 400: no `video` file part
  | "not_video" // 415: the part's MIME type is not video/*
  | "too_large" // 413: over MAX_UPLOAD_BYTES (maxBytes in the body)
  | "too_long" // 422: over MAX_UPLOAD_SECONDS (maxSeconds, and seconds when known)
  | "no_video_stream" // 422: a readable file without a picture (audio only)
  | "unreadable" // 422: ffmpeg cannot open or convert it
  | "internal"; // 500: storage or server failure; see the server log

/** Why a live run or edit cannot start right now. */
export type BudgetErrorCode =
  | "budget_busy" // another live run holds the rest of today's allowance; retry when it ends
  | "budget_daily"; // today's allowance is spent; resetAt says when it renews (00:00 UTC)

/** The `code` of a run_failed event, and of run/edit request failures. */
export type RunErrorCode =
  | BudgetErrorCode
  | "run_allowance" // this run reached its own API allowance
  | "provider_busy" // the model provider is rate limited or overloaded (retryAfterSeconds)
  | "provider_failed" // the model provider refused the request (credit, model, price)
  | "model_output" // the model's answer broke the required format
  | "speech_failed" // Google Speech-to-Text failed
  | "voice_failed" // Google Text-to-Speech failed
  | "media_failed" // ffmpeg failed while mixing or encoding
  | "internal";

/** Request-level failures of the run, run-events and edit routes. */
export type RequestErrorCode = "forbidden" | "not_found" | "invalid_request";

/** JSON body of every error response from the API. */
export interface ApiErrorBody<Code extends string = string> {
  error: Code;
  maxBytes?: number;
  maxSeconds?: number;
  /** Measured clip length, for too_long when the file declares it. */
  seconds?: number;
  retryAfterSeconds?: number;
  /** ISO time, for budget_daily. */
  resetAt?: string;
}

/** GET /api/live-status: whether a live run could start now (checked again at start). */
export interface LiveStatus {
  canStart: boolean;
  reason: BudgetErrorCode | null;
  /** Next 00:00 UTC, when the daily allowance renews. */
  resetAt: string;
}

/** A run the viewer started that has not finished; GET /api/projects/[id]/runs → `active`. */
export interface ActiveRun {
  runId: string;
  language: Language;
  density: Density;
  startedAt: string;
  /** Last time the run wrote an event; long silences are normal during model calls. */
  lastEventAt: string;
}

/** GET /api/projects/[id]/runs/[runId] → `status`. "interrupted": no final event and past the time limit. */
export type RunStatus = "running" | "done" | "failed" | "interrupted";
