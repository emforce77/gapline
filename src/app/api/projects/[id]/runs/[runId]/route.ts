import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ApiErrorBody, RequestErrorCode } from "@/lib/api-contract";
import { runDir, runStatus } from "@/lib/store/projects";
import { accessibleProject } from "@/lib/store/access";

export const runtime = "nodejs";

/**
 * Every event of a run so far, with its status, so the workspace can show a finished run, replay
 * it, or keep polling one that is still running ("running" | "done" | "failed" | "interrupted").
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  const notFound = () =>
    Response.json({ error: "not_found" } satisfies ApiErrorBody<RequestErrorCode>, {
      status: 404,
    });
  if (!(await accessibleProject(id))) return notFound();
  let text: string;
  try {
    text = await readFile(join(runDir(id, runId), "events.jsonl"), "utf8");
  } catch {
    return notFound();
  }
  const events = text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return Response.json(
    { events, status: await runStatus(id, runId) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
