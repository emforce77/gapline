"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { ActiveRun, LiveStatus } from "@/lib/api-contract";
import type { TimedRunEvent } from "@/lib/pipeline/events";
import type { Density, Language } from "@/lib/pipeline/schemas";
import type { RunListing } from "@/lib/store/projects";
import { runErrorMessage } from "./api-errors";
import { fetchLiveStatus, fetchRun, fetchRunList, RunRequestError, streamRun } from "./run-stream";

/** How often a run whose stream dropped is checked on. */
const POLL_MS = 4_000;
/** Consecutive failed checks (about a minute) before the page says the server cannot be reached. */
const MAX_POLL_FAILURES = 15;
const RUN_PARAM = "run";

/**
 * "stream": events arrive live. "lost": the stream dropped and the run is checked on by polling.
 * "resumed": polling a run found again after a reload or picked from the active list.
 */
export type Connection = "stream" | "lost" | "resumed";

export interface LiveRunHandlers {
  /** A run is about to be shown from its first event: reset the view and enter live mode. */
  onBegin: () => void;
  onEvent: (event: TimedRunEvent) => void;
  /** The full event list of the followed run so far (each poll). */
  onEvents: (events: TimedRunEvent[]) => void;
  /**
   * The run is over. `runs` is the refreshed list; `finishedRunId` is set when it produced a result;
   * `started` is false when it never began (refused, or unreachable), so nothing of it is worth showing.
   */
  onEnd: (runs: RunListing[] | null, finishedRunId: string | null, started: boolean) => void;
  onError: (message: string) => void;
}

/** Keeps ?run=<id> in the address bar, so a reload comes back to the run (and a finished one stays pinned). */
function pinRunInUrl(runId: string) {
  const url = new URL(window.location.href);
  url.searchParams.set(RUN_PARAM, runId);
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
}

/**
 * Starts live runs and keeps following them when the stream drops or the page reloads, by polling
 * the run's saved events. Also reports the viewer's other unfinished runs and whether a new run
 * could start now. Handlers are read at call time, so the caller may pass fresh closures each render.
 */
export function useLiveRun({
  projectId,
  initialRunId,
  finishedRunIds,
  handlers,
}: {
  projectId: string;
  initialRunId?: string;
  finishedRunIds: string[];
  handlers: LiveRunHandlers;
}) {
  const { t, lang } = useI18n();
  const [connection, setConnection] = useState<Connection | null>(null);
  const [followed, setFollowed] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveRun[]>([]);
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  const timer = useRef<number | null>(null);
  // Bumped when the page unmounts, so checks started before (dev double-mount included) stop.
  const generation = useRef(0);

  const refreshStatus = useCallback(() => {
    const own = generation.current;
    fetchLiveStatus()
      .then((s) => own === generation.current && setStatus(s))
      .catch((error: unknown) => console.error("live status unavailable", error));
  }, []);

  const end = useCallback(
    async (finishedRunId: string | null, started = true) => {
      const own = generation.current;
      setConnection(null);
      setFollowed(null);
      refreshStatus();
      let runs: RunListing[] | null = null;
      try {
        const list = await fetchRunList(projectId);
        runs = list.runs;
        setActive(list.active);
      } catch (error) {
        console.error("run list unavailable after a run", error);
        latest.current.onError(t.live.loadFailed);
      }
      if (own === generation.current) latest.current.onEnd(runs, finishedRunId, started);
    },
    [projectId, refreshStatus, t],
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
          failures = 0;
          latest.current.onEvents(events);
          if (runStatus === "running") {
            timer.current = window.setTimeout(check, POLL_MS);
            return;
          }
          if (runStatus === "failed") {
            const failed = events.findLast((e) => e.type === "run_failed");
            latest.current.onError(runErrorMessage(failed ?? {}, t, lang, runId));
          }
          if (runStatus === "interrupted") latest.current.onError(t.live.interrupted);
          await end(runStatus === "done" ? runId : null);
        } catch (error) {
          if (error instanceof RunRequestError && error.status === 404) {
            latest.current.onError(t.live.notFound);
            await end(null);
            return;
          }
          failures += 1;
          console.warn(`run ${runId}: check ${failures} failed`, error);
          if (failures >= MAX_POLL_FAILURES) {
            latest.current.onError(t.live.unreachable);
            await end(null);
            return;
          }
          timer.current = window.setTimeout(check, POLL_MS);
        }
      };
      void check();
    },
    [projectId, end, t, lang],
  );

  /** Shows a run that is already going (after a reload, or picked from the active list). */
  const follow = useCallback(
    (runId: string) => {
      latest.current.onBegin();
      pinRunInUrl(runId);
      setFollowed(runId);
      setConnection("resumed");
      setActive((list) => list.filter((a) => a.runId !== runId));
      poll(runId);
    },
    [poll],
  );

  async function start(body: { language: Language; density: Density }) {
    latest.current.onBegin();
    setConnection("stream");
    // Filled from inside the event callback (an object, so the type checker sees the updates).
    const seen: { runId: string | null; outcome: "done" | "failed" | null } = {
      runId: null,
      outcome: null,
    };
    try {
      await streamRun(projectId, body, (event) => {
        if (event.type === "run_started") {
          seen.runId = event.runId;
          setFollowed(event.runId);
          pinRunInUrl(event.runId);
        }
        if (event.type === "run_done") seen.outcome = "done";
        if (event.type === "run_failed") {
          seen.outcome = "failed";
          latest.current.onError(runErrorMessage(event, t, lang, seen.runId));
        }
        latest.current.onEvent(event);
      });
    } catch (error) {
      if (error instanceof RunRequestError) {
        latest.current.onError(runErrorMessage({ ...error.body, code: error.body.error }, t, lang));
        await end(null, false);
        return;
      }
      // The stream broke (network, sleep, proxy). Before run_started nothing is known to follow.
      console.error("run stream broke", error);
      if (!seen.runId) {
        latest.current.onError(runErrorMessage({ code: "connection" }, t, lang));
        await end(null, false);
        return;
      }
    }
    if (seen.outcome) {
      await end(seen.outcome === "done" ? seen.runId : null);
      return;
    }
    if (!seen.runId) {
      latest.current.onError(t.live.notStarted);
      await end(null, false);
      return;
    }
    // The stream ended without a final event: the connection dropped, not the run.
    setConnection("lost");
    poll(seen.runId);
  }

  // On arrival: whether a run could start now, the viewer's unfinished runs, and a run named in the
  // address that has no finished result yet (still going, or failed/interrupted: polling says which).
  useEffect(() => {
    const own = generation.current;
    refreshStatus();
    const pending = initialRunId && !finishedRunIds.includes(initialRunId) ? initialRunId : null;
    if (pending) follow(pending);
    fetchRunList(projectId)
      .then((list) => {
        if (own === generation.current) setActive(list.active.filter((a) => a.runId !== pending));
      })
      .catch((error: unknown) => console.error("active runs unavailable", error));
    return () => {
      generation.current += 1;
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
    // Once per project page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return { connection, followed, active, status, start, follow };
}
