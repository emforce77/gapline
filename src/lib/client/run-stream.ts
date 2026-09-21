import type { TimedRunEvent } from "@/lib/pipeline/events";
import type { Density, Language } from "@/lib/pipeline/schemas";

/**
 * Starts a run and calls onEvent for every Server-Sent Event the route sends.
 * (EventSource cannot POST, so the stream is read from fetch.)
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
  if (!response.ok || !response.body)
    throw new Error(`Run request failed: HTTP ${response.status}`);
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

export async function fetchRunEvents(projectId: string, runId: string): Promise<TimedRunEvent[]> {
  const response = await fetch(`/api/projects/${projectId}/runs/${runId}`);
  if (!response.ok) throw new Error(`Could not load run ${runId}: HTTP ${response.status}`);
  return ((await response.json()) as { events: TimedRunEvent[] }).events;
}
