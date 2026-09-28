import type { EditFailureBody } from "./edit-errors";

/** A line edit the edits route accepts: new words and start, or the line's removal. */
export type EditRequestBody =
  | { cueId: string; text: string; start: number; requestId: string }
  | { cueId: string; action: "remove"; requestId: string };

/** The edits route's answer: the new result's id, a refusal with its JSON body, or no answer. */
export type EditAnswer =
  | { kind: "saved"; runId: string }
  | { kind: "refused"; status: number; body: EditFailureBody | null }
  | { kind: "offline" };

/** The answer body as JSON, or null when it is not JSON (a proxy's HTML error page, for example). */
async function readJson(
  response: Response,
): Promise<(EditFailureBody & { runId?: string }) | null> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    console.error(`edit: HTTP ${response.status} sent no JSON`, error);
    return null;
  }
}

/** POSTs one edit of a finished result; the original result is never changed. */
export async function postEdit(
  projectId: string,
  runId: string,
  body: EditRequestBody,
): Promise<EditAnswer> {
  let response: Response;
  try {
    response = await fetch(`/api/projects/${projectId}/runs/${runId}/edits`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error("edit: no answer from Gapline", e);
    return { kind: "offline" };
  }
  const result = await readJson(response);
  if (!response.ok || typeof result?.runId !== "string") {
    console.warn(`edit refused: HTTP ${response.status} ${result?.error ?? "no code"}`);
    return { kind: "refused", status: response.status, body: result };
  }
  return { kind: "saved", runId: result.runId };
}
