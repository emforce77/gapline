import type { ActiveRun, ApiErrorBody, LiveStatus, RunStatus } from "@/lib/api-contract";
import type { TimedRunEvent } from "@/lib/pipeline/events";
import type { Density, Language } from "@/lib/pipeline/schemas";
import type { RunListing } from "@/lib/store/projects";

/** The API answered a run request with a JSON error instead of a stream or data. */
export class RunRequestError extends Error {
  constructor(
    public status: number,
    public body: Partial<ApiErrorBody>,
  ) {
    super(`HTTP ${status}: ${body.error ?? "no error code"}`);
  }
}

async function requestError(response: Response): Promise<RunRequestError> {
  const json = (response.headers.get("content-type") ?? "").includes("application/json");
  const body = json ? ((await response.json()) as Partial<ApiErrorBody>) : {};
  return new RunRequestError(response.status, body);
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

/** Every event of a run so far and its status; polled to follow a run whose stream dropped. */
export async function fetchRun(
  projectId: string,
  runId: string,
): Promise<{ events: TimedRunEvent[]; status: RunStatus }> {
  const response = await fetch(`/api/projects/${projectId}/runs/${runId}`, { cache: "no-store" });
  if (!response.ok) throw await requestError(response);
  return (await response.json()) as { events: TimedRunEvent[]; status: RunStatus };
}

/** Finished runs, and the viewer's own runs that are still going. */
export async function fetchRunList(
  projectId: string,
): Promise<{ runs: RunListing[]; active: ActiveRun[] }> {
  const response = await fetch(`/api/projects/${projectId}/runs`, { cache: "no-store" });
  if (!response.ok) throw await requestError(response);
  return (await response.json()) as { runs: RunListing[]; active: ActiveRun[] };
}

/** Whether a live run could start now; the run route checks again when it reserves. */
export async function fetchLiveStatus(): Promise<LiveStatus> {
  const response = await fetch("/api/live-status", { cache: "no-store" });
  if (!response.ok) throw await requestError(response);
  return (await response.json()) as LiveStatus;
}
