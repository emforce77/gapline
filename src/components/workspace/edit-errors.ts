/**
 * The sentence for an edit the server refused or could not finish (POST .../edits). Failures that
 * are not the editor's to fix (allowance, model, voice, media) use the run catalog through
 * runErrorMessage; the ones the editor can act on (too long, a broken rule, a start out of range)
 * get their own sentence. The server's English `message` is never shown, with one exception: for a
 * rejected edit it is the reviewer's own reasons, written in the line's language, and those are the
 * point of the answer.
 */
import { fill, type UiLang } from "@/i18n";
import type { Dictionary } from "@/i18n/en";
import { isRunFailureCode, runErrorMessage } from "@/lib/client/api-errors";
import { formatSeconds } from "@/lib/format";

/** The JSON error body of the edits route; every field is optional because old servers vary. */
export interface EditFailureBody {
  error?: string;
  /** For `edit_failed`: the underlying run failure code. */
  cause?: string;
  resetAt?: string;
  message?: string;
}

/** Where the edited line may start, and where it was asked to start. */
export interface EditPlacement {
  min: number;
  max: number;
  start: number;
}

export interface EditFailureText {
  text: string;
  /** The reviewer's reasons and fix, in the line's language, for an edit it rejected. */
  reviewer?: string;
}

/** Codes the edit route returns for problems the editor can fix by changing the edit. */
const EDITOR_CODES = ["too_long", "review", "placement", "unchanged", "legacy"] as const;
type EditorCode = (typeof EDITOR_CODES)[number];
/** The same request is still being handled (a double submit, or a retry while it runs). */
const BUSY_CODES = ["running", "request_conflict"];

function isEditorCode(code: string | undefined): code is EditorCode {
  return EDITOR_CODES.includes(code as EditorCode);
}

export function editErrorMessage(
  body: EditFailureBody | null,
  placement: EditPlacement,
  t: Dictionary,
  lang: UiLang,
): EditFailureText {
  const errors = t.editor.errors;
  const code = body?.error === "edit_failed" ? body.cause : body?.error;
  if (isRunFailureCode(code))
    return { text: runErrorMessage({ code, resetAt: body?.resetAt }, t, lang) };
  if (code && BUSY_CODES.includes(code)) return { text: errors.busy };
  if (!isEditorCode(code)) return { text: t.editor.failed };
  const seconds = (value: number) => formatSeconds(value, lang);
  switch (code) {
    case "too_long":
      return {
        text: fill(errors.too_long, {
          room: seconds(placement.max - placement.start),
          start: seconds(placement.start),
        }),
      };
    case "review":
      return body?.message?.trim()
        ? { text: errors.review, reviewer: body.message.trim() }
        : { text: errors.review };
    case "placement": {
      // Two decimals, like the range printed under the start field.
      const bound = new Intl.NumberFormat(lang, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return {
        text: fill(errors.placement, {
          min: bound.format(placement.min),
          max: bound.format(placement.max),
        }),
      };
    }
    case "unchanged":
      return { text: errors.unchanged };
    case "legacy":
      return { text: t.editor.legacy };
  }
}
