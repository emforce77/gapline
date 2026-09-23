"use client";
import { useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { runErrorMessage } from "@/lib/client/api-errors";
import type { Cue, Gap, Language } from "@/lib/pipeline/schemas";
import { editErrorMessage, type EditFailureText } from "./edit-errors";
import { postEdit } from "./edit-request";
import { RemoveLine } from "./RemoveLine";

export interface EditorProps {
  projectId: string;
  runId: string;
  cue: Cue;
  cues: Cue[];
  gaps: Gap[];
  /** The run's narration language: the reviewer's reasons for a rejected edit are written in it. */
  language: Language | null;
  onSaved: (runId: string) => Promise<void>;
  onBusy: (busy: boolean) => void;
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

/**
 * "Edit this line", folded until the editor asks for it, so the review history reads first. A line
 * in the track can also be removed from here; while either request runs, both are locked.
 */
export function EditLine(props: EditorProps) {
  const { t } = useI18n();
  const [locked, setLocked] = useState(false);
  const state = editState(props.cue, props.cues, props.gaps);
  if (state === "none") return null;
  if (state === "legacy") return <p className="label">{t.editor.legacy}</p>;
  const onBusy = (busy: boolean) => {
    setLocked(busy);
    props.onBusy(busy);
  };
  return (
    <details className="edit-line">
      <summary className="button">{t.editor.title}</summary>
      <CueEditor {...props} onBusy={onBusy} locked={locked} />
      {props.cue.status === "fits" ? (
        <RemoveLine
          projectId={props.projectId}
          runId={props.runId}
          cue={props.cue}
          onSaved={props.onSaved}
          onBusy={onBusy}
          locked={locked}
        />
      ) : null}
    </details>
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
}: EditorProps & { locked: boolean }) {
  const { t, lang } = useI18n();
  const [text, setText] = useState(cue.versions.at(-1)!.text);
  const [start, setStart] = useState(String(cue.start));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<EditFailureText | null>(null);
  const request = useRef<{ value: string; id: string } | null>(null);
  const gap = gaps.find((g) => g.id === cue.gapId)!;
  const peers = cues
    .filter((c) => (c.status === "fits" || c.id === cue.id) && c.gapId === cue.gapId)
    .sort((a, b) => a.start - b.start);
  const index = peers.findIndex((c) => c.id === cue.id);
  const previous = peers[index - 1];
  const min = Math.max(gap.start, previous ? previous.start + previous.seconds! : 0);
  const max = Math.min(gap.end, peers[index + 1]?.start ?? Infinity);
  // A removed line goes back with its own words; any other line needs a change to be worth a request.
  const unchanged =
    cue.status !== "removed" &&
    text.trim() === cue.versions.at(-1)!.text &&
    Number(start) === cue.start;
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
          if (answer.kind === "offline") {
            setError({ text: runErrorMessage({ code: "connection" }, t, lang) });
            return;
          }
          if (answer.kind === "refused") {
            setError(editErrorMessage(answer.body, { min, max, start: Number(start) }, t, lang));
            return;
          }
          try {
            await onSaved(answer.runId);
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
      {cue.status === "removed" ? <p className="label">{t.editor.restoreHint}</p> : null}
      <label>
        {t.editor.text}
        <textarea
          name="text"
          value={text}
          maxLength={2000}
          required
          disabled={locked}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <label>
        {t.editor.start}
        <input
          name="start"
          type="number"
          min={min}
          max={max}
          step="any"
          required
          value={start}
          disabled={locked}
          onChange={(e) => setStart(e.target.value)}
        />
      </label>
      <p className="label mono">
        {min.toFixed(2)} ≤ t &lt; {max.toFixed(2)}
      </p>
      <p className="label">{t.editor.hint}</p>
      <button
        className="button primary"
        type="submit"
        disabled={locked || !text.trim() || unchanged}
      >
        {busy ? t.editor.saving : t.editor.save}
      </button>
      {error ? (
        <p className="ws-error" role="alert">
          {error.text}
          {error.reviewer ? (
            <>
              {" "}
              <span lang={language ?? undefined}>{error.reviewer}</span>
            </>
          ) : null}
        </p>
      ) : null}
    </form>
  );
}
