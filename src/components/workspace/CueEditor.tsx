"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { fill } from "@/i18n";
import { runErrorMessage } from "@/lib/client/api-errors";
import { formatDuration } from "@/lib/format";
import type { Cue, Gap, Language } from "@/lib/pipeline/schemas";
import type { RunListing } from "@/lib/store/projects";
import {
  changesNothing,
  editErrorMessage,
  formatStart,
  shownStartRange,
  type EditFailureText,
} from "./edit-errors";
import { postEdit, STILL_RUNNING } from "./edit-request";
import { RemoveLine } from "./RemoveLine";
import { editStep, useElapsedSeconds } from "./use-elapsed";
import { NoteGloss } from "./VersionHistory";

export interface EditorProps {
  projectId: string;
  runId: string;
  cue: Cue;
  cues: Cue[];
  gaps: Gap[];
  /** The run's narration language: the reviewer's reasons for a rejected edit are written in it. */
  language: Language | null;
  /** The new result's id, and the runs as the save's answer lists them (absent from older servers). */
  onSaved: (runId: string, runs?: RunListing[]) => Promise<void>;
  onBusy: (busy: boolean) => void;
  /**
   * Why an edit or a removal would be refused now (the run panel's notice: today's allowance is
   * spent, or this visitor's other run or edit is going), or null. The server reserves for an edit
   * what it reserves for a run, so while a run could not start, neither could an edit.
   */
  unavailable?: string | null;
}

/**
 * Whether a line can be edited: it needs its room, a finished state, and per-line audio for every
 * other line (results from before per-line audio cannot be re-mixed one line at a time).
 */
function editState(cue: Cue, cues: Cue[], gaps: Gap[]): "ok" | "legacy" | "none" {
  if (!gaps.some((g) => g.id === cue.gapId)) return "none";
  if (cue.status !== "fits" && cue.status !== "dropped" && cue.status !== "removed") return "none";
  if (cues.some((c) => c.status === "fits" && !c.audioFile)) return "legacy";
  return "ok";
}

/** What went wrong with the last edit or removal, under the form that made it. */
interface EditFailure {
  action: "edit" | "remove";
  text: EditFailureText;
}

/**
 * "Edit this line", folded until the editor asks for it, so the review history reads first; opening
 * it brings the form into view and puts the caret in its words. "Remove this line" sits beside it
 * for a line in the track, not inside it. While either request runs, both are locked; while one
 * would be refused (`unavailable`), the reason shows first and both are locked too, a draft kept.
 * Only the latest request's error shows: starting an edit or a removal clears the one before.
 * Escape folds the form again (its draft stays).
 */
export function EditLine(props: EditorProps) {
  const { t } = useI18n();
  const [locked, setLocked] = useState(false);
  const unavailable = props.unavailable ?? null;
  const [failure, setFailure] = useState<EditFailure | null>(null);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const state = editState(props.cue, props.cues, props.gaps);
  if (state === "none") return null;
  if (state === "legacy") return <p className="label">{t.editor.legacy}</p>;
  const onBusy = (busy: boolean) => {
    setLocked(busy);
    props.onBusy(busy);
  };
  return (
    <div className="edit-actions">
      {unavailable ? (
        <p className="label edit-unavailable" role="note">
          {fill(t.editor.unavailable, { reason: unavailable })}
        </p>
      ) : null}
      <details
        className="edit-line"
        ref={disclosure}
        onToggle={(event) => {
          const details = event.currentTarget;
          if (!details.open) return;
          // The form opens under the whole history, often below the inspector's fold.
          const form = details.querySelector<HTMLFormElement>(".cue-editor");
          form?.scrollIntoView({ block: "nearest" });
          form?.querySelector("textarea")?.focus({ preventScroll: true });
        }}
        onKeyDown={(event) => {
          const details = disclosure.current;
          if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
          if (!details?.open || locked) return;
          event.preventDefault();
          event.stopPropagation();
          details.open = false;
          details.querySelector("summary")?.focus();
        }}
      >
        <summary className="button">
          {/* Drawn rather than typed: no web font in the stack has ▾, so a typed one came from
              whatever symbol font the system had (as with PlayIcon). */}
          <svg
            className="disclosure-mark"
            viewBox="0 0 10 10"
            width="10"
            height="10"
            fill="currentColor"
            stroke="currentColor"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M2 3.5h6L5 7.5z" />
          </svg>
          {t.editor.title}
        </summary>
        <CueEditor
          {...props}
          onBusy={onBusy}
          locked={locked || unavailable !== null}
          error={failure?.action === "edit" ? failure.text : null}
          onError={(text) => setFailure(text && { action: "edit", text })}
        />
      </details>
      {props.cue.status === "fits" ? (
        <RemoveLine
          projectId={props.projectId}
          runId={props.runId}
          cue={props.cue}
          onSaved={props.onSaved}
          onBusy={onBusy}
          locked={locked}
          unavailable={unavailable !== null}
          error={failure?.action === "remove" ? failure.text : null}
          onError={(text) => setFailure(text && { action: "remove", text })}
        />
      ) : null}
    </div>
  );
}

function CueEditor({
  projectId,
  runId,
  cue,
  cues,
  gaps,
  language,
  onSaved,
  onBusy,
  locked,
  error,
  onError: setError,
}: EditorProps & {
  locked: boolean;
  error: EditFailureText | null;
  onError: (error: EditFailureText | null) => void;
}) {
  const { t, lang } = useI18n();
  const [text, setText] = useState(cue.versions.at(-1)!.text);
  const [start, setStart] = useState(String(cue.start));
  const [busy, setBusy] = useState(false);
  const request = useRef<{ value: string; id: string } | null>(null);
  const elapsed = useElapsedSeconds(busy);
  const step = editStep(elapsed);
  const errorNote = useRef<HTMLDivElement>(null);
  const progressNote = useRef<HTMLParagraphElement>(null);
  const textField = useRef<HTMLTextAreaElement>(null);
  const startField = useRef<HTMLInputElement>(null);
  const id = useId();
  const ids = { hint: `${id}-restore`, range: `${id}-range`, error: `${id}-error` };
  const textBad = error?.field === "text" || error?.field === "both";
  const startBad = error?.field === "start" || error?.field === "both";
  // Back to the field the message is about, which now reads the message as its description. The
  // message itself renders under the Save button, often below the inspector's fold.
  useEffect(() => {
    if (!error) return;
    const field = error.field === "start" ? startField.current : error.field && textField.current;
    field?.focus({ preventScroll: true });
    errorNote.current?.scrollIntoView({ block: "nearest" });
  }, [error]);
  // What the request is doing reads under the button, which can sit at the inspector's fold.
  useEffect(() => {
    if (busy) progressNote.current?.scrollIntoView({ block: "nearest" });
  }, [busy]);
  const gap = gaps.find((g) => g.id === cue.gapId)!;
  const peers = cues
    .filter((c) => (c.status === "fits" || c.id === cue.id) && c.gapId === cue.gapId)
    .sort((a, b) => a.start - b.start);
  const index = peers.findIndex((c) => c.id === cue.id);
  const previous = peers[index - 1];
  const min = Math.max(gap.start, previous ? previous.start + previous.seconds! : 0);
  const max = Math.min(gap.end, peers[index + 1]?.start ?? Infinity);
  // The server takes a start from `min` up to, not at, `max`: the form offers what it prints, and a
  // refusal names the same starts.
  const range = shownStartRange(min, max);
  // Any line but a removed one needs a change to be worth a request, by the server's rule.
  const unchanged = changesNothing(cue, text, Number(start));
  const describedBy = (...parts: (string | false)[]) =>
    parts.filter(Boolean).join(" ") || undefined;
  return (
    <form
      className="cue-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || locked) return;
        const value = JSON.stringify([text.trim(), Number(start)]);
        if (request.current?.value !== value) request.current = { value, id: crypto.randomUUID() };
        setBusy(true);
        onBusy(true);
        setError(null);
        try {
          const answer = await postEdit(projectId, runId, {
            cueId: cue.id,
            text,
            start: Number(start),
            requestId: request.current.id,
          });
          // No answer, or the platform's "not now": the id is kept, so pressing again finds this
          // request's result instead of making a second edit.
          if (answer.kind === "offline") {
            setError({ text: runErrorMessage({ code: "connection" }, t, lang) });
            return;
          }
          if (answer.kind === "busy") {
            setError({ text: t.editor.errors.server_busy });
            return;
          }
          if (answer.kind === "refused") {
            // Only a request that is still running keeps its id, so a retry finds its result. Any
            // other answer is final for that id: pressing again must make a new request.
            if (answer.body?.error !== STILL_RUNNING) request.current = null;
            setError(editErrorMessage(answer.body, { min, max, start: Number(start) }, t, lang));
            return;
          }
          try {
            await onSaved(answer.runId, answer.runs);
          } catch (e) {
            console.error("edit saved, but the new result did not load", e);
            setError({ text: t.editor.failed });
          }
        } finally {
          setBusy(false);
          onBusy(false);
        }
      }}
    >
      {cue.status === "removed" ? (
        <p className="label" id={ids.hint}>
          {t.editor.restoreHint}
        </p>
      ) : null}
      {/* Locked fields stay focusable (read-only, not disabled), so focus is never dropped. */}
      <label>
        {t.editor.text}
        <textarea
          ref={textField}
          name="text"
          value={text}
          maxLength={2000}
          required
          readOnly={locked}
          aria-disabled={locked || undefined}
          aria-invalid={textBad || undefined}
          aria-describedby={describedBy(cue.status === "removed" && ids.hint, textBad && ids.error)}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label>
        {t.editor.start}
        <input
          ref={startField}
          name="start"
          type="number"
          min={min}
          max={range.last}
          step="any"
          required
          value={start}
          readOnly={locked}
          aria-disabled={locked || undefined}
          aria-invalid={startBad || undefined}
          aria-describedby={describedBy(ids.range, startBad && ids.error)}
          onChange={(e) => setStart(e.target.value)}
        />
      </label>
      <p className="label" id={ids.range}>
        {fill(t.editor.startRange, {
          first: formatStart(range.first, lang),
          last: formatStart(range.last, lang),
          end: formatStart(range.end, lang),
        })}
      </p>
      <p className="label">{t.editor.hint}</p>
      {/* While its request runs, the button keeps focus: it is marked disabled, not disabled. */}
      <button
        className="button primary"
        type="submit"
        disabled={!busy && (locked || !text.trim() || unchanged)}
        aria-disabled={busy || undefined}
      >
        {busy ? (
          <>
            <span className="spinner" aria-hidden="true" />
            {fill(t.editor.saving[step], { elapsed: formatDuration(elapsed, lang) })}
          </>
        ) : (
          t.editor.save
        )}
      </button>
      <p className="label edit-progress" role="status" ref={progressNote}>
        {busy ? t.editor.progress[step] : null}
      </p>
      {error ? (
        <div className="ws-error edit-error" role="alert" id={ids.error} ref={errorNote}>
          <p>
            <span aria-hidden="true">⚠ </span>
            {error.text}
          </p>
          {error.reviewer ? (
            <p>
              <span className="edit-error-label">{t.editor.errors.why}: </span>
              <span lang={language ?? undefined}>{error.reviewer}</span>
              <NoteGloss text={error.reviewer} textLang={language} />
            </p>
          ) : null}
          {error.fix ? (
            <p>
              <span className="edit-error-label">{t.editor.errors.suggestion}: </span>
              <span lang={language ?? undefined}>{error.fix}</span>
              <NoteGloss text={error.fix} textLang={language} />
            </p>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
