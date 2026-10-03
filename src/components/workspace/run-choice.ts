import type { RunStatus } from "@/lib/api-contract";
import type { TimedRunEvent } from "@/lib/pipeline/events";
import type { RunView } from "@/lib/pipeline/reduce";
import type { RunListing } from "@/lib/store/projects";
import { orderRuns } from "./labels";

/** A narration language and density: each pair has its own versions and its own choice. */
export function settingKey(run: { language: string; density: string }): string {
  return `${run.language}/${run.density}`;
}

/**
 * The version shown for a narration language and density: the one chosen for that pair on this page
 * (a pick, a save, a finished run, the link), else the sample's pinned run for that language, the
 * one the landing page and the film describe, else the newest result.
 */
export function shownRun(
  runs: RunListing[],
  setting: { language: string; density: string },
  chosen: Record<string, string>,
  pins: Record<string, string>,
): RunListing | null {
  const same = runs.filter((r) => r.language === setting.language && r.density === setting.density);
  return (
    same.find((r) => r.runId === chosen[settingKey(setting)]) ??
    same.find((r) => r.runId === pins[setting.language] && r.summary) ??
    orderRuns(same.filter((r) => r.summary))[0] ??
    null
  );
}

/** What the page has shown of a run: how many saved events, and whether it was finished. */
export interface ShownSnapshot {
  events: number;
  done: boolean;
}

/**
 * Whether a polled snapshot is older than one already shown. The event log only grows, so fewer
 * events, or "running" after "done", came from a read that lags (another instance's storage view).
 */
export function isOlderSnapshot(
  shown: ShownSnapshot,
  next: { events: TimedRunEvent[]; status: RunStatus },
): boolean {
  return next.events.length < shown.events || (shown.done && next.status !== "done");
}

/**
 * A listing for a run the page watched finish but the run list does not have yet (a read that
 * lags, or a list that did not load): built from the finished view, so the run can be selected.
 */
export function listingFromView(view: RunView, createdAt: string): RunListing | null {
  if (!view.runId || !view.language || !view.density || !view.summary) return null;
  return {
    runId: view.runId,
    language: view.language,
    density: view.density,
    summary: view.summary,
    createdAt,
  };
}

/**
 * The run list after a followed run finished as `finishedRunId`, and that run's listing (null when
 * neither the list nor the page has it). `list` is the refreshed list, or null when it did not load
 * (then `runs`, as before). A run the page watched finish (`watched`) is shown even when the list
 * does not have it yet: its listing is built from the view and added.
 */
export function listAfterRun(
  list: RunListing[] | null,
  runs: RunListing[],
  finishedRunId: string,
  watched: RunView | null,
  createdAt: string,
): { runs: RunListing[]; finished: RunListing | null } {
  const listed = list ?? runs;
  const finished = listed.find((r) => r.runId === finishedRunId);
  if (finished) return { runs: listed, finished };
  const built = watched?.runId === finishedRunId ? listingFromView(watched, createdAt) : null;
  return built ? { runs: [built, ...listed], finished: built } : { runs: listed, finished: null };
}

const MS_PER_SECOND = 1_000;

/**
 * How long a live run has been going at wall time `now` (ms): its latest event's time plus the wall
 * time since that event arrived (`anchor`), and never less than the time since it started
 * (`startedAt`, the server's clock, when known), since a run followed after a reload may not have
 * logged an event for a while.
 */
export function runClockSeconds(
  anchor: { wall: number; t: number },
  now: number,
  startedAt: string | null,
): number {
  const sinceEvent = anchor.t + Math.max(0, now - anchor.wall) / MS_PER_SECOND;
  if (!startedAt) return sinceEvent;
  return Math.max(sinceEvent, (now - Date.parse(startedAt)) / MS_PER_SECOND);
}
