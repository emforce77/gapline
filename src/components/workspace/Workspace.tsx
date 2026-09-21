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

/** Replays squeeze a recorded run into about this many seconds, at one uniform speed. */
const REPLAY_TARGET_SECONDS = 24;
const MIN_REPLAY_SPEED = 4;

type Mode = "idle" | "live" | "replay";

function Metrics({ summary, view }: { summary: RunSummary; view: RunView }) {
  const { t, lang } = useI18n();
  const fixed = view.cues.filter(
    (c) => c.status === "fits" && c.versions.some((v) => v.review && !v.review.pass),
  ).length;
  const items = [
    [String(summary.cuesShipped), t.metrics.lines],
    [`${summary.cuesFitting}/${summary.cuesShipped}`, t.metrics.fit],
    [formatSeconds(summary.overlapWithSpeechSeconds, lang), t.metrics.overlap],
    [String(fixed), t.metrics.caught],
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
}: {
  project: Project;
  initialRuns: RunListing[];
  analysis: { speech: SpeechSegment[]; scene: SceneMap } | null;
  measured: RunSummary | null;
}) {
  const { t, lang } = useI18n();
  const [narration, setNarration] = useState<Language>(lang);
  const [density, setDensity] = useState<Density>("standard");
  const [runs, setRuns] = useState(initialRuns);
  const [events, setEvents] = useState<TimedRunEvent[] | null>(null);
  const [view, setView] = useState<RunView | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const player = useRef<PlayerHandle>(null);
  const timers = useRef<number[]>([]);

  const current =
    runs.find((r) => r.language === narration && r.density === density && r.summary) ?? null;

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
  const busy = mode === "live";
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
              onSelect={(id) => setSelected(id)}
            />
          ) : null}
          {final?.summary ? <Metrics summary={final.summary} view={final} /> : null}
        </div>

        <aside className="ws-inspector">
          <div className="run-panel">
            <div className="run-options">
              <div className="control">
                <span className="label">{t.workspace.narration}</span>
                <div className="segmented" role="group">
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
                <div className="segmented" role="group">
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
                onPlay={() => player.current?.seek(Math.max(0, selectedCue.start - 1), true)}
              />
            </>
          ) : (
            <>
              {view ? (
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
