"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LanguageToggle } from "@/components/LanguageToggle";
import { fill } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { fetchRunEvents, streamRun } from "@/lib/client/run-stream";
import { formatDuration, formatSeconds, formatUsd } from "@/lib/format";
import type { RunSummary, TimedRunEvent } from "@/lib/pipeline/events";
import { findGaps } from "@/lib/pipeline/gaps";
import { emptyRun, foldRun, reduceRun, type RunView } from "@/lib/pipeline/reduce";
import type { Density, Language, SceneMap, SpeechSegment } from "@/lib/pipeline/schemas";
import type { Project, RunListing } from "@/lib/store/projects";
import { LineDetail, StageList } from "./Inspector";
import { Player, type PlayerHandle } from "./Player";
import { Timeline } from "./Timeline";
import { CueEditor } from "./CueEditor";

/** Replays squeeze a recorded run into about this many seconds, at one uniform speed. */
const REPLAY_TARGET_SECONDS = 24;
const MIN_REPLAY_SPEED = 4;

type Mode = "idle" | "live" | "replay";

function Metrics({ summary }: { summary: RunSummary }) {
  const { t, lang } = useI18n();
  const items = [
    [String(summary.cuesShipped), t.metrics.lines],
    [`${summary.cuesFitting}/${summary.cuesShipped}`, t.metrics.fit],
    [formatSeconds(summary.overlapWithSpeechSeconds, lang), t.metrics.overlap],
    [String(summary.cuesRejected), t.metrics.caught],
    [formatUsd(summary.costUsd, lang), t.metrics.cost],
    [formatDuration(summary.wallSeconds, lang), t.metrics.time],
  ];
  return (
    <dl className="metrics">
      {items.map(([value, label]) => (
        <div key={label}>
          <dd>{value}</dd>
          <dt>{label}</dt>
        </div>
      ))}
    </dl>
  );
}

export function Workspace({
  project,
  initialRuns,
  analysis,
  measured,
  initialRunId,
}: {
  project: Project;
  initialRuns: RunListing[];
  analysis: { speech: SpeechSegment[]; scene: SceneMap } | null;
  measured: RunSummary | null;
  initialRunId?: string;
}) {
  const { t, lang } = useI18n();
  const pinned = initialRuns.find((r) => r.runId === initialRunId);
  const [narration, setNarration] = useState<Language>((pinned?.language as Language) ?? lang);
  const [density, setDensity] = useState<Density>((pinned?.density as Density) ?? "standard");
  const [runs, setRuns] = useState(initialRuns);
  const [events, setEvents] = useState<TimedRunEvent[] | null>(null);
  const [view, setView] = useState<RunView | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [chosenRunId, setChosenRunId] = useState<string | null>(initialRunId ?? null);
  const player = useRef<PlayerHandle>(null);
  const timers = useRef<number[]>([]);

  const current =
    runs.find(
      (r) => r.runId === chosenRunId && r.language === narration && r.density === density,
    ) ??
    runs.find((r) => r.language === narration && r.density === density && r.summary) ??
    null;

  const stopReplay = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);

  useEffect(() => {
    if (mode === "live") return;
    stopReplay();
    setMode("idle");
    setSelected(null);
    if (!current) {
      setEvents(null);
      setView(null);
      return;
    }
    let cancelled = false;
    fetchRunEvents(project.id, current.runId)
      .then((loaded) => {
        if (cancelled) return;
        setEvents(loaded);
        setView(foldRun(loaded, project.clipSeconds));
      })
      .catch((e: unknown) => {
        console.error(e);
        setError(fill(t.workspace.runFailed, { error: String(e) }));
      });
    return () => {
      cancelled = true;
    };
    // Reload only when the shown run changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.runId]);

  async function generate() {
    stopReplay();
    setMode("live");
    setError(null);
    setSelected(null);
    setView(emptyRun(project.clipSeconds));
    try {
      await streamRun(project.id, { language: narration, density }, (event) => {
        setView((v) => reduceRun(v ?? emptyRun(project.clipSeconds), event));
        if (event.type === "run_failed") {
          setError(
            event.error === "budget"
              ? t.workspace.budgetExhausted
              : fill(t.workspace.runFailed, { error: event.error }),
          );
        }
      });
    } catch (e) {
      console.error(e);
      setError(fill(t.workspace.runFailed, { error: String(e) }));
    } finally {
      const response = await fetch(`/api/projects/${project.id}/runs`);
      if (response.ok) setRuns(((await response.json()) as { runs: RunListing[] }).runs);
      setMode("idle");
    }
  }

  function replay() {
    if (!events) return;
    stopReplay();
    setSelected(null);
    const replayed = events.filter((e) => e.type !== "writer_delta");
    const lastT = replayed[replayed.length - 1]?.t ?? 0;
    const speed = Math.max(MIN_REPLAY_SPEED, Math.ceil(lastT / REPLAY_TARGET_SECONDS));
    setReplaySpeed(speed);
    setMode("replay");
    setView(emptyRun(project.clipSeconds));
    for (const event of replayed) {
      timers.current.push(
        window.setTimeout(
          () => setView((v) => reduceRun(v ?? emptyRun(project.clipSeconds), event)),
          (event.t / speed) * 1000,
        ),
      );
    }
    timers.current.push(window.setTimeout(() => setMode("idle"), (lastT / speed) * 1000 + 400));
  }

  // Before any run, the timeline still shows the picture, the dialogue and the room from the analysis.
  const shown = useMemo<RunView | null>(() => {
    if (view) return view;
    if (!analysis) return null;
    const base = emptyRun(project.clipSeconds);
    return {
      ...base,
      speech: analysis.speech,
      scene: analysis.scene,
      gaps: findGaps(
        { speech: analysis.speech, sounds: analysis.scene.sounds },
        project.clipSeconds,
      ),
    };
  }, [view, analysis, project.clipSeconds]);

  const final = view?.files && view.runId && mode !== "replay" ? view : null;
  const media = (file: string) => `/api/projects/${project.id}/media/${file}`;
  const describedUrl = final ? media(`runs/${final.runId}/${final.files!.described}`) : null;
  const selectedCue = shown?.cues.find((c) => c.id === selected) ?? null;
  const busy = mode === "live" || editing;
  const sceneEvidence = shown?.scene?.shots
    .filter((s) => selectedCue && selectedCue.start >= s.start && selectedCue.start < s.end)
    .map((s) => [s.setting, s.action, s.onScreenText].filter(Boolean).join(" · "))
    .join(" ");
  const languageName = narration === "ko" ? "한국어" : "English";

  return (
    <div className="ws">
      <header className="ws-header">
        <Link href="/" className="wordmark">
          {t.nav.home}
        </Link>
        <div className="ws-title">
          <h1>{project.title}</h1>
          {project.attribution ? (
            <span className="label">
              {project.attribution} · {project.license}
            </span>
          ) : null}
        </div>
        <LanguageToggle lang={lang} label={t.nav.language} />
      </header>

      <div className="ws-main">
        <div className="ws-left">
          <Player
            ref={player}
            originalUrl={media("clip.mp4")}
            posterUrl={media("poster.jpg")}
            describedUrl={describedUrl}
            cues={final?.cues ?? []}
            onTime={setTime}
          />

          {error ? (
            <p className="ws-error" role="alert">
              ⚠ {error}
            </p>
          ) : null}

          {shown ? (
            <Timeline
              clipSeconds={project.clipSeconds}
              stripUrl={media("strip.jpg")}
              speech={shown.speech}
              gaps={shown.gaps}
              cues={shown.cues}
              currentTime={time}
              selectedCueId={selected}
              onSeek={(s) => player.current?.seek(s)}
              onSelect={(id) => {
                setSelected(id);
                const cue = shown.cues.find((c) => c.id === id);
                if (cue) player.current?.seek(cue.start);
              }}
            />
          ) : null}
          {final?.cues.length ? (
            <label className="cue-picker">
              {t.editor.chooseLine}
              <select
                aria-label={t.editor.chooseLine}
                value={selected ?? ""}
                disabled={busy}
                onChange={(event) => {
                  const id = event.target.value;
                  setSelected(id);
                  const cue = final.cues.find((c) => c.id === id);
                  if (cue) player.current?.seek(cue.start);
                }}
              >
                <option value="" disabled>
                  —
                </option>
                {final.cues.map((cue) => (
                  <option key={cue.id} value={cue.id}>
                    {cue.id} · {cue.versions.at(-1)!.text}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {final?.summary ? <Metrics summary={final.summary} /> : null}
          {final?.summary ? (
            <div className="quality-note" role="status">
              <strong>
                {final.summary.qualityStatus === "model_checked"
                  ? t.editor.checked
                  : final.summary.qualityStatus === "review_needed"
                    ? t.editor.reviewNeeded
                    : t.editor.unchecked}
              </strong>
              {final.summary.costStatus === "unresolved" ? <p>{t.editor.uncertainty}</p> : null}
              {final.summary.finalReview ? (
                <ul>
                  {final.summary.finalReview.missing.map((m, i) => (
                    <li key={`m${i}`}>
                      {m.at.toFixed(1)}s · {m.what}
                    </li>
                  ))}
                  {final.summary.finalReview.verdicts
                    .filter((v) => !v.pass)
                    .map((v) => (
                      <li key={v.cueId}>
                        <button className="button ghost small" onClick={() => setSelected(v.cueId)}>
                          {v.cueId}
                        </button>{" "}
                        {v.fix}
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <aside className="ws-inspector">
          <div className="run-panel">
            {runs.length ? (
              <label className="result-picker">
                {t.editor.history}
                <select
                  aria-label={t.editor.history}
                  value={current?.runId ?? ""}
                  disabled={busy || mode === "replay"}
                  onChange={(e) => setChosenRunId(e.target.value)}
                >
                  <option value="" disabled>
                    —
                  </option>
                  {runs
                    .filter((r) => r.language === narration && r.density === density)
                    .map((r) => (
                      <option key={r.runId} value={r.runId}>
                        {r.summary?.parentRunId ? t.editor.edited : t.editor.original} · {r.runId}
                      </option>
                    ))}
                </select>
              </label>
            ) : null}
            <div className="run-options">
              <div className="control">
                <span className="label">{t.workspace.narration}</span>
                <div className="segmented" role="group" aria-label={t.workspace.narration}>
                  {(["ko", "en"] as Language[]).map((l) => (
                    <button
                      key={l}
                      type="button"
                      aria-pressed={narration === l}
                      disabled={busy}
                      onClick={() => setNarration(l)}
                    >
                      {l === "ko" ? "한국어" : "English"}
                    </button>
                  ))}
                </div>
              </div>
              <div className="control">
                <span className="label">{t.workspace.density}</span>
                <div className="segmented" role="group" aria-label={t.workspace.density}>
                  {(["standard", "brief"] as Density[]).map((d) => (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={density === d}
                      disabled={busy}
                      onClick={() => setDensity(d)}
                    >
                      {d === "standard" ? t.workspace.densityStandard : t.workspace.densityBrief}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="run-actions">
              {events && mode !== "live" ? (
                mode === "replay" ? (
                  <button
                    type="button"
                    className="button"
                    onClick={() => {
                      stopReplay();
                      setView(foldRun(events, project.clipSeconds));
                      setMode("idle");
                    }}
                  >
                    ■ {t.workspace.stopReplay}
                  </button>
                ) : (
                  <button type="button" className="button" onClick={replay}>
                    ↺ {t.workspace.replay}
                  </button>
                )
              ) : null}
              <button
                type="button"
                className="button primary"
                disabled={busy || mode === "replay"}
                onClick={() => void generate()}
              >
                {busy ? (
                  <>
                    <span className="spinner" /> {t.workspace.generating}
                  </>
                ) : current ? (
                  t.workspace.regenerate
                ) : (
                  t.workspace.generate
                )}
              </button>
            </div>
            {mode === "replay" ? (
              <p className="replay-badge">
                ▶▶ {fill(t.workspace.replaying, { speed: replaySpeed })}
              </p>
            ) : null}
          </div>
          {selectedCue ? (
            <>
              <button
                type="button"
                className="button ghost small back"
                onClick={() => setSelected(null)}
              >
                ← {t.line.close}
              </button>
              <LineDetail
                cue={selectedCue}
                evidence={sceneEvidence}
                editor={
                  final && mode === "idle" ? (
                    <CueEditor
                      key={`${final.runId}-${selectedCue.id}`}
                      projectId={project.id}
                      runId={final.runId!}
                      cue={selectedCue}
                      cues={final.cues}
                      gaps={final.gaps}
                      onBusy={setEditing}
                      onSaved={async (id) => {
                        const response = await fetch(`/api/projects/${project.id}/runs`);
                        if (!response.ok) throw new Error(t.editor.failed);
                        setRuns((await response.json()).runs);
                        setChosenRunId(id);
                      }}
                    />
                  ) : null
                }
                onPlay={() => player.current?.seek(Math.max(0, selectedCue.start - 1), true)}
              />
            </>
          ) : (
            <>
              {view && !final?.summary?.parentRunId ? (
                <StageList
                  view={view}
                  clockRate={mode === "live" ? 1 : mode === "replay" ? replaySpeed : 0}
                />
              ) : null}
              {!view && !busy ? (
                <div className="empty">
                  <p>{fill(t.workspace.noRun, { language: languageName })}</p>
                  {measured ? (
                    <p className="label">
                      {fill(t.workspace.noRunHint, {
                        time: formatDuration(measured.wallSeconds, lang),
                        cost: formatUsd(measured.costUsd, lang),
                      })}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {view?.coverage.length ? (
                <div className="coverage">
                  <h4>{t.coverage.title}</h4>
                  <ul>
                    {view.coverage
                      .flatMap((c) => c.missing)
                      .map((m, i) => (
                        <li key={i}>
                          <span className="mono label">{m.at.toFixed(1)}s</span> {m.what}
                        </li>
                      ))}
                  </ul>
                </div>
              ) : null}
              {final ? <p className="label hint">{t.line.pickHint}</p> : null}
              {final?.files ? (
                <div className="downloads">
                  <h4>{t.workspace.downloads}</h4>
                  <a href={`${media(`runs/${final.runId}/${final.files.described}`)}?download=1`}>
                    {t.workspace.downloadDescribed}
                  </a>
                  <a href={`${media(`runs/${final.runId}/${final.files.narration}`)}?download=1`}>
                    {t.workspace.downloadNarration}
                  </a>
                  <a href={`${media(`runs/${final.runId}/${final.files.vtt}`)}?download=1`}>
                    {t.workspace.downloadVtt}
                  </a>
                  <a href={`${media(`runs/${final.runId}/${final.files.script}`)}?download=1`}>
                    {t.workspace.downloadScript}
                  </a>
                </div>
              ) : null}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
