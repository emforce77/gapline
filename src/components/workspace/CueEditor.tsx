"use client";
import { useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { Cue, Gap } from "@/lib/pipeline/schemas";

export function CueEditor({
  projectId,
  runId,
  cue,
  cues,
  gaps,
  onSaved,
  onBusy,
}: {
  projectId: string;
  runId: string;
  cue: Cue;
  cues: Cue[];
  gaps: Gap[];
  onSaved: (runId: string) => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useI18n();
  const [text, setText] = useState(cue.versions.at(-1)!.text);
  const [start, setStart] = useState(String(cue.start));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ value: string; id: string } | null>(null);
  const gap = gaps.find((g) => g.id === cue.gapId);
  const peers = cues
    .filter((c) => (c.status === "fits" || c.id === cue.id) && c.gapId === cue.gapId)
    .sort((a, b) => a.start - b.start);
  const index = peers.findIndex((c) => c.id === cue.id);
  const previous = peers[index - 1];
  const min = Math.max(gap?.start ?? 0, previous ? previous.start + previous.seconds! : 0);
  const max = Math.min(gap?.end ?? cue.windowEnd, peers[index + 1]?.start ?? Infinity);
  if (!gap || (cue.status !== "fits" && cue.status !== "dropped")) return null;
  if (cues.some((c) => c.status === "fits" && !c.audioFile))
    return <p className="label">{t.editor.legacy}</p>;
  return (
    <form
      className="cue-editor"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const value = JSON.stringify([text.trim(), Number(start)]);
        if (request.current?.value !== value) request.current = { value, id: crypto.randomUUID() };
        setBusy(true);
        onBusy(true);
        setError(null);
        try {
          const response = await fetch(`/api/projects/${projectId}/runs/${runId}/edits`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cueId: cue.id,
              text,
              start: Number(start),
              requestId: request.current.id,
            }),
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.message ?? t.editor.failed);
          await onSaved(result.runId);
        } catch (e) {
          setError(e instanceof Error ? e.message : t.editor.failed);
        } finally {
          setBusy(false);
          onBusy(false);
        }
      }}
    >
      <h4>{t.editor.title}</h4>
      <label>
        {t.editor.text}
        <textarea
          name="text"
          value={text}
          maxLength={2000}
          required
          disabled={busy}
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
          disabled={busy}
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
        disabled={
          busy ||
          !text.trim() ||
          (text.trim() === cue.versions.at(-1)!.text && Number(start) === cue.start)
        }
      >
        {busy ? t.editor.saving : t.editor.save}
      </button>
      {error ? (
        <p className="ws-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
