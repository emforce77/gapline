"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { fill } from "@/i18n";
import { useI18n } from "@/i18n/client";
import {
  fetchFinishedRun,
  fetchRunList,
  findSavedRun,
  READ_RETRY_DELAYS_MS,
} from "@/lib/client/run-stream";
import { liveStatusNotice } from "@/lib/client/api-errors";
import { pinRunInUrl, pinSettingInUrl, runInUrl, unpinRunInUrl } from "@/lib/client/run-url";
import { useLiveRun } from "@/lib/client/use-live-run";
import { usePendingEdit } from "@/lib/client/use-pending-edit";
import type { TimedRunEvent } from "@/lib/pipeline/events";
import { findGaps } from "@/lib/pipeline/gaps";
import {
  emptyRun,
  foldRun,
  interruptRun,
  loseRun,
  reduceRun,
  type RunView,
} from "@/lib/pipeline/reduce";
import type { Density, Language, SceneMap, SpeechSegment } from "@/lib/pipeline/schemas";
import type { Project, RunListing } from "@/lib/store/projects";
import { runFinishedAnnouncement, stageAnnouncement } from "./announcements";
import { EditLine } from "./CueEditor";
import { LineDetail, StageList } from "./Inspector";
import { languageName, lineNumbers, sampleRunFigures } from "./labels";
import { LinePicker } from "./LinePicker";
import { LiveRunNotices, littleRoomOf } from "./LiveRunNotices";
import { Player, type PlayerHandle } from "./Player";
import {
  isOlderSnapshot,
  listAfterRun,
  settingKey,
  shownRun,
  type ShownSnapshot,
} from "./run-choice";
import { RunAlert, type Alert } from "./RunAlert";
import { RunPanel } from "./RunPanel";
import { Coverage, Downloads, EditSummary, Metrics, QualityNote } from "./RunResult";
import { Timeline } from "./Timeline";
import { useAnnouncer } from "./use-announcer";
import { useRunLabels } from "./useRunLabels";
import { WorkspaceHeader } from "./WorkspaceHeader";

/** Replays squeeze a recorded run into about this many seconds, at one uniform speed. */
const REPLAY_TARGET_SECONDS = 24;
const MIN_REPLAY_SPEED = 4;
/** "Play from here" starts this long before the line, so its lead-in is heard. */
const PLAY_LEAD_IN_SECONDS = 1;
/**
 * Waits before each new read of a listed result that came back unfinished: about a minute in all,
 * as long as another instance's storage view can lag (its 60 s metadata cache). A busy answer is
 * retried for about seven seconds (READ_RETRY_DELAYS_MS) before the page says so.
 */
const STALE_RUN_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

type Mode = "idle" | "live" | "replay";

export function Workspace({
  project,
  initialRuns,
  analysis,
  measured,
  measuredHere,
  initialRunId,
  initialSetting,
  initialResult,
  missingRunId,
  pins,
}: {
  project: Project;
  initialRuns: RunListing[];
  analysis: { speech: SpeechSegment[]; scene: SceneMap } | null;
  /** The run the empty panel's "… took … and cost …" line quotes (see sampleRunFigures). */
  measured: RunListing | null;
  /** `measured` is this clip's own run; otherwise it is the sample's. */
  measuredHere: boolean;
  /** A finished result to open on, or a run of this viewer's that has not finished (followed). */
  initialRunId?: string;
  /** The narration language and density the address names (?narration=&density=), without a run. */
  initialSetting?: { language?: Language; density?: Density };
  /**
   * The saved events of the result the page opens on, read with the page, so it shows (and its
   * described film loads) without a fetch first. Ignored unless it is the result shown.
   */
  initialResult?: { runId: string; events: TimedRunEvent[] };
  /** The ?run= of the link, when it names nothing this viewer can open. */
  missingRunId?: string;
  /** The sample's pinned run per narration language: the default result for that language. */
  pins: Record<string, string>;
}) {
  const { t, lang } = useI18n();
  const pinned = initialRuns.find((r) => r.runId === initialRunId);
  const [narration, setNarration] = useState<Language>(
    (pinned?.language as Language) ?? initialSetting?.language ?? lang,
  );
  const [density, setDensity] = useState<Density>(
    (pinned?.density as Density) ?? initialSetting?.density ?? "standard",
  );
  const [runs, setRuns] = useState(initialRuns);
  // The version shown for each narration language and density (settingKey), once one is chosen.
  const [chosen, setChosen] = useState<Record<string, string>>(
    pinned ? { [settingKey(pinned)]: pinned.runId } : {},
  );
  // The result opened on, when its events came with the page (first render: the initial setting).
  const [events, setEvents] = useState<TimedRunEvent[] | null>(() =>
    initialResult &&
    shownRun(initialRuns, { language: narration, density }, chosen, pins)?.runId ===
      initialResult.runId
      ? initialResult.events
      : null,
  );
  const [view, setView] = useState<RunView | null>(() =>
    events ? foldRun(events, project.clipSeconds) : null,
  );
  // The finished result shown before a live run began: it stays playable until the new one is ready.
  const [held, setHeld] = useState<RunView | null>(null);
  // A run named in the address without a finished result is followed from the first render.
  const resuming = Boolean(initialRunId) && !pinned;
  const [mode, setMode] = useState<Mode>(resuming ? "live" : "idle");
  const [replaySpeed, setReplaySpeed] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const [time, setTime] = useState(0);
  const [error, setError] = useState<Alert | null>(
    missingRunId ? { message: t.live.notFound, ownFailure: false } : null,
  );
  const [editing, setEditing] = useState(false);
  // Edits found after a reload that have since ended; the run list is not read again for them.
  const [settledEdits, setSettledEdits] = useState<string[]>([]);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const { announcement, announce } = useAnnouncer();
  const player = useRef<PlayerHandle>(null);
  const stageList = useRef<HTMLOListElement>(null);
  const timers = useRef<number[]>([]);
  // Counts live runs begun on this page. A shown result's fetch that resolves after one began
  // must not replace the live view with the old run's stages.
  const liveRuns = useRef(0);
  // The followed run's saved events so far, and how much of it is on screen (polls can lag).
  const liveEvents = useRef<TimedRunEvent[]>([]);
  const liveShown = useRef<ShownSnapshot>({ events: 0, done: false });
  // The line to open again once a saved edit's result has loaded.
  const reselect = useRef<string | null>(null);
  const pickHint = useId();
  const { labels, notes } = useRunLabels(project.id, runs);

  const current = shownRun(runs, { language: narration, density }, chosen, pins);
  // What the address names: the result shown, or the narration language and density shown when
  // they have no result yet, so a reload or a link opens the same choice.
  const shownKey = current?.runId ?? settingKey({ language: narration, density });
  // The result or setting the address names (or, with no ?run=, the one it opens on): the address
  // is written only when what is shown changes.
  const pinnedInUrl = useRef<string | null>(resuming ? initialRunId! : shownKey);
  // The result being fetched, or fetched, to play while a run is made (held), when none was loaded.
  const holding = useRef<string | null>(null);

  /** Shows `run` for its narration language and density from now on. */
  const choose = useCallback((run: { runId: string; language: string; density: string }) => {
    setChosen((c) => ({ ...c, [settingKey(run)]: run.runId }));
  }, []);

  const stopReplay = useCallback(() => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  }, []);

  useEffect(() => stopReplay, [stopReplay]);

  // A link to a run the server could not find: say so (the alert) and stop naming it. After Back
  // or Forward the props can predate the address, so a finished run the address names is shown.
  useEffect(() => {
    if (missingRunId) {
      unpinRunInUrl();
      return;
    }
    const named = runs.find((r) => r.runId === runInUrl());
    if (!named || named.runId === initialRunId) return;
    pinnedInUrl.current = named.runId;
    setNarration(named.language as Language);
    setDensity(named.density as Density);
    choose(named);
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The address names the result on screen, or the setting chosen when it has none, so a reload, a
  // bookmark or a shared link comes back to it. A live run names itself (use-live-run); a run that
  // stopped keeps its name until another result or setting is shown, so reloading shows why it
  // stopped.
  useEffect(() => {
    if (mode === "live" || shownKey === pinnedInUrl.current) return;
    pinnedInUrl.current = shownKey;
    if (current) pinRunInUrl(current.runId);
    else pinSettingInUrl({ language: narration, density });
    // Only when what is shown changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownKey]);

  useEffect(() => {
    if (mode === "live") return;
    // A result the page holds whole (a run that just finished here) is not read again.
    if (current && view?.runId === current.runId && view.summary && events) return;
    stopReplay();
    setMode("idle");
    setSelected(null);
    // A result that is still loading (or fails to load) must not keep the previous run's
    // media, downloads and editor under the newly selected version or language. The same result,
    // played while a run was made (opened again after the run stopped), plays on as it loads.
    setEvents(null);
    setView(null);
    setHeld((h) => (h && h.runId === current?.runId ? h : null));
    holding.current = null;
    setError((e) => (e && (e.ownFailure || e.lostRunId || e.reload) ? null : e));
    if (!current) return;
    let cancelled = false;
    const begun = liveRuns.current;
    const reopen = reselect.current;
    reselect.current = null;
    fetchFinishedRun(project.id, current.runId, STALE_RUN_RETRY_DELAYS_MS)
      .then((loaded) => {
        if (cancelled || liveRuns.current !== begun) return;
        const folded = foldRun(loaded, project.clipSeconds);
        setEvents(loaded);
        setView(folded);
        // After a save, the edited line opens again in its new version.
        if (reopen && folded.cues.some((c) => c.id === reopen)) setSelected(reopen);
      })
      .catch((e: unknown) => {
        if (cancelled || liveRuns.current !== begun) return;
        console.error(e);
        setError({ message: t.live.loadFailed, ownFailure: false, reload: true });
      });
    return () => {
      cancelled = true;
    };
    // Reload only when the shown run changes, or when asked to (loadAttempt).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.runId, loadAttempt]);

  // A live run's progress is announced politely, as where it is now (stageAnnouncement); the alert
  // under the player says why a run stopped and what next, and its end is said with its result
  // (onEnd). A replay says only that it started and ended.
  const said = view && mode === "live" ? stageAnnouncement(view, t, lang) : null;
  useEffect(() => {
    if (said) announce(said.text, said.settle);
    // Once per change of where the run is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [said?.text]);

  /**
   * Fetches `runId`'s result to play while a run is made or after it stopped (held), when the page
   * had not loaded it. A later load of the shown result, or a run's new result, makes it moot.
   */
  function holdResult(runId: string) {
    if (holding.current === runId) return;
    holding.current = runId;
    fetchFinishedRun(project.id, runId, STALE_RUN_RETRY_DELAYS_MS)
      .then((loaded) => {
        if (holding.current === runId) setHeld(foldRun(loaded, project.clipSeconds));
      })
      .catch((e: unknown) => {
        if (holding.current === runId) holding.current = null;
        console.error(`result ${runId} to play during a run did not load`, e);
      });
  }

  // Live runs: streamed, followed by polling when the stream drops, resumed from ?run= on reload.
  const live = useLiveRun({
    projectId: project.id,
    initialRunId: resuming ? initialRunId : undefined,
    ignoredRunId: missingRunId,
    finishedRunIds: initialRuns.map((r) => r.runId),
    handlers: {
      onBegin: () => {
        liveRuns.current += 1;
        liveEvents.current = [];
        liveShown.current = { events: 0, done: false };
        // What plays while the new run is made: the finished result on screen (a replay's whole run),
        // else the one played before (a retry), else the chosen version, fetched now (a run followed
        // after a reload, or begun while the result was still loading).
        const onScreen = mode === "replay" && events ? foldRun(events, project.clipSeconds) : view;
        if (onScreen?.files) {
          holding.current = null;
          setHeld(onScreen);
        } else if (!held?.files && current) holdResult(current.runId);
        stopReplay();
        setMode("live");
        setError(null);
        setSelected(null);
        setView(emptyRun(project.clipSeconds));
      },
      onEvent: (event) => {
        if (event.type !== "writer_delta") {
          liveEvents.current.push(event);
          liveShown.current = {
            events: liveEvents.current.length,
            done: liveShown.current.done || event.type === "run_done",
          };
        }
        setView((v) => reduceRun(v ?? emptyRun(project.clipSeconds), event));
      },
      onEvents: (loaded, status) => {
        // A poll answered by a lagging read must not take the page back to an earlier stage.
        if (isOlderSnapshot(liveShown.current, { events: loaded, status })) {
          console.warn(`older snapshot ignored: ${loaded.length} events, ${status}`);
          return;
        }
        liveEvents.current = loaded;
        liveShown.current = { events: loaded.length, done: status === "done" };
        const started = loaded[0];
        if (started?.type === "run_started") {
          setNarration(started.language);
          setDensity(started.density);
        }
        const folded = foldRun(loaded, project.clipSeconds);
        setView(status === "interrupted" ? interruptRun(folded) : folded);
      },
      onEnd: (list, finishedRunId, started) => {
        setMode("idle");
        if (!started) {
          setView(held);
          // Nothing of the run was shown and nothing came before it: load the shown result.
          if (!held) setLoadAttempt((n) => n + 1);
        }
        if (!finishedRunId) {
          if (list) setRuns(list);
          // A run that stopped: the version from before it plays on (a fetch that failed is retried).
          if (started && !held?.files && current) holdResult(current.runId);
          return;
        }
        // A run the page watched finish is shown even when the list does not have it yet.
        const watched = view?.runId === finishedRunId ? view : null;
        const after = listAfterRun(list, runs, finishedRunId, watched, new Date().toISOString());
        const finished = after.finished;
        setRuns(after.runs);
        if (!finished) return;
        setNarration(finished.language as Language);
        setDensity(finished.density as Density);
        choose(finished);
        setHeld(null);
        holding.current = null;
        if (watched) {
          // The page holds the whole run: no second read, and Replay works at once.
          setEvents(liveShown.current.done ? liveEvents.current : null);
          announce(runFinishedAnnouncement(watched, t));
        }
      },
      onStopped: (message) => setError({ message, ownFailure: true }),
      onLost: (runId, message) => {
        setView((v) => v && loseRun(v));
        setError({ message, ownFailure: false, lostRunId: runId });
        setMode("idle");
      },
      onCheckAgain: () => {
        liveRuns.current += 1;
        stopReplay();
        setMode("live");
        setError(null);
        setSelected(null);
      },
      onNotFound: () => setError({ message: t.live.notFound, ownFailure: false }),
      onError: (message) => setError({ message, ownFailure: false }),
    },
  });

  // An edit started before a reload: the page shows the result it was made from, keeps the editor
  // and Generate locked, and opens the new version when the edit is saved.
  const pendingEdit = live.edits.find((e) => !settledEdits.includes(e.runId)) ?? null;
  useEffect(() => {
    if (!pendingEdit) return;
    setNarration(pendingEdit.language);
    setDensity(pendingEdit.density);
    choose({ ...pendingEdit, runId: pendingEdit.baseRunId });
    // Once per edit found.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingEdit?.runId]);
  usePendingEdit(project.id, pendingEdit, {
    onSaved: (edit, listed) => {
      setSettledEdits((s) => [...s, edit.runId]);
      void showSaved(edit.runId, edit.cueId, listed);
    },
    onEnded: (edit, code) => {
      setSettledEdits((s) => [...s, edit.runId]);
      // Its reservation no longer holds this visitor busy.
      live.recheckStatus();
      const line = fill(t.line.title, { n: numbers.get(edit.cueId) ?? "" });
      setError({
        message: fill(code ? t.live.editStopped : t.live.editUnknown, { line }),
        ownFailure: false,
      });
    },
  });

  /**
   * Opens the result an edit saved, as `listed` (the save's own answer) has it, or as a new read
   * of the list once it does: never another version in its place. Until then the version it was
   * made from stays on screen. Whether another run or edit could start is asked again: the one
   * just saved held this visitor busy (after a reload) and may have spent what was left today.
   */
  async function showSaved(runId: string, cueId: string, listed?: RunListing[]) {
    live.recheckStatus();
    const found = await findSavedRun(
      runId,
      listed,
      async () => (await fetchRunList(project.id, READ_RETRY_DELAYS_MS)).runs,
    );
    if (!found) {
      console.error(`saved edit ${runId} is not listed yet`);
      setError({ message: t.live.savedNotListed, ownFailure: false });
      return;
    }
    const { runs: list, saved } = found;
    reselect.current = cueId;
    setRuns(list);
    setNarration(saved.language as Language);
    setDensity(saved.density as Density);
    choose(saved);
    announce(t.editor.saved);
  }

  function replay() {
    if (!events) return;
    stopReplay();
    setSelected(null);
    // A message about a stopped or lost run belongs to that run, which the replay replaces.
    setError((e) => (e && (e.ownFailure || e.lostRunId) ? null : e));
    const replayed = events.filter((e) => e.type !== "writer_delta");
    const lastT = replayed[replayed.length - 1]?.t ?? 0;
    const speed = Math.max(MIN_REPLAY_SPEED, Math.ceil(lastT / REPLAY_TARGET_SECONDS));
    setReplaySpeed(speed);
    setMode("replay");
    setView(emptyRun(project.clipSeconds));
    announce(fill(t.workspace.replaying, { speed }));
    for (const event of replayed) {
      timers.current.push(
        window.setTimeout(
          () => setView((v) => reduceRun(v ?? emptyRun(project.clipSeconds), event)),
          (event.t / speed) * 1000,
        ),
      );
    }
    timers.current.push(
      window.setTimeout(
        () => {
          setMode("idle");
          announce(t.workspace.replayFinished);
        },
        (lastT / speed) * 1000 + 400,
      ),
    );
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
  // While a new run is made, or after one stopped, the result from before it still plays.
  const playable = final ?? (mode !== "replay" && held?.files && held.runId ? held : null);
  const media = (file: string) => `/api/projects/${project.id}/media/${file}`;
  const describedUrl = playable
    ? media(`runs/${playable.runId}/${playable.files!.described}`)
    : null;
  const numbers = useMemo(() => lineNumbers(shown?.cues ?? []), [shown?.cues]);
  const playableNumbers = useMemo(() => lineNumbers(playable?.cues ?? []), [playable?.cues]);
  const selectedCue = shown?.cues.find((c) => c.id === selected) ?? null;

  function closeLine(line: string) {
    flushSync(() => setSelected(null));
    // The Back button is gone: focus goes back to the line it was opened from.
    const marker = document.querySelector<HTMLElement>(
      `.tl-narration [data-cue-id="${CSS.escape(line)}"]`,
    );
    if (marker?.offsetParent) marker.focus();
    else document.querySelector<HTMLElement>(".cue-picker select")?.focus();
  }
  const busy = mode === "live" || editing || Boolean(pendingEdit);
  // A run of this clip the viewer started elsewhere (another tab, before Back) is still going, or
  // today's allowance is spent: the server would refuse, and the notices say why.
  const blocked = live.active.length > 0 || live.status?.canStart === false;
  // An edit reserves what a run does, so while a run could not start, neither could an edit. Not
  // while one is being made: its own reservation reads as this visitor's run going.
  const editRefusal = !editing && live.status ? liveStatusNotice(live.status, t, lang) : null;
  // The page shows a run that ended without a result (stopped, or no longer answering).
  const unfinished = mode === "idle" && view !== null && !final;
  // The saved events can be replayed when they are the result on screen and a run made them: an
  // edit's events have no stages to replay (only its final event, at its whole duration).
  const canReplay =
    Boolean(events) && mode !== "live" && !unfinished && !trace?.summary?.parentRunId;
  // Before a result for this setting: what a run took. "Reused from an earlier run of this clip"
  // is said only of this clip's own figures (its run, or the sample's on the sample); quoting the
  // sample's on a clip not yet heard and watched says that its first run does both.
  const measuredReused =
    measured?.summary?.analysisReused?.speech || measured?.summary?.analysisReused?.scene;
  const measuredOwn = measuredHere || project.kind === "sample";
  const measuredHint = measured?.summary
    ? [
        fill(
          measuredHere ? t.workspace.noRunHintHere : t.workspace.noRunHint,
          sampleRunFigures(measured.language, measured.summary, lang),
        ),
        measuredReused && measuredOwn ? t.landing.measuredReused : null,
        measuredReused && !measuredOwn && !analysis ? t.workspace.noRunHintFirst : null,
      ]
        .filter(Boolean)
        .join(" ")
    : null;
  const cueLanguage = shown?.language ?? narration;
  const sceneEvidence = shown?.scene?.shots
    .filter((s) => selectedCue && selectedCue.start >= s.start && selectedCue.start < s.end)
    .map((s) => [s.setting, s.action, s.onScreenText].filter(Boolean).join(" · "))
    .join(" ");
  const parentRunId = final?.summary?.parentRunId;
  const littleRoom = littleRoomOf(view, shown, Boolean(analysis), project.clipSeconds);
  const editNote = final?.runId ? notes[final.runId] : null;
  const pendingLine = pendingEdit ? numbers.get(pendingEdit.cueId) : undefined;
  // A run that started and then failed or was interrupted can be tried again with its settings, while
  // the alert gives its own reason, that reason would not simply repeat, and a run could start now.
  const stoppedRun =
    mode === "idle" &&
    error?.ownFailure &&
    view?.error &&
    view.retryable !== false &&
    view.language &&
    view.density &&
    !blocked
      ? { language: view.language, density: view.density }
      : null;

  function select(id: string) {
    if (editing) return;
    setSelected(id);
    announce(
      fill(t.workspace.selected, { line: fill(t.line.title, { n: numbers.get(id) ?? id }) }),
    );
    const cue = shown?.cues.find((c) => c.id === id);
    if (cue) player.current?.seek(cue.start);
  }

  /** Runs `action`, which removes the focused control, and puts focus on the stage list instead. */
  function thenFocusStages(action: () => void) {
    flushSync(action);
    stageList.current?.focus();
  }

  /** The viewer picked something else to see: messages about the last attempt are done. */
  function act<A extends unknown[]>(action: (...args: A) => void) {
    return (...args: A) => {
      setError(null);
      action(...args);
    };
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
            cues={playable?.cues ?? []}
            speech={shown?.speech ?? []}
            filmLanguage={project.filmLanguageCode}
            narrationLanguage={playable?.language ?? null}
            lineNumbers={playableNumbers}
            onTime={setTime}
          />

          {error ? (
            <RunAlert
              alert={error}
              settled={mode !== "live"}
              onRetry={stoppedRun ? () => thenFocusStages(() => void live.start(stoppedRun)) : null}
              onCheckAgain={(runId) => thenFocusStages(() => live.checkAgain(runId))}
              onReload={() => {
                setLoadAttempt((n) => n + 1);
                // This button goes with the alert while the result loads again: focus waits on the
                // version being loaded (the picker always shows one when a load can fail).
                document
                  .querySelector<HTMLElement>(".result-picker select:not(:disabled)")
                  ?.focus();
              }}
            />
          ) : null}

          {shown ? (
            <Timeline
              clipSeconds={project.clipSeconds}
              stripUrl={media("strip.jpg")}
              stripStepSeconds={project.stripStepSeconds}
              speech={shown.speech}
              soundless={shown.relisten?.soundless === true}
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
            <LinePicker
              cues={final.cues}
              lineNumbers={numbers}
              language={cueLanguage}
              openCueId={selected}
              disabled={busy}
              onOpen={select}
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

        <aside
          className="ws-inspector"
          onKeyDown={(event) => {
            // Escape leaves the line like its Back button; the edit form and the remove question
            // handle their own Escape first and stop it.
            if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
            if (!selectedCue || editing || event.defaultPrevented) return;
            event.preventDefault();
            closeLine(selectedCue.id);
          }}
        >
          {selectedCue ? (
            <>
              <button
                type="button"
                className="button ghost small back"
                disabled={editing}
                onClick={() => closeLine(selectedCue.id)}
              >
                <span aria-hidden="true">←</span> {t.line.close}
              </button>
              <LineDetail
                cue={selectedCue}
                lineNumber={numbers.get(selectedCue.id) ?? 0}
                language={cueLanguage}
                evidence={sceneEvidence}
                editor={
                  final && mode === "idle" && !pendingEdit ? (
                    <EditLine
                      key={`${final.runId}-${selectedCue.id}`}
                      projectId={project.id}
                      runId={final.runId!}
                      cue={selectedCue}
                      cues={final.cues}
                      gaps={final.gaps}
                      language={cueLanguage}
                      unavailable={editRefusal}
                      onBusy={setEditing}
                      onSaved={(id: string, listed?: RunListing[]) =>
                        showSaved(id, selectedCue.id, listed)
                      }
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
                blocked={blocked}
                canReplay={canReplay}
                replaySpeed={replaySpeed}
                emptyHint={measuredHint}
                sample={project.kind === "sample"}
                unfinished={unfinished}
                onChooseRun={act((runId: string) => {
                  const run = runs.find((r) => r.runId === runId);
                  if (!run) return;
                  choose(run);
                  if (run.runId !== current?.runId) return;
                  // The chosen version, picked while a stopped run is on screen: open its result.
                  pinnedInUrl.current = run.runId;
                  pinRunInUrl(run.runId);
                  setLoadAttempt((n) => n + 1);
                })}
                onNarration={act(setNarration)}
                onDensity={act(setDensity)}
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
                showStatus={mode !== "live" && (!error || error.ownFailure)}
                littleRoom={littleRoom}
                busy={mode === "live"}
                pendingEdit={
                  pendingEdit && pendingLine !== undefined
                    ? {
                        line: fill(t.line.title, { n: pendingLine }),
                        startedAt: pendingEdit.startedAt,
                      }
                    : null
                }
                runSeconds={mode === "live" && view?.runId ? view.t : null}
                runStartedAt={mode === "live" ? live.since : null}
                onFollow={(runId) => thenFocusStages(() => live.follow(runId))}
              />
              {final?.files ? (
                <Downloads
                  base={media(`runs/${final.runId}`)}
                  files={final.files}
                  described={final.cues.some((c) => c.status === "fits")}
                />
              ) : null}
              {parentRunId && editNote ? (
                <EditSummary parent={labels.get(parentRunId) ?? parentRunId} note={editNote} />
              ) : null}
              {view && !parentRunId && (view.runId || mode !== "idle") ? (
                <StageList
                  ref={stageList}
                  view={view}
                  trace={mode === "replay" ? trace : null}
                  clockRate={mode === "live" ? 1 : mode === "replay" ? replaySpeed : 0}
                  startedAt={mode === "live" ? live.since : null}
                />
              ) : null}
              {!view && !busy && !current && !live.active.length ? (
                <p className="empty">
                  {fill(t.workspace.noRun, { language: languageName(narration, lang) })}
                </p>
              ) : null}
              {!view && current && !error?.reload ? (
                <p className="empty" role="status">
                  <span className="spinner" aria-hidden="true" /> {t.workspace.loadingRun}
                </p>
              ) : null}
              {/* A finished result shows the final check's list (QualityNote) instead. */}
              {view?.coverage.length && view.summary === null ? (
                <Coverage coverage={view.coverage} language={cueLanguage} />
              ) : null}
              {final?.cues.length ? (
                <p className="label hint" id={pickHint}>
                  {t.line.pickHint} <span className="pointer-hint">{t.line.pickHintKeys}</span>
                </p>
              ) : null}
            </>
          )}
        </aside>
      </main>
    </div>
  );
}
