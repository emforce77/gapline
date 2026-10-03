"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { ActiveEdit, ActiveRun, LiveStatus, RunStatus } from "@/lib/api-contract";
import type { TimedRunEvent } from "@/lib/pipeline/events";
import type { Density, Language } from "@/lib/pipeline/schemas";
import type { RunListing } from "@/lib/store/projects";
import { refusedStartMessage, runErrorMessage } from "./api-errors";
import {
  fetchLiveStatus,
  fetchRun,
  fetchRunList,
  findStartedRun,
  READ_RETRY_DELAYS_MS,
  RunRequestError,
  sleep,
  streamRun,
  type RunList,
} from "./run-stream";
import { pinRunInUrl, runInUrl, unpinRunInUrl } from "./run-url";

/** How often a run whose stream dropped is checked on. */
const POLL_MS = 4_000;
/** Consecutive failed checks (about a minute) before the page says the server cannot be reached. */
const MAX_POLL_FAILURES = 15;
/**
 * A run that just finished can be missing from a list read right after it, when that read reaches
 * an instance whose storage view still lags; the list is asked for again after these waits.
 */
const LIST_LAG_DELAYS_MS: readonly number[] = [1_500, 3_000];
/** After the allowance renews (resetAt), whether a run can start is asked again this much later. */
const RENEWAL_GRACE_MS = 5_000;
/**
 * While a run cannot start because another is going (this visitor's own, visitor_busy; or other
 * visitors', budget_busy), whether one can is asked again: first after FIRST (a run of this page's
 * that just ended holds its visitor busy until its charge is settled, a second or so later), then
 * every AGAIN until the answer changes.
 */
const BUSY_RECHECK_FIRST_MS = 3_000;
const BUSY_RECHECK_AGAIN_MS = 15_000;

/**
 * "stream": events arrive live. "lost": the stream dropped and the run is checked on by polling.
 * "resumed": polling a run found again after a reload or picked from the active list.
 * "confirming": the start's answer was lost; the page looks for the run it may have started.
 */
export type Connection = "stream" | "lost" | "resumed" | "confirming";

export interface LiveRunHandlers {
  /** A run is about to be shown from its first event: reset the view and enter live mode. */
  onBegin: () => void;
  onEvent: (event: TimedRunEvent) => void;
  /**
   * The full event list of the followed run so far (each poll), with its status: an "interrupted"
   * run has no final event, so only the status says it stopped.
   */
  onEvents: (events: TimedRunEvent[], status: RunStatus) => void;
  /**
   * The run is over. `runs` is the refreshed list, or null when it could not be read (the run's
   * own outcome is already on screen); `finishedRunId` is set when it produced a result; `started`
   * is false when it never began (refused, unreachable, not found), so nothing of it is worth showing.
   */
  onEnd: (runs: RunListing[] | null, finishedRunId: string | null, started: boolean) => void;
  /** The followed run failed (run_failed) or was interrupted; `message` says why and what next. */
  onStopped: (message: string) => void;
  /**
   * The page stopped checking on the followed run `runId`: the server could not be reached for about
   * a minute. The run may still finish there; `message` says so and that it can be checked again.
   */
  onLost: (runId: string, message: string) => void;
  /**
   * Checking again on a run the page lost (checkAgain): enter live mode but keep the view, since
   * only a check that answers says more. The first that does replaces it (onEvents); if none does,
   * onLost comes again.
   */
  onCheckAgain: () => void;
  /**
   * The followed run is not here (another browser's, or a link to nothing): the address no longer
   * names it, and onEnd follows with `started` false.
   */
  onNotFound: (runId: string) => void;
  /** Anything else: a refused start, an unreachable server. */
  onError: (message: string) => void;
}

/**
 * Starts live runs and keeps following them when the stream drops or the page reloads, by polling
 * the run's saved events. Also reports the viewer's other unfinished runs and edits and whether a
 * new run could start now. Handlers are read at call time, so the caller may pass fresh closures
 * each render. `ignoredRunId`: a ?run= the server already found missing, so it is not followed.
 */
export function useLiveRun({
  projectId,
  initialRunId,
  ignoredRunId,
  finishedRunIds,
  handlers,
}: {
  projectId: string;
  initialRunId?: string;
  ignoredRunId?: string;
  finishedRunIds: string[];
  handlers: LiveRunHandlers;
}) {
  const { t, lang } = useI18n();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [followed, setFollowed] = useState<string | null>(null);
  // When the followed run started (server time), when known: after a reload its last event can be
  // a while ago, so only this says how long it has been running.
  const [since, setSince] = useState<string | null>(null);
  const followedRef = useRef<string | null>(null);
  // The first run-list read can set a new visitor's session cookie; a start sent before its answer
  // lands could be filed under a cookie the browser then replaces, so start waits for it.
  const firstList = useRef<Promise<unknown> | null>(null);
  const [active, setActive] = useState<ActiveRun[]>([]);
  const [edits, setEdits] = useState<ActiveEdit[]>([]);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const latest = useRef(handlers);
  // The viewer's unfinished runs as last listed, for a start that must tell a new run from them.
  const knownActive = useRef<ActiveRun[]>([]);
  useEffect(() => {
    latest.current = handlers;
    knownActive.current = active;
    followedRef.current = followed;
  });
  const timer = useRef<number | null>(null);
  const renewal = useRef<number | null>(null);
  // Bumped when the page unmounts, so checks started before (dev double-mount included) stop.
  const generation = useRef(0);

  // Answers in a row that said another run is going (statusRecheckMs).
  const busyAnswers = useRef(0);
  // Bumped per question: only the latest one's answer counts (recheckStatus can ask while a timed
  // question is still out, and an older answer arriving last must not undo a newer one).
  const asked = useRef(0);
  const refreshStatus = useCallback(function refresh() {
    const own = generation.current;
    const question = ++asked.current;
    fetchLiveStatus()
      .then((s) => {
        if (own !== generation.current || question !== asked.current) return;
        setStatus(s);
        if (renewal.current !== null) window.clearTimeout(renewal.current);
        renewal.current = null;
        const wait = statusRecheckMs(s, busyAnswers.current, Boolean(followedRef.current));
        busyAnswers.current = wait !== null && !isDailyRefusal(s) ? busyAnswers.current + 1 : 0;
        // Refused for now: say so until that changes, then ask again instead of staying refused.
        if (wait !== null) renewal.current = window.setTimeout(refresh, wait);
      })
      .catch((error: unknown) => console.error("live status unavailable", error));
  }, []);

  /**
   * Asks now whether a run or edit could start, after one of this page's edits ended (saved, or
   * stopped after a reload). An edit found after a reload reads as over a moment before its charge
   * is settled, so a busy answer then is the first of a new series (asked again after
   * BUSY_RECHECK_FIRST_MS), not the next one of the series its going held.
   */
  const recheckStatus = useCallback(() => {
    if (renewal.current !== null) window.clearTimeout(renewal.current);
    renewal.current = null;
    busyAnswers.current = 0;
    refreshStatus();
  }, [refreshStatus]);

  /** Lists the viewer's unfinished runs and edits, leaving out the run that just ended. */
  const showUnfinished = useCallback((list: RunList, endedRunId: string | null) => {
    // A run this page just saw end cannot still be going, whatever a lagging read says.
    setActive(list.active.filter((a) => a.runId !== endedRunId));
    setEdits(list.edits);
  }, []);

  /**
   * The followed run `runId` is over: "done" with a result, "stopped" (failed, interrupted; its
   * reason is already shown), or "never" begun. Reads the run list once more for the new version.
   */
  const end = useCallback(
    async (runId: string | null, outcome: "done" | "stopped" | "never") => {
      const own = generation.current;
      setConnection(null);
      setFollowed(null);
      setSince(null);
      const finishedRunId = outcome === "done" ? runId : null;
      let list: RunList | null = null;
      try {
        list = await fetchRunList(projectId, READ_RETRY_DELAYS_MS);
        for (const delay of LIST_LAG_DELAYS_MS) {
          if (!finishedRunId || list.runs.some((r) => r.runId === finishedRunId)) break;
          await sleep(delay);
          if (own !== generation.current) return;
          list = await fetchRunList(projectId, READ_RETRY_DELAYS_MS);
        }
      } catch (error) {
        // The run's outcome is on screen already (its result, or why it stopped or never began);
        // a list that did not come is no reason to replace that with another message.
        console.error("run list unavailable after a run", error);
      }
      if (own !== generation.current) return;
      // After the list read: the run's charge is settled just after its last event, and until
      // then its visitor reads as busy (visitor_busy, asked again shortly).
      refreshStatus();
      if (list) showUnfinished(list, runId);
      latest.current.onEnd(list?.runs ?? null, finishedRunId, outcome !== "never");
    },
    [projectId, refreshStatus, showUnfinished],
  );

  /** Polls a run's saved events until it is done, failed or interrupted. */
  const poll = useCallback(
    (runId: string) => {
      let failures = 0;
      const own = generation.current;
      const check = async () => {
        if (own !== generation.current) return;
        try {
          const { events, status: runStatus } = await fetchRun(projectId, runId);
          if (own !== generation.current) return;
          latest.current.onEvents(events, runStatus);
          // Only a check the page could also show counts as an answer.
          failures = 0;
          if (runStatus === "running") {
            timer.current = window.setTimeout(check, POLL_MS);
            return;
          }
          if (runStatus === "failed") {
            const failed = events.findLast((e) => e.type === "run_failed");
            latest.current.onStopped(runErrorMessage(failed ?? {}, t, lang, runId));
          }
          if (runStatus === "interrupted") latest.current.onStopped(t.live.interrupted);
          await end(runId, runStatus === "done" ? "done" : "stopped");
        } catch (error) {
          if (own !== generation.current) return;
          if (error instanceof RunRequestError && error.status === 404) {
            unpinRunInUrl();
            latest.current.onNotFound(runId);
            await end(runId, "never");
            return;
          }
          failures += 1;
          console.warn(`run ${runId}: check ${failures} failed`, error);
          if (failures >= MAX_POLL_FAILURES) {
            // Not end(): its run list request would fail the same way and replace this message.
            setConnection(null);
            setFollowed(null);
            latest.current.onLost(runId, t.live.unreachable);
            return;
          }
          timer.current = window.setTimeout(check, POLL_MS);
        }
      };
      void check();
    },
    [projectId, end, t, lang],
  );

  /** Polls a run the live view has already begun for (onBegin), naming it in the address. */
  const track = useCallback(
    (runId: string, startedAt?: string) => {
      pinRunInUrl(runId);
      setFollowed(runId);
      setSince(startedAt ?? knownActive.current.find((a) => a.runId === runId)?.startedAt ?? null);
      setConnection("resumed");
      setActive((list) => list.filter((a) => a.runId !== runId));
      poll(runId);
    },
    [poll],
  );

  /** Shows a run that is already going (after a reload, or picked from the active list). */
  const follow = useCallback(
    (runId: string) => {
      latest.current.onBegin();
      track(runId);
    },
    [track],
  );

  /** Polls a run the page lost touch with (onLost) again, keeping what the page showed of it. */
  const checkAgain = useCallback(
    (runId: string) => {
      latest.current.onCheckAgain();
      setFollowed(runId);
      setConnection("resumed");
      poll(runId);
    },
    [poll],
  );

  async function start(body: { language: Language; density: Density }) {
    const own = generation.current;
    const known = new Set(knownActive.current.map((a) => a.runId));
    latest.current.onBegin();
    setConnection("stream");
    setSince(null);
    // Filled from inside the event callback (an object, so the type checker sees the updates).
    const seen: { runId: string | null; outcome: "done" | "failed" | null } = {
      runId: null,
      outcome: null,
    };
    /**
     * The start's answer was lost (a dropped connection, or a stream that ended at once) although
     * the request may have arrived, and then the run goes on without this page. Look for it before
     * saying anything; only when none appears did it not start.
     */
    const confirmStart = async (message: string) => {
      setConnection("confirming");
      const run = await findStartedRun(() => fetchRunList(projectId), body, known);
      if (own !== generation.current) return;
      if (run) {
        track(run.runId, run.startedAt);
        return;
      }
      latest.current.onError(message);
      await end(null, "never");
    };
    try {
      // Its failure is logged where it is read; the start goes ahead either way.
      await firstList.current?.catch(() => undefined);
      await streamRun(projectId, body, (event) => {
        if (own !== generation.current) return;
        if (event.type === "run_started") {
          seen.runId = event.runId;
          setFollowed(event.runId);
          pinRunInUrl(event.runId);
        }
        if (event.type === "run_done") seen.outcome = "done";
        if (event.type === "run_failed") {
          seen.outcome = "failed";
          latest.current.onStopped(runErrorMessage(event, t, lang, seen.runId));
        }
        latest.current.onEvent(event);
      });
    } catch (error) {
      if (own !== generation.current) return;
      if (error instanceof RunRequestError) {
        // This viewer's run of this clip is still going: show it instead of paying for a second.
        if (error.body.error === "run_active" && error.body.runId) {
          track(error.body.runId);
          return;
        }
        latest.current.onError(refusedStartMessage(error, t, lang));
        await end(null, "never");
        return;
      }
      console.error("run stream broke", error);
      if (!seen.runId) {
        await confirmStart(t.live.notStartedChecked);
        return;
      }
    }
    if (own !== generation.current) return;
    if (seen.outcome) {
      await end(seen.runId, seen.outcome === "done" ? "done" : "stopped");
      return;
    }
    if (!seen.runId) {
      await confirmStart(t.live.notStarted);
      return;
    }
    // The stream ended without a final event: the connection dropped, not the run.
    setConnection("lost");
    poll(seen.runId);
  }

  // On arrival: whether a run could start now, the viewer's unfinished runs and edits, and a run
  // named in the address that has no finished result yet (still going, or failed/interrupted:
  // polling says which). The address wins over the server's props: Back and Forward restore
  // props rendered before ?run= was written.
  useEffect(() => {
    const own = generation.current;
    refreshStatus();
    const named = runInUrl();
    const runId = named && named !== ignoredRunId ? named : initialRunId;
    const pending = runId && !finishedRunIds.includes(runId) ? runId : null;
    if (pending) follow(pending);
    const listed = fetchRunList(projectId, READ_RETRY_DELAYS_MS);
    firstList.current = listed;
    listed
      .then((list) => {
        if (own !== generation.current) return;
        showUnfinished(list, pending);
        const resumed = list.active.find((a) => a.runId === pending);
        if (resumed && followedRef.current === pending) setSince(resumed.startedAt);
      })
      .catch((error: unknown) => console.error("unfinished runs unavailable", error));
    return () => {
      generation.current += 1;
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (renewal.current !== null) window.clearTimeout(renewal.current);
    };
    // Once per project page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return {
    connection,
    followed,
    since,
    active,
    edits,
    status,
    start,
    follow,
    checkAgain,
    recheckStatus,
  };
}

/** The shared allowance or this visitor's share is spent for today: it renews at resetAt. */
function isDailyRefusal(status: LiveStatus): boolean {
  return status.reason === "budget_daily" || status.visitor === "visitor_daily";
}

/**
 * When to ask /api/live-status again after `status`, in ms, or null when there is no need: at the
 * renewal for a daily refusal; for a busy one, soon after the first such answer and then less often
 * (`busyAnswers`: busy answers in a row before this one), but not while the page follows a run of
 * its own (`following`), whose end asks anyway.
 */
export function statusRecheckMs(
  status: LiveStatus,
  busyAnswers: number,
  following: boolean,
  now = Date.now(),
): number | null {
  if (status.canStart) return null;
  if (isDailyRefusal(status))
    return Math.max(0, Date.parse(status.resetAt) - now) + RENEWAL_GRACE_MS;
  if (following) return null;
  return busyAnswers === 0 ? BUSY_RECHECK_FIRST_MS : BUSY_RECHECK_AGAIN_MS;
}
