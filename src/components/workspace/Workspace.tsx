"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fill } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { fetchRun } from "@/lib/client/run-stream";
import { useLiveRun } from "@/lib/client/use-live-run";
import type { TimedRunEvent } from "@/lib/pipeline/events";
import { findGaps } from "@/lib/pipeline/gaps";
import { emptyRun, foldRun, reduceRun, STAGES, type RunView } from "@/lib/pipeline/reduce";
import type { Density, Language, SceneMap, SpeechSegment } from "@/lib/pipeline/schemas";
import type { Project, RunListing } from "@/lib/store/projects";
import { EditLine } from "./CueEditor";
import { LineDetail, StageList } from "./Inspector";
import { languageName, lineNumbers, sampleRunFigures } from "./labels";
import { LiveRunNotices, littleRoomOf } from "./LiveRunNotices";
import { Player, type PlayerHandle } from "./Player";
import { RunPanel } from "./RunPanel";
import { Coverage, Downloads, EditSummary, Metrics, QualityNote } from "./RunResult";
import { CuePicker, Timeline } from "./Timeline";
import { useRunLabels } from "./useRunLabels";
import { WorkspaceHeader } from "./WorkspaceHeader";

/** Replays squeeze a recorded run into about this many seconds, at one uniform speed. */
const REPLAY_TARGET_SECONDS = 24;
const MIN_REPLAY_SPEED = 4;
/** "Play from here" starts this long before the line, so its lead-in is heard. */
const PLAY_LEAD_IN_SECONDS = 1;

type Mode = "idle" | "live" | "replay";

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
  /** The run the empty panel's "the sample took … and cost …" line quotes (see sampleRunFigures). */
  measured: RunListing | null;
  initialRunId?: string;
}) {
  const { t, lang } = useI18n();
  const pinned = initialRuns.find((r) => r.runId === initialRunId);
  const [narration, setNarration] = useState<Language>((pinned?.language as Language) ?? lang);
  const [density, setDensity] = useState<Density>((pinned?.density as Density) ?? "standard");
  const [runs, setRuns] = useState(initialRuns);
  const [events, setEvents] = useState<TimedRunEvent[] | null>(null);
  const [view, setView] = useState<RunView | null>(null);
  // A run named in the address without a finished result is followed from the first render.
  const resuming = Boolean(initialRunId) && !pinned;
  const [mode, setMode] = useState<Mode>(resuming ? "live" : "idle");
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [chosenRunId, setChosenRunId] = useState<string | null>(initialRunId ?? null);
  const [announcement, setAnnouncement] = useState("");
  const player = useRef<PlayerHandle>(null);
  const timers = useRef<number[]>([]);
  const viewBeforeRun = useRef<RunView | null>(null);
  const { labels, notes } = useRunLabels(project.id, runs);

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

  useEffect(() => stopReplay, [stopReplay]);

  useEffect(() => {
    if (mode === "live") return;
    stopReplay();
    setMode("idle");
    setSelected(null);
    // A result that is still loading (or fails to load) must not keep the previous run's
    // media, downloads and editor under the newly selected version or language.
    setEvents(null);
    setView(null);
    setError(null);
    if (!current) return;
    let cancelled = false;
    fetchRun(project.id, current.runId)
      .then(({ events: loaded }) => {
        if (cancelled) return;
        setEvents(loaded);
        setView(foldRun(loaded, project.clipSeconds));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        console.error(e);
        setError(t.live.loadFailed);
      });
    return () => {
      cancelled = true;
    };
    // Reload only when the shown run changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.runId]);

  // Stage changes during a live run or a replay are announced once each, politely.
  const stageKey = view ? STAGES.map((s) => view.stages[s].state).join(",") : "";
  useEffect(() => {
    if (!view || mode === "idle") return;
    const running = STAGES.find((s) => view.stages[s].state === "running");
    const last = [...STAGES].reverse().find((s) => view.stages[s].state === "done");
    const stage = running ?? last;
    if (!stage) return;
    setAnnouncement(
      fill(t.workspace.stageAnnounce, {
        stage: t.stages[stage],
        state: running ? t.stages.runningState : t.stages.doneState,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stageKey, mode]);

  // Live runs: streamed, followed by polling when the stream drops, resumed from ?run= on reload.
  const live = useLiveRun({
    projectId: project.id,
    initialRunId,
    finishedRunIds: initialRuns.map((r) => r.runId),
    handlers: {
      onBegin: () => {
        viewBeforeRun.current = view;
        stopReplay();
        setMode("live");
        setError(null);
        setSelected(null);
        setView(emptyRun(project.clipSeconds));
      },
      onEvent: (event) => setView((v) => reduceRun(v ?? emptyRun(project.clipSeconds), event)),
      onEvents: (loaded) => {
        const started = loaded[0];
        if (started?.type === "run_started") {
          setNarration(started.language);
          setDensity(started.density);
        }
        setView(foldRun(loaded, project.clipSeconds));
      },
      onEnd: (list, finishedRunId, started) => {
        if (!started) setView(viewBeforeRun.current);
        if (list) setRuns(list);
        const finished = list?.find((r) => r.runId === finishedRunId);
        if (finished) {
          setNarration(finished.language as Language);
          setDensity(finished.density as Density);
          setChosenRunId(finished.runId);
        }
        setMode("idle");
      },
      onError: setError,
    },
  });

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

  // The whole saved run: a replay lists only the stages it goes through.
  const trace = useMemo(
    () => (events ? foldRun(events, project.clipSeconds) : null),
    [events, project.clipSeconds],
  );

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
  const numbers = useMemo(() => lineNumbers(shown?.cues ?? []), [shown?.cues]);
  const selectedCue = shown?.cues.find((c) => c.id === selected) ?? null;
  const busy = mode === "live" || editing;
  const cueLanguage = shown?.language ?? narration;
  const sceneEvidence = shown?.scene?.shots
    .filter((s) => selectedCue && selectedCue.start >= s.start && selectedCue.start < s.end)
    .map((s) => [s.setting, s.action, s.onScreenText].filter(Boolean).join(" · "))
    .join(" ");
  const parentRunId = final?.summary?.parentRunId;
  const littleRoom = littleRoomOf(view, shown, Boolean(analysis), project.clipSeconds);
  const editNote = final?.runId ? notes[final.runId] : null;

  function select(id: string) {
    if (editing) return;
    setSelected(id);
    setAnnouncement(
      fill(t.workspace.selected, { line: fill(t.line.title, { n: numbers.get(id) ?? id }) }),
    );
    const cue = shown?.cues.find((c) => c.id === id);
    if (cue) player.current?.seek(cue.start);
  }

  return (
    <div className="ws">
      <WorkspaceHeader project={project} />

      <main id="main" className="ws-main" tabIndex={-1}>
        <p className="sr-only" aria-live="polite">
          {announcement}
        </p>
        <div className="ws-left">
          <Player
            ref={player}
            originalUrl={media("clip.mp4")}
            posterUrl={media("poster.jpg")}
            describedUrl={describedUrl}
            cues={final?.cues ?? []}
            speech={shown?.speech ?? []}
            filmLanguage={project.filmLanguageCode}
            narrationLanguage={final?.language ?? null}
            lineNumbers={numbers}
            onTime={setTime}
          />

          {error ? (
            <p className="ws-error" role="alert">
              <span aria-hidden="true">⚠ </span>
              {error}
            </p>
          ) : null}

          {shown ? (
            <Timeline
              clipSeconds={project.clipSeconds}
              stripUrl={media("strip.jpg")}
              speech={shown.speech}
              gaps={shown.gaps}
              cues={shown.cues}
              lineNumbers={numbers}
              currentTime={time}
              selectedCueId={selected}
              disabled={editing}
              onSeek={(s) => player.current?.seek(s)}
              onSelect={select}
            />
          ) : null}
          {final?.cues.length ? (
            <CuePicker
              cues={final.cues}
              lineNumbers={numbers}
              language={cueLanguage}
              selectedCueId={selected}
              disabled={busy}
              onSelect={select}
            />
          ) : null}
          {final?.summary ? <Metrics summary={final.summary} /> : null}
          {final?.summary ? (
            <QualityNote
              summary={final.summary}
              gaps={final.gaps}
              cues={final.cues}
              language={final.language}
              lineNumbers={numbers}
              onSelect={select}
            />
          ) : null}
        </div>

        <aside className="ws-inspector">
          {selectedCue ? (
            <>
              <button
                type="button"
                className="button ghost small back"
                disabled={editing}
                onClick={() => setSelected(null)}
              >
                <span aria-hidden="true">←</span> {t.line.close}
              </button>
              <LineDetail
                cue={selectedCue}
                lineNumber={numbers.get(selectedCue.id) ?? 0}
                language={cueLanguage}
                evidence={sceneEvidence}
                editor={
                  final && mode === "idle" ? (
                    <EditLine
                      key={`${final.runId}-${selectedCue.id}`}
                      projectId={project.id}
                      runId={final.runId!}
                      cue={selectedCue}
                      cues={final.cues}
                      gaps={final.gaps}
                      language={cueLanguage}
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
                onPlay={() =>
                  player.current?.seek(Math.max(0, selectedCue.start - PLAY_LEAD_IN_SECONDS), true)
                }
              />
            </>
          ) : (
            <>
              <RunPanel
                runs={runs}
                labels={labels}
                current={current}
                narration={narration}
                density={density}
                mode={mode}
                busy={busy}
                canReplay={Boolean(events) && mode !== "live"}
                replaySpeed={replaySpeed}
                emptyHint={
                  measured?.summary
                    ? fill(
                        t.workspace.noRunHint,
                        sampleRunFigures(measured.language, measured.summary, lang),
                      )
                    : null
                }
                onChooseRun={setChosenRunId}
                onNarration={setNarration}
                onDensity={setDensity}
                onReplay={replay}
                onStopReplay={() => {
                  stopReplay();
                  if (events) setView(foldRun(events, project.clipSeconds));
                  setMode("idle");
                }}
                onGenerate={() => void live.start({ language: narration, density })}
              />
              <LiveRunNotices
                connection={live.connection}
                active={live.active}
                status={live.status}
                showStatus={mode !== "live" && !error}
                littleRoom={littleRoom}
                busy={busy}
                onFollow={live.follow}
              />
              {parentRunId && editNote ? (
                <EditSummary parent={labels.get(parentRunId) ?? parentRunId} note={editNote} />
              ) : null}
              {view && !parentRunId ? (
                <StageList
                  view={view}
                  trace={mode === "replay" ? trace : null}
                  clockRate={mode === "live" ? 1 : mode === "replay" ? replaySpeed : 0}
                />
              ) : null}
              {!view && !busy ? (
                <p className="empty">
                  {fill(t.workspace.noRun, { language: languageName(narration, lang) })}
                </p>
              ) : null}
              {/* A finished result shows the final check's list (QualityNote) instead. */}
              {view?.coverage.length && view.summary === null ? (
                <Coverage coverage={view.coverage} language={cueLanguage} />
              ) : null}
              {final ? <p className="label hint">{t.line.pickHint}</p> : null}
              {final?.files ? (
                <Downloads base={media(`runs/${final.runId}`)} files={final.files} />
              ) : null}
            </>
          )}
        </aside>
      </main>
    </div>
  );
}
