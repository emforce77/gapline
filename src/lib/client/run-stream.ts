import type {
  ActiveEdit,
  ActiveRun,
  ApiErrorBody,
  LiveStatus,
  RunStatus,
} from "@/lib/api-contract";
import type { TimedRunEvent } from "@/lib/pipeline/events";
import type { Density, Language } from "@/lib/pipeline/schemas";
import type { RunListing } from "@/lib/store/projects";

/**
 * Answers that say "not now" rather than "no": Cloud Run's own 429 ("Rate exceeded.", not JSON)
 * when every instance is full, a gateway that lost the instance, or a storage read that failed on
 * one instance. Asking again a moment later usually works.
 */
const TRANSIENT_STATUSES: readonly number[] = [408, 429, 500, 502, 503, 504];
/** Waits before each retry of a read: about seven seconds in all, longer than a request spike. */
export const READ_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000];
/**
 * When to look for a run whose start answer was lost: the server files a run (its owner file) in
 * under a second after the request lands (0.73-0.9 s measured to its first byte).
 */
const CONFIRM_DELAYS_MS: readonly number[] = [500, 1_500, 3_000];

export const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The API answered a run request with an error status instead of a stream or data. */
export class RunRequestError extends Error {
  constructor(
    public status: number,
    /** The JSON error body; empty when the answer was not JSON (a platform or proxy page). */
    public body: Partial<ApiErrorBody>,
  ) {
    super(`HTTP ${status}: ${body.error ?? "no error code"}`);
  }

  /** Whether the same request may succeed a moment later. */
  get transient(): boolean {
    return TRANSIENT_STATUSES.includes(this.status);
  }
}

async function requestError(response: Response): Promise<RunRequestError> {
  const json = (response.headers.get("content-type") ?? "").includes("application/json");
  const body = json ? ((await response.json()) as Partial<ApiErrorBody>) : {};
  return new RunRequestError(response.status, body);
}

/** No answer at all (offline, connection reset), or an answer that says "try again shortly". */
export function isTransientFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof RunRequestError && error.transient);
}

/**
 * Runs an idempotent read, and again after each of `delays` while it fails transiently. The last
 * failure is thrown, so the caller still decides what to say.
 */
export async function retryTransient<T>(
  read: () => Promise<T>,
  delays: readonly number[] = READ_RETRY_DELAYS_MS,
  wait: (ms: number) => Promise<void> = sleep,
  transient: (error: unknown) => boolean = isTransientFailure,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await read();
    } catch (error) {
      if (attempt >= delays.length || !transient(error)) throw error;
      console.warn(`read failed (${String(error)}); retrying in ${delays[attempt]} ms`);
      await wait(delays[attempt]);
    }
  }
}

/**
 * Starts a run and calls onEvent for every Server-Sent Event the route sends. A refused start
 * (budget, access, bad request) is a JSON answer before any stream and throws RunRequestError.
 * Returns when the stream ends; whether it ended with run_done/run_failed is for the caller to
 * check, since a dropped connection also just ends it. (EventSource cannot POST, hence fetch.)
 */
export async function streamRun(
  projectId: string,
  body: { language: Language; density: Density },
  onEvent: (event: TimedRunEvent) => void,
): Promise<void> {
  const response = await fetch(`/api/projects/${projectId}/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await requestError(response);
  if (!response.body) throw new Error(`Run request answered HTTP ${response.status} with no body`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) onEvent(JSON.parse(data) as TimedRunEvent);
    }
  }
}

/**
 * Every event of a run so far and its status; polled to follow a run whose stream dropped (the
 * poll loop has its own retries), and read once, with `retryDelays`, to show a finished result.
 */
export async function fetchRun(
  projectId: string,
  runId: string,
  retryDelays: readonly number[] = [],
): Promise<{ events: TimedRunEvent[]; status: RunStatus }> {
  return retryTransient(async () => {
    const response = await fetch(
      `/api/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw await requestError(response);
    return (await response.json()) as { events: TimedRunEvent[]; status: RunStatus };
  }, retryDelays);
}

/** A listed run answered as unfinished: a storage read on another instance that still lags. */
export class StaleSnapshotError extends Error {
  constructor(runId: string, status: RunStatus) {
    super(`run ${runId} is listed as finished but was read as ${status}`);
  }
}

/**
 * A finished (listed) run's events. Listing it already proved it done, so an answer that it is
 * still running came from a read that lags; that is asked again after each of `staleDelays`
 * (as long as the lag can last). A busy or absent answer is asked again after each of `busyDelays`.
 */
export async function fetchFinishedRun(
  projectId: string,
  runId: string,
  staleDelays: readonly number[],
  busyDelays: readonly number[] = READ_RETRY_DELAYS_MS,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<TimedRunEvent[]> {
  let stale = 0;
  let busy = 0;
  for (;;) {
    try {
      const { events, status } = await fetchRun(projectId, runId);
      if (status === "done") return events;
      if (stale >= staleDelays.length) throw new StaleSnapshotError(runId, status);
      console.warn(`run ${runId} read as ${status}; reading again in ${staleDelays[stale]} ms`);
      await wait(staleDelays[stale++]);
    } catch (error) {
      if (error instanceof StaleSnapshotError || !isTransientFailure(error)) throw error;
      if (busy >= busyDelays.length) throw error;
      console.warn(`run ${runId} not read (${String(error)}); retrying in ${busyDelays[busy]} ms`);
      await wait(busyDelays[busy++]);
    }
  }
}

/** GET /api/projects/[id]/runs: finished runs, and the viewer's runs and edits still going. */
export interface RunList {
  runs: RunListing[];
  active: ActiveRun[];
  edits: ActiveEdit[];
}

/** Finished runs, and the viewer's own runs and edits that are still going. */
export async function fetchRunList(
  projectId: string,
  retryDelays: readonly number[] = [],
): Promise<RunList> {
  return retryTransient(async () => {
    const response = await fetch(`/api/projects/${encodeURIComponent(projectId)}/runs`, {
      cache: "no-store",
    });
    if (!response.ok) throw await requestError(response);
    return (await response.json()) as RunList;
  }, retryDelays);
}

/**
 * The run a start may have begun although its answer was lost: an unfinished run of the viewer's,
 * with the requested settings, that was not listed before the start (`known`). Null when none
 * appears within the waits; a list that fails to load counts as no answer yet.
 */
export async function findStartedRun(
  list: () => Promise<{ active: ActiveRun[] }>,
  body: { language: Language; density: Density },
  known: ReadonlySet<string>,
  delays: readonly number[] = CONFIRM_DELAYS_MS,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<ActiveRun | null> {
  for (const delay of delays) {
    await wait(delay);
    try {
      const { active } = await list();
      const run = active.find(
        (a) => !known.has(a.runId) && a.language === body.language && a.density === body.density,
      );
      if (run) return run;
    } catch (error) {
      console.warn("could not check whether the run started", error);
    }
  }
  return null;
}

/** After an edit is saved, waits before each new read of a list that does not have its result yet. */
const SAVED_LIST_DELAYS_MS: readonly number[] = [0, 500, 1_000, 2_000, 4_000];

/**
 * The run list once it has `runId` (an edit's new result), with that run's listing: `listed` (the
 * save's own answer) when it has it, else a new read after each wait. Null when no read has it, so
 * the page says so instead of opening another version in its place. A read that fails counts as
 * not listed yet.
 */
export async function findSavedRun(
  runId: string,
  listed: RunListing[] | undefined,
  read: () => Promise<RunListing[]>,
  delays: readonly number[] = SAVED_LIST_DELAYS_MS,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<{ runs: RunListing[]; saved: RunListing } | null> {
  let list = listed;
  for (const delay of delays) {
    if (list?.some((r) => r.runId === runId)) break;
    await wait(delay);
    try {
      list = await read();
    } catch (error) {
      console.warn("run list unavailable after a save", error);
    }
  }
  const saved = list?.find((r) => r.runId === runId);
  return list && saved ? { runs: list, saved } : null;
}

/** Whether a live run could start now; the run route checks again when it reserves. */
export async function fetchLiveStatus(): Promise<LiveStatus> {
  return retryTransient(async () => {
    const response = await fetch("/api/live-status", { cache: "no-store" });
    if (!response.ok) throw await requestError(response);
    return (await response.json()) as LiveStatus;
  });
}
