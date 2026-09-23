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

/** Why a run did not start or did not finish; `connection` means the start request never arrived. */
export type RunFailureCode = RunErrorCode | RequestErrorCode | "connection";

const UPLOAD_CODES: readonly UploadErrorCode[] = [
  "forbidden",
  "missing_file",
  "not_video",
  "too_large",
  "too_long",
  "no_video_stream",
  "unreadable",
  "internal",
];
const RUN_CODES: readonly RunFailureCode[] = [
  "budget_busy",
  "budget_daily",
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
  "connection",
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
}

/**
 * The sentence for a run that did not start or did not finish. Budget refusals name the renewal
 * time; other failures after the run started carry the run id as a reference for the server log.
 */
export function runErrorMessage(
  failure: RunFailure,
  t: Dictionary,
  lang: UiLang,
  runId: string | null = null,
  now = Date.now(),
): string {
  const errors = t.live.errors;
  if (failure.code === "budget_daily") {
    if (!failure.resetAt) return errors.budget_daily;
    return `${errors.budget_daily} ${fill(t.live.renews, formatReset(failure.resetAt, lang, now))}`;
  }
  if (isBudgetCode(failure.code)) return errors[failure.code];
  const message = isRunFailureCode(failure.code) ? errors[failure.code] : errors.unknown;
  return runId ? `${message} ${fill(t.live.reference, { runId })}` : message;
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
