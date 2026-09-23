import { accessibleProject, ownerHash, sameOrigin, sessionToken } from "@/lib/store/access";
import { EditError, EditSchema, editRun } from "@/lib/runs/edit-run";
import { BudgetExhaustedError } from "@/lib/runs/budget";
import { describeFailure } from "@/lib/runs/failure";

export const runtime = "nodejs";
export const maxDuration = 900;

const BUDGET_MESSAGE = {
  budget_busy: "Another live run holds today's allowance. Try again when it finishes.",
  budget_daily: "Today's live allowance is spent. The original result is preserved.",
  run_allowance: "This edit reached its API allowance. The original result is preserved.",
} as const;

/**
 * One edit of a finished result, made as a new result that preserves it: new words or a new start for
 * one line (EditSchema's text form), or the removal of one line ({ cueId, action: "remove" }).
 * Errors carry a stable `error` code. `message` is kept for the current editor UI; for failures that
 * are not the editor's to fix it is a fixed sentence, and `cause` gives the underlying code.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  if (!sameOrigin(request)) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id, runId: baseRunId } = await params;
  if (!(await accessibleProject(id))) return Response.json({ error: "not_found" }, { status: 404 });
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
  try {
    return Response.json(await editRun(id, baseRunId, parsed.data, owner), { status: 201 });
  } catch (e) {
    if (e instanceof EditError)
      return Response.json({ error: e.code, message: e.message }, { status: e.status });
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
        ...(failure.retryAfterSeconds === undefined
          ? {}
          : { retryAfterSeconds: failure.retryAfterSeconds }),
      },
      { status: 502 },
    );
  }
}
