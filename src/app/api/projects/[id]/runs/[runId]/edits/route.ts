import { accessibleProject, ownerHash, sameOrigin, sessionToken } from "@/lib/store/access";
import { EditError, EditSchema, editRun } from "@/lib/runs/edit-run";
import { BudgetExhaustedError } from "@/lib/runs/budget";
export const runtime = "nodejs";
export const maxDuration = 900;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const { id, runId: baseRunId } = await params;
  if (!(await accessibleProject(id))) return new Response("Not found", { status: 404 });
  const parsed = EditSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: "invalid_edit", message: "cueId, text, start and requestId are required." },
      { status: 400 },
    );
  const owner = ownerHash((await sessionToken(true))!);
  try {
    return Response.json(await editRun(id, baseRunId, parsed.data, owner), { status: 201 });
  } catch (e) {
    if (e instanceof EditError)
      return Response.json({ error: e.code, message: e.message }, { status: e.status });
    if (e instanceof BudgetExhaustedError)
      return Response.json({ error: "budget", message: e.message }, { status: 429 });
    console.error("edit failed", e);
    return Response.json(
      { error: "edit_failed", message: "The edit stopped. The original result is preserved." },
      { status: 502 },
    );
  }
}
