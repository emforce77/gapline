import type { ApiErrorBody, RequestErrorCode } from "@/lib/api-contract";
import { assertSafeId, readRunSnapshot } from "@/lib/store/projects";
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
  try {
    assertSafeId(runId);
  } catch {
    return notFound();
  }
  if (!(await accessibleProject(id))) return notFound();
  let snapshot: Awaited<ReturnType<typeof readRunSnapshot>>;
  try {
    snapshot = await readRunSnapshot(id, runId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return notFound();
    throw error;
  }
  return Response.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
}
