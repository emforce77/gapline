"use client";

import { fill } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { Density, Language } from "@/lib/pipeline/schemas";
import type { RunListing } from "@/lib/store/projects";
import { orderRuns } from "./labels";
import styles from "./RunPanel.module.css";

type Mode = "idle" | "live" | "replay";

/** The version list's entry for a run being made, or one that ended without a result. */
const NEW_VERSION = "new";

/**
 * Which result is shown and how to make another. Once a result exists, playing it is the primary
 * action (in the player); generating again is a paid live run, so it stays secondary and says so.
 * While a run goes, Generate is marked disabled but keeps its focus, so a keyboard user stays where
 * they pressed and the label says why; while an edit is pending or a run cannot start (`blocked`),
 * it is disabled.
 */
export function RunPanel({
  runs,
  labels,
  current,
  unfinished,
  narration,
  density,
  mode,
  busy,
  blocked,
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
  /**
   * The page shows a run that ended without a result (stopped, or no longer answering): the list
   * marks it instead of `current`, so picking `current` opens that result again.
   */
  unfinished: boolean;
  narration: Language;
  density: Density;
  mode: Mode;
  busy: boolean;
  /** A run cannot start now: the viewer's own is still going, or today's allowance is spent. */
  blocked: boolean;
  canReplay: boolean;
  replaySpeed: number;
  /** Before any result for this setting: what a run of it took, said after the paid-API note. */
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
  const { t, lang } = useI18n();
  const shown = orderRuns(runs.filter((r) => r.language === narration && r.density === density));
  const live = mode === "live";
  // The version list's entry for a run that has no result to choose.
  const pending = live ? t.workspace.newVersion : unfinished ? t.workspace.unfinishedVersion : null;
  return (
    <div className="run-panel">
      {shown.length ? (
        <label className="result-picker">
          {t.editor.history}
          <select
            value={pending ? NEW_VERSION : (current?.runId ?? "")}
            disabled={busy || mode === "replay"}
            onChange={(e) => onChooseRun(e.target.value)}
          >
            <option value="" disabled>
              —
            </option>
            {pending ? (
              <option value={NEW_VERSION} disabled>
                {pending}
              </option>
            ) : null}
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
            {/* The page's language first, as on the landing. */}
            {([lang, lang === "en" ? "ko" : "en"] as Language[]).map((l) => (
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
          className={`${current ? "button ghost" : "button primary"} ${styles.generate}`}
          aria-disabled={live || undefined}
          disabled={blocked || mode === "replay" || (busy && !live)}
          onClick={() => {
            if (!busy) onGenerate();
          }}
        >
          {live ? (
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
      {current ? (
        <p className="label run-note">{t.workspace.liveNote}</p>
      ) : (
        <p className="label run-note">
          {emptyHint ? `${t.workspace.paidNote} ${emptyHint}` : t.workspace.paidNote}
        </p>
      )}
      {sample ? <p className="label run-note">{t.workspace.samplePrivate}</p> : null}
      {mode === "replay" ? (
        <p className="replay-badge">
          <span aria-hidden="true">▶▶</span> {fill(t.workspace.replaying, { speed: replaySpeed })}
        </p>
      ) : null}
    </div>
  );
}
