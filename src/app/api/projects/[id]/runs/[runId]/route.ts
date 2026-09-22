import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { runDir } from "@/lib/store/projects";
import { accessibleProject } from "@/lib/store/access";

export const runtime = "nodejs";

/** Every event of a finished run, so the workspace can show it or replay it. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params;
  if (!(await accessibleProject(id))) return new Response("Not found", { status: 404 });
  try {
    const text = await readFile(join(runDir(id, runId), "events.jsonl"), "utf8");
    const events = text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return Response.json({ events }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
