import { asUiLang } from "@/i18n";
import { downloadName } from "@/lib/runs/download-name";
import { lineReviewReport } from "@/lib/runs/review-report";
import type { ApiErrorBody, RequestErrorCode } from "@/lib/api-contract";
import { assertSafeId, readRunSnapshot } from "@/lib/store/projects";
import { accessibleRun } from "@/lib/store/access";

export const runtime = "nodejs";

/**
 * Every event of a run so far, with its status, so the workspace can show a finished run, replay
 * it, or keep polling one that is still running ("running" | "done" | "failed" | "interrupted").
 */
export async function GET(
  request: Request,
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
  // Another viewer's run on the sample is answered exactly like a run that does not exist.
  const project = await accessibleRun(id, runId);
  if (!project) return notFound();
  let snapshot: Awaited<ReturnType<typeof readRunSnapshot>>;
  try {
    snapshot = await readRunSnapshot(id, runId);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return notFound();
    throw error;
  }
  const query = new URL(request.url).searchParams;
  if (query.get("download") === "review") {
    const started = snapshot.events.find((e) => e.type === "run_started");
    const done = snapshot.events.find((e) => e.type === "run_done");
    if (snapshot.status !== "done" || !started || !done) return notFound();
    const lang = asUiLang(query.get("lang") ?? started.language);
    const filename = downloadName(project, runId, started, `review-${lang}.txt`);
    return new Response(lineReviewReport(project.title, started, done, lang), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }
  return Response.json(snapshot, { headers: { "Cache-Control": "private, no-store" } });
}
