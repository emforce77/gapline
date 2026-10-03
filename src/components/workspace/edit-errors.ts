/**
 * The sentence for an edit the server refused or could not finish (POST .../edits). Failures that
 * are not the editor's to fix (allowance, model, voice, media) are said in edit terms where the run
 * catalog's sentence would describe a run (editor.errors.stopped), and otherwise through
 * runErrorMessage; the ones the editor can act on (too long, a broken rule, a start out of range)
 * get their own sentence. The server's English `message` is never shown, with one exception: for a
 * rejected edit from a server that does not send `reasons` it is the reviewer's own reasons, written
 * in the line's language, and those are the point of the answer.
 */
import { fill, type UiLang } from "@/i18n";
import type { Dictionary } from "@/i18n/en";
import { isRunFailureCode, runErrorMessage } from "@/lib/client/api-errors";
import { sameWords } from "@/lib/pipeline/cues";
import type { Cue } from "@/lib/pipeline/schemas";

/** The JSON error body of the edits route; every field is optional because old servers vary. */
export interface EditFailureBody {
  error?: string;
  /** For `edit_failed`: the underlying run failure code. */
  cause?: string;
  resetAt?: string;
  /** For `edit_failed`: whether the same attempt may succeed if tried again. */
  retryable?: boolean;
  message?: string;
  /** For `too_long`: how long the edited words ran once voiced and trimmed. */
  spokenSeconds?: number;
  /** For `review`: the reviewer's reasons, one per broken rule, in the line's language. */
  reasons?: string[];
  /** For `review`: the reviewer's suggestion, in the line's language. */
  fix?: string;
}

/** Where the edited line may start (from `min`, and before `max`), and where it was asked to start. */
export interface EditPlacement {
  min: number;
  /** Where the line's room ends: the next line's start or the silence's end. */
  max: number;
  start: number;
}

/** The form field an error is about: its words, its start, or both (nothing changed). */
export type EditField = "text" | "start" | "both";

export interface EditFailureText {
  text: string;
  /** The reviewer's reasons, in the line's language, for an edit it rejected. */
  reviewer?: string;
  /** The reviewer's suggested fix, in the line's language, shown under its own label. */
  fix?: string;
  /** The field to mark invalid and describe with this message; none for failures of the service. */
  field?: EditField;
}

/** Codes the edit route returns for problems the editor can fix by changing the edit. */
const EDITOR_CODES = ["too_long", "review", "placement", "unchanged", "legacy"] as const;
type EditorCode = (typeof EDITOR_CODES)[number];
/** The same request is still being handled (a double submit, or a retry while it runs). */
const BUSY_CODES = ["running", "request_conflict"];

function isEditorCode(code: string | undefined): code is EditorCode {
  return EDITOR_CODES.includes(code as EditorCode);
}

type StoppedCode = keyof Dictionary["editor"]["errors"]["stopped"];
type StoppedNoRetryCode = keyof Dictionary["editor"]["errors"]["stoppedNoRetry"];

/** A failure whose run sentence says "the run" (stopped, did not start): an edit has its own. */
function stoppedText(code: string, retryable: boolean | undefined, t: Dictionary): string | null {
  const errors = t.editor.errors;
  if (retryable === false && Object.hasOwn(errors.stoppedNoRetry, code))
    return errors.stoppedNoRetry[code as StoppedNoRetryCode];
  return Object.hasOwn(errors.stopped, code) ? errors.stopped[code as StoppedCode] : null;
}

/** A value in hundredths, rounded at 1e-4 first so that 15 never reads as 1499.999…. */
function hundredths(seconds: number): number {
  return Math.round(seconds * 1e6) / 1e4;
}

/**
 * The line's room in the two decimals the form prints: the first start at or after `min`, the last
 * start before `max` (the server refuses a start at the end of the room, which leaves no time to
 * speak), and the end of the room, which the spoken line must not pass, rounded down.
 */
export function shownStartRange(
  min: number,
  max: number,
): { first: number; last: number; end: number } {
  return {
    first: Math.ceil(hundredths(min)) / 100,
    last: (Math.ceil(hundredths(max)) - 1) / 100,
    end: Math.floor(hundredths(max)) / 100,
  };
}

/**
 * True when the server would refuse this edit as "unchanged" (edit-run.ts checkTextEdit): the same
 * words by its rule (spacing and compatibility forms aside) at the same start. Putting a removed line
 * back with its own words is a change.
 */
export function changesNothing(cue: Cue, text: string, start: number): boolean {
  return (
    cue.status !== "removed" && sameWords(text, cue.versions.at(-1)!.text) && start === cue.start
  );
}

/** Two decimals, like the range printed under the start field. */
export function formatStart(seconds: number, lang: UiLang): string {
  return new Intl.NumberFormat(lang, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(seconds);
}

/** The reasons as one text, each said once: two flagged words can break the same rule. */
function reviewerReasons(body: EditFailureBody | null): string | undefined {
  if (body?.reasons?.length)
    return [...new Set(body.reasons.map((r) => r.trim()).filter(Boolean))].join(" ") || undefined;
  return body?.message?.trim() || undefined;
}

function tooLong(
  body: EditFailureBody | null,
  placement: EditPlacement,
  t: Dictionary,
  lang: UiLang,
) {
  const errors = t.editor.errors;
  // Every value in hundredths, like the start field and its range: in tenths 4.01 s of words "take
  // 4.0 s" of a 4.0 s room, and the latest start can round onto the start already asked for.
  const shown = (inHundredths: number) => formatStart(inHundredths / 100, lang);
  const start = Math.round(hundredths(placement.start));
  const room = hundredths(placement.max - placement.start);
  const spoken = body?.spokenSeconds;
  // Without the voiced length, or with one that fits the room as this page measures it (the server
  // measured another room), "cut about" would be negative and "start at" later, not earlier.
  if (typeof spoken !== "number" || hundredths(spoken) <= room)
    return fill(errors.too_long, { room: shown(Math.floor(room)), start: shown(start) });
  // The length rounds up and the room down, so the printed numbers add up and cutting "about" that
  // much always fits. The latest start rounds down to fit, and sits below the start printed.
  const spokenShown = Math.ceil(hundredths(spoken));
  const roomShown = Math.floor(room);
  const latest = Math.min(Math.floor(hundredths(placement.max - spoken)), start - 1);
  const values = {
    spoken: shown(spokenShown),
    start: shown(start),
    room: shown(roomShown),
    over: shown(spokenShown - roomShown),
    latest: shown(latest),
  };
  const first = Math.round(shownStartRange(placement.min, placement.max).first * 100);
  return fill(latest >= first ? errors.spokenEarlier : errors.spoken, values);
}

export function editErrorMessage(
  body: EditFailureBody | null,
  placement: EditPlacement,
  t: Dictionary,
  lang: UiLang,
): EditFailureText {
  const errors = t.editor.errors;
  const code = body?.error === "edit_failed" ? body.cause : body?.error;
  const stopped = code ? stoppedText(code, body?.retryable, t) : null;
  if (stopped) return { text: stopped };
  if (isRunFailureCode(code))
    return {
      text: runErrorMessage({ code, resetAt: body?.resetAt, retryable: body?.retryable }, t, lang),
    };
  if (code && BUSY_CODES.includes(code)) return { text: errors.busy };
  if (!isEditorCode(code)) return { text: t.editor.failed };
  switch (code) {
    case "too_long":
      return { text: tooLong(body, placement, t, lang), field: "text" };
    case "review": {
      const reviewer = reviewerReasons(body);
      const fix = body?.fix?.trim();
      return {
        text: errors.review,
        ...(reviewer ? { reviewer } : {}),
        ...(fix ? { fix } : {}),
        field: "text",
      };
    }
    case "placement": {
      const range = shownStartRange(placement.min, placement.max);
      return {
        text: fill(errors.placement, {
          min: formatStart(range.first, lang),
          max: formatStart(range.last, lang),
        }),
        field: "start",
      };
    }
    case "unchanged":
      return { text: errors.unchanged, field: "both" };
    case "legacy":
      return { text: t.editor.legacy };
  }
}
