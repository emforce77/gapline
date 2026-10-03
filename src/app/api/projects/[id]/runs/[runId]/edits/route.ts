import type { EditSaved } from "@/lib/api-contract";
import { accessibleProject, ownerHash, sameOrigin, sessionToken } from "@/lib/store/access";
import { assertSafeId, type RunListing } from "@/lib/store/projects";
import { listRuns } from "@/lib/store/run-index";
import { EditError, EditSchema, editRun } from "@/lib/runs/edit-run";
import { BudgetExhaustedError } from "@/lib/runs/budget";
import { describeFailure } from "@/lib/runs/failure";

export const runtime = "nodejs";
export const maxDuration = 900;

const BUDGET_MESSAGE = {
  budget_busy: "Another live run holds today's allowance. Try again when it finishes.",
  budget_daily: "Today's live allowance is spent. The original result is preserved.",
  visitor_busy: "Your other live run or edit is still going. Try again when it finishes.",
  visitor_daily: "You used your share of today's live allowance. The original result is preserved.",
  run_allowance: "This edit reached its API allowance. The original result is preserved.",
} as const;

/**
 * One edit of a finished result, made as a new result that preserves it: new words or a new start for
 * one line (EditSchema's text form), or the removal of one line ({ cueId, action: "remove" }).
 * A saved edit answers 201 with EditSaved: the new run's id and the viewer's runs as this instance
 * reads them after the save, so the page never depends on a later list another instance may not
 * see yet. Errors carry a stable `error` code. `message` is kept for the current editor UI; for
 * failures that are not the editor's to fix it is a fixed sentence, and `cause` gives the
 * underlying code. Sending the same requestId again answers the saved run, 409 `running` while it
 * is being made, or makes a failed attempt again.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  if (!sameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id, runId: baseRunId } = await params;
  const project = await accessibleProject(id);
  if (!project) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    assertSafeId(baseRunId);
  } catch {
    return Response.json(
      { error: "not_found", message: "Original run not found." },
      { status: 404 },
    );
  }
  const parsed = EditSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      {
        error: "invalid_edit",
        message:
          'Send {cueId, text, start, requestId} to change a line, or {cueId, action: "remove", requestId} to remove it.',
      },
      { status: 400 },
    );
  const owner = ownerHash((await sessionToken(true))!);
  let runId: string;
  try {
    ({ runId } = await editRun(id, baseRunId, parsed.data, owner));
  } catch (e) {
    if (e instanceof EditError)
      return Response.json(
        { error: e.code, message: e.message, ...e.detail },
        { status: e.status },
      );
    const failure = describeFailure(e);
    if (e instanceof BudgetExhaustedError)
      return Response.json(
        {
          error: e.code,
          message: BUDGET_MESSAGE[e.code],
          ...(e.resetAt ? { resetAt: e.resetAt } : {}),
        },
        { status: 429 },
      );
    console.error(`edit failed: project=${id} base=${baseRunId} code=${failure.code}`, e);
    return Response.json(
      {
        error: "edit_failed",
        cause: failure.code,
        message: "The edit stopped. The original result is preserved.",
        ...(failure.retryable === undefined ? {} : { retryable: failure.retryable }),
        ...(failure.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: failure.retryAfterSeconds }),
      },
      { status: 502 },
    );
  }
  const saved: EditSaved<RunListing> = { runId, runs: await listRuns(project, owner) };
  return Response.json(saved, { status: 201 });
}
