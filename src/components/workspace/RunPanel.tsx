"use client";

import { fill } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { Density, Language } from "@/lib/pipeline/schemas";
import type { RunListing } from "@/lib/store/projects";

type Mode = "idle" | "live" | "replay";

/**
 * Which result is shown and how to make another. Once a result exists, playing it is the primary
 * action (in the player); generating again is a paid live run, so it stays secondary and says so.
 */
export function RunPanel({
  runs,
  labels,
  current,
  narration,
  density,
  mode,
  busy,
  canReplay,
  replaySpeed,
  emptyHint,
  sample,
  onChooseRun,
  onNarration,
  onDensity,
  onReplay,
  onStopReplay,
  onGenerate,
}: {
  runs: RunListing[];
  labels: Map<string, string>;
  current: RunListing | null;
  narration: Language;
  density: Density;
  mode: Mode;
  busy: boolean;
  canReplay: boolean;
  replaySpeed: number;
  emptyHint: string | null;
  /** The shared sample: what this viewer generates or edits on it is theirs alone. */
  sample: boolean;
  onChooseRun: (runId: string) => void;
  onNarration: (language: Language) => void;
  onDensity: (density: Density) => void;
  onReplay: () => void;
  onStopReplay: () => void;
  onGenerate: () => void;
}) {
  const { t } = useI18n();
  const shown = runs.filter((r) => r.language === narration && r.density === density);
  return (
    <div className="run-panel">
      {shown.length ? (
        <label className="result-picker">
          {t.editor.history}
          <select
            value={current?.runId ?? ""}
            disabled={busy || mode === "replay"}
            onChange={(e) => onChooseRun(e.target.value)}
          >
            <option value="" disabled>
              —
            </option>
            {shown.map((r) => (
              <option key={r.runId} value={r.runId} title={r.runId}>
                {labels.get(r.runId)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="run-options">
        <div className="control">
          <span className="label" id="narration-label">
            {t.workspace.narration}
          </span>
          <div className="segmented" role="group" aria-labelledby="narration-label">
            {(["ko", "en"] as Language[]).map((l) => (
              <button
                key={l}
                type="button"
                lang={l}
                aria-pressed={narration === l}
                disabled={busy}
                onClick={() => onNarration(l)}
              >
                {new Intl.DisplayNames([l], { type: "language" }).of(l)}
              </button>
            ))}
          </div>
        </div>
        <div className="control">
          <span className="label" id="density-label">
            {t.workspace.density}
          </span>
          <div className="segmented" role="group" aria-labelledby="density-label">
            {(["standard", "brief"] as Density[]).map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={density === d}
                disabled={busy}
                onClick={() => onDensity(d)}
              >
                {d === "standard" ? t.workspace.densityStandard : t.workspace.densityBrief}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="run-actions">
        {canReplay ? (
          mode === "replay" ? (
            <button type="button" className="button" onClick={onStopReplay}>
              <span aria-hidden="true">■</span> {t.workspace.stopReplay}
            </button>
          ) : (
            <button type="button" className="button" onClick={onReplay}>
              <span aria-hidden="true">↺</span> {t.workspace.replay}
            </button>
          )
        ) : null}
        <button
          type="button"
          className={current ? "button ghost" : "button primary"}
          disabled={busy || mode === "replay"}
          onClick={onGenerate}
        >
          {busy ? (
            <>
              <span className="spinner" aria-hidden="true" /> {t.workspace.generating}
            </>
          ) : current ? (
            t.workspace.regenerate
          ) : (
            t.workspace.generate
          )}
        </button>
      </div>
      {current ? <p className="label run-note">{t.workspace.liveNote}</p> : null}
      {!current && emptyHint ? <p className="label run-note">{emptyHint}</p> : null}
      {sample ? <p className="label run-note">{t.workspace.samplePrivate}</p> : null}
      {mode === "replay" ? (
        <p className="replay-badge">
          <span aria-hidden="true">▶▶</span> {fill(t.workspace.replaying, { speed: replaySpeed })}
        </p>
      ) : null}
    </div>
  );
}
