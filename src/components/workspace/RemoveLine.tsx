"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { fill } from "@/i18n";
import { runErrorMessage } from "@/lib/client/api-errors";
import { formatDuration } from "@/lib/format";
import type { Cue } from "@/lib/pipeline/schemas";
import type { RunListing } from "@/lib/store/projects";
import { editErrorMessage, type EditFailureText } from "./edit-errors";
import { postEdit, STILL_RUNNING } from "./edit-request";
import { reviewStep, useElapsedSeconds } from "./use-elapsed";

/**
 * "Remove this line", with a confirmation step. A removal makes a new result without the line: the
 * other lines keep their audio, and the final check runs again on what remains. Escape, like
 * "Keep it", closes the question.
 */
export function RemoveLine({
  projectId,
  runId,
  cue,
  onSaved,
  onBusy,
  locked,
  error,
  onError: setError,
}: {
  projectId: string;
  runId: string;
  cue: Cue;
  onSaved: (runId: string, runs?: RunListing[]) => Promise<void>;
  onBusy: (busy: boolean) => void;
  locked: boolean;
  /** This removal's error; null when the latest request (edit or removal) was not a removal. */
  error: EditFailureText | null;
  /** Null clears the error of any earlier request, the editor's included. */
  onError: (error: EditFailureText | null) => void;
}) {
  const { t, lang } = useI18n();
  const r = t.editor.remove;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // One id per removal attempt: a retry after no answer finds the same result instead of a second one.
  const request = useRef<string | null>(null);
  const openButton = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  const questionId = useId();
  const elapsed = useElapsedSeconds(busy);
  const step = reviewStep(elapsed);
  const errorNote = useRef<HTMLParagraphElement>(null);
  const progressNote = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (wasConfirming.current && !confirming) openButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  // The message and the progress render at the bottom of the inspector, often below its fold.
  useEffect(() => {
    if (error) errorNote.current?.scrollIntoView({ block: "nearest" });
  }, [error]);
  useEffect(() => {
    if (busy) progressNote.current?.scrollIntoView({ block: "nearest" });
  }, [busy]);

  function cancel() {
    setConfirming(false);
    if (error) setError(null);
  }

  async function remove() {
    if (busy || locked) return;
    request.current ??= crypto.randomUUID();
    setBusy(true);
    onBusy(true);
    setError(null);
    try {
      const answer = await postEdit(projectId, runId, {
        cueId: cue.id,
        action: "remove",
        requestId: request.current,
      });
      if (answer.kind === "offline") {
        setError({ text: runErrorMessage({ code: "connection" }, t, lang) });
        return;
      }
      if (answer.kind === "refused") {
        if (answer.body?.error !== STILL_RUNNING) request.current = null;
        // The line's own room: a removal is never refused for its placement.
        const placement = { min: cue.start, max: cue.windowEnd, start: cue.start };
        setError(editErrorMessage(answer.body, placement, t, lang));
        return;
      }
      try {
        await onSaved(answer.runId, answer.runs);
      } catch (e) {
        console.error("line removed, but the new result did not load", e);
        setError({ text: t.editor.failed });
      }
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }

  return (
    <div className="remove-line">
      {confirming ? (
        <div
          className="remove-confirm"
          role="group"
          aria-labelledby={questionId}
          onKeyDown={(event) => {
            if (event.key !== "Escape" || event.nativeEvent.isComposing || locked) return;
            event.preventDefault();
            event.stopPropagation();
            cancel();
          }}
        >
          <p id={questionId}>{r.confirm}</p>
          <div className="remove-actions">
            {/* While the removal runs, this button keeps focus: marked disabled, not disabled. */}
            <button
              type="button"
              className="button danger"
              disabled={locked && !busy}
              aria-disabled={busy || undefined}
              onClick={remove}
            >
              {busy ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  {fill(r.removing[step], { elapsed: formatDuration(elapsed, lang) })}
                </>
              ) : (
                r.yes
              )}
            </button>
            <button
              type="button"
              className="button ghost"
              disabled={locked}
              autoFocus
              onClick={cancel}
            >
              {r.no}
            </button>
          </div>
          <p className="label edit-progress" role="status" ref={progressNote}>
            {busy ? r.progress[step] : null}
          </p>
        </div>
      ) : (
        <button
          type="button"
          className="button ghost"
          ref={openButton}
          disabled={locked}
          onClick={() => setConfirming(true)}
        >
          <span aria-hidden="true">−</span> {r.open}
        </button>
      )}
      {error ? (
        <p className="ws-error" role="alert" ref={errorNote}>
          <span aria-hidden="true">⚠ </span>
          {error.text}
        </p>
      ) : null}
    </div>
  );
}
