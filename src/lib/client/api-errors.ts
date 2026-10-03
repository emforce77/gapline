/**
 * Turns API error codes (src/lib/api-contract.ts) into catalog sentences that say what happened and
 * what to do next. Pure functions: the workspace and the upload card call them, and tests pin them.
 * Raw server text never reaches here; the run id is the reference that finds it in the server log.
 */
import { fill, type UiLang } from "@/i18n";
import type { Dictionary } from "@/i18n/en";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_SECONDS,
  type ApiErrorBody,
  type BudgetErrorCode,
  type LiveStatus,
  type RequestErrorCode,
  type RunErrorCode,
  type UploadErrorCode,
} from "@/lib/api-contract";
import { formatDuration } from "@/lib/format";

const BYTES_PER_MB = 1024 * 1024;
const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;

/** Upload failures, including the two the browser names itself (no answer, or not the API's). */
export type UploadFailureCode = UploadErrorCode | "network" | "unexpected";

export type UploadFailure =
  | { code: "too_large"; bytes: number }
  /** seconds: the clip length, when the browser or the server measured it. */
  | { code: "too_long"; seconds?: number }
  | { code: "unexpected"; status: number }
  | { code: Exclude<UploadFailureCode, "too_large" | "too_long" | "unexpected"> };

/**
 * Why a run did not start or did not finish. Two are the browser's own: `connection`, no answer
 * arrived (whether the request did is unknown), and `server_busy`, the platform answered for the
 * app (Cloud Run's "Rate exceeded." page, a gateway error), so the run did not start.
 */
export type RunFailureCode = RunErrorCode | RequestErrorCode | "connection" | "server_busy";

const UPLOAD_CODES: readonly UploadErrorCode[] = [
  "forbidden",
  "missing_file",
  "not_video",
  "too_large",
  "too_long",
  "too_short",
  "no_video_stream",
  "unreadable",
  "internal",
];
const RUN_CODES: readonly RunFailureCode[] = [
  "budget_busy",
  "budget_daily",
  "visitor_busy",
  "visitor_daily",
  "run_allowance",
  "provider_busy",
  "provider_failed",
  "model_output",
  "speech_failed",
  "voice_failed",
  "media_failed",
  "internal",
  "forbidden",
  "not_found",
  "invalid_request",
  "run_active",
  "connection",
  "server_busy",
];

export function isUploadErrorCode(code: unknown): code is UploadErrorCode {
  return UPLOAD_CODES.includes(code as UploadErrorCode);
}

export function isRunFailureCode(code: unknown): code is RunFailureCode {
  return RUN_CODES.includes(code as RunFailureCode);
}

export function isBudgetCode(code: unknown): code is BudgetErrorCode {
  return code === "budget_busy" || code === "budget_daily";
}

/** "31.5 MB" in the viewer's language; sizes are binary megabytes, like the upload limit. */
export function formatMegabytes(bytes: number, lang: UiLang): string {
  return new Intl.NumberFormat(lang, {
    style: "unit",
    unit: "megabyte",
    maximumFractionDigits: bytes < 10 * BYTES_PER_MB ? 1 : 0,
  }).format(bytes / BYTES_PER_MB);
}

/**
 * When the daily allowance renews, in the viewer's own clock ("9:00 AM GMT+9") and as a distance
 * from now ("in 5 hours"). The server sends the instant (next 00:00 UTC); the browser knows the zone.
 */
export function formatReset(
  resetAt: string,
  lang: UiLang,
  now = Date.now(),
): { time: string; wait: string } {
  const at = new Date(resetAt);
  const time = new Intl.DateTimeFormat(lang, {
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(at);
  const minutes = Math.max(1, Math.round((at.getTime() - now) / MS_PER_MINUTE));
  const relative = new Intl.RelativeTimeFormat(lang, { numeric: "always" });
  const wait =
    minutes < MINUTES_PER_HOUR
      ? relative.format(minutes, "minute")
      : relative.format(Math.round(minutes / MINUTES_PER_HOUR), "hour");
  return { time, wait };
}

/** Reads a POST /api/projects answer for a file of `fileBytes`: the new project id, or the failure. */
export function readUploadResponse(
  response: { status: number; contentType: string; text: string },
  fileBytes: number,
): { id: string } | UploadFailure {
  const { status, contentType, text } = response;
  if (!contentType.includes("application/json")) {
    // Cloud Run's front end answers an oversized body with its own HTML 413 page.
    return status === 413
      ? { code: "too_large", bytes: fileBytes }
      : { code: "unexpected", status };
  }
  let body: Partial<ApiErrorBody> & { id?: string };
  try {
    body = JSON.parse(text);
  } catch (error) {
    console.error(`upload: HTTP ${status} sent malformed JSON`, error);
    return { code: "unexpected", status };
  }
  if (status >= 200 && status < 300 && typeof body.id === "string") return { id: body.id };
  const code = body.error;
  if (!isUploadErrorCode(code)) return { code: "unexpected", status };
  if (code === "too_large") return { code, bytes: fileBytes };
  if (code === "too_long")
    return { code, ...(body.seconds === undefined ? {} : { seconds: body.seconds }) };
  return { code };
}

/**
 * The sentence for a failed upload. `fallbacks` are the landing page's own two labels (already in
 * the page language): the unreadable-file message and the too-long message when no length is known.
 */
export function uploadErrorMessage(
  failure: UploadFailure,
  t: Dictionary,
  lang: UiLang,
  fallbacks: { tooLong: string; failed: string },
): string {
  const errors = t.upload.errors;
  switch (failure.code) {
    case "too_large":
      return fill(errors.too_large, {
        size: formatMegabytes(failure.bytes, lang),
        max: formatMegabytes(MAX_UPLOAD_BYTES, lang),
      });
    case "too_long":
      return failure.seconds === undefined
        ? fallbacks.tooLong
        : fill(errors.too_long, {
            length: formatDuration(failure.seconds, lang),
            max: formatDuration(MAX_UPLOAD_SECONDS, lang),
          });
    case "unreadable":
      return fallbacks.failed;
    case "unexpected":
      return fill(errors.unexpected, { status: failure.status });
    default:
      return errors[failure.code];
  }
}

/** A run that did not start (JSON error) or stopped (run_failed); `code` is absent in old runs. */
export interface RunFailure {
  code?: string;
  resetAt?: string;
  /** run_failed's flag: false when trying again would fail the same way (the page offers no retry). */
  retryable?: boolean;
}

type NoRetryCode = keyof Dictionary["live"]["noRetry"];

/** Codes whose failure may or may not repeat have a second sentence for when it would. */
function hasNoRetryText(code: RunFailureCode, t: Dictionary): code is NoRetryCode {
  return Object.hasOwn(t.live.noRetry, code);
}

/**
 * The sentence for a run that did not start or did not finish. Daily refusals (the shared allowance,
 * or this visitor's share of it) name the renewal time; other failures after the run started carry
 * the run id as a reference for the server log.
 * A code that may or may not repeat follows the run's `retryable` flag, like the page's retry button.
 */
export function runErrorMessage(
  failure: RunFailure,
  t: Dictionary,
  lang: UiLang,
  runId: string | null = null,
  now = Date.now(),
): string {
  const errors = t.live.errors;
  if (failure.code === "budget_daily" || failure.code === "visitor_daily") {
    if (!failure.resetAt) return errors[failure.code];
    return `${errors[failure.code]} ${fill(t.live.renews, formatReset(failure.resetAt, lang, now))}`;
  }
  if (isBudgetCode(failure.code)) return errors[failure.code];
  const code = isRunFailureCode(failure.code) ? failure.code : null;
  const message = !code
    ? errors.unknown
    : failure.retryable === false && hasNoRetryText(code, t)
      ? t.live.noRetry[code]
      : errors[code];
  return runId ? `${message} ${fill(t.live.reference, { runId })}` : message;
}

/**
 * The sentence for a start the server refused before any stream. An answer without the API's JSON
 * came from the platform in front of it: busy when it says to retry, otherwise the run did not start.
 */
export function refusedStartMessage(
  refusal: { body: Partial<ApiErrorBody>; transient: boolean },
  t: Dictionary,
  lang: UiLang,
  now = Date.now(),
): string {
  if (refusal.body.error)
    return runErrorMessage({ ...refusal.body, code: refusal.body.error }, t, lang, null, now);
  return refusal.transient ? t.live.errors.server_busy : t.live.notStarted;
}

/** What the page says before a paid run when /api/live-status refuses one. */
export function liveStatusMessage(
  reason: BudgetErrorCode,
  resetAt: string,
  messages: { budget_busy: string; budget_daily: string },
  t: Dictionary,
  lang: UiLang,
  now = Date.now(),
): string {
  if (reason === "budget_busy") return messages.budget_busy;
  return `${messages.budget_daily} ${fill(t.live.renews, formatReset(resetAt, lang, now))}`;
}

/**
 * What the workspace says before a paid run when /api/live-status refuses one: the shared allowance
 * first, then this visitor's own limit (their other run or edit, or their daily share); null when a
 * run could start.
 */
export function liveStatusNotice(
  status: LiveStatus,
  t: Dictionary,
  lang: UiLang,
  now = Date.now(),
): string | null {
  if (status.canStart) return null;
  const messages = t.live.status;
  if (status.reason)
    return liveStatusMessage(status.reason, status.resetAt, messages, t, lang, now);
  if (status.visitor === "visitor_busy") return messages.visitor_busy;
  if (status.visitor === "visitor_daily")
    return `${messages.visitor_daily} ${fill(t.live.renews, formatReset(status.resetAt, lang, now))}`;
  return null;
}

/**
 * What the upload card says when /api/live-status refuses a run: the shared allowance in the upload
 * card's own words (a clip can still be uploaded and generated later), else this visitor's own limit
 * in the workspace's words, so the landing page and the workspace name it alike; null when a run
 * could start.
 */
export function uploadStatusNotice(
  status: LiveStatus,
  t: Dictionary,
  lang: UiLang,
  now = Date.now(),
): string | null {
  if (status.reason)
    return liveStatusMessage(status.reason, status.resetAt, t.upload.status, t, lang, now);
  return liveStatusNotice(status, t, lang, now);
}
