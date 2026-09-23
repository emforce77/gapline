import { z } from "zod";
import type { ApiErrorBody, RequestErrorCode, RunErrorCode } from "@/lib/api-contract";
import { BudgetExhaustedError, reserveRun } from "@/lib/runs/budget";
import { describeFailure } from "@/lib/runs/failure";
import { executeRun, prepareRun } from "@/lib/runs/start-run";
import { listActiveRuns, listRuns } from "@/lib/store/projects";
import { accessibleProject, ownerHash, sameOrigin, sessionToken } from "@/lib/store/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A 90 s clip takes a few minutes end to end; equals RUN_TIME_LIMIT_SECONDS and Cloud Run's timeout. */
export const maxDuration = 900;

const HEARTBEAT_MS = 15_000;
const StartSchema = z.object({
  language: z.enum(["ko", "en"]),
  density: z.enum(["standard", "brief"]),
});

function fail(status: number, body: ApiErrorBody<RequestErrorCode | RunErrorCode>): Response {
  return Response.json(body, { status });
}

/** Finished runs, plus the viewer's own runs that are still going (to resume after a reload). */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await accessibleProject(id))) return fail(404, { error: "not_found" });
  const token = await sessionToken();
  const [runs, active] = await Promise.all([
    listRuns(id),
    listActiveRuns(id, token ? ownerHash(token) : undefined),
  ]);
  return Response.json({ runs, active }, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Reserves budget, then starts a run and streams its events as Server-Sent Events. A refused
 * reservation is a JSON 429 (budget_busy / budget_daily), before any stream. The run keeps going
 * if the viewer disconnects; they can find it again in GET `active`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!sameOrigin(request)) return fail(403, { error: "forbidden" });
  if (!(await accessibleProject(id))) return fail(404, { error: "not_found" });
  const parsed = StartSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, { error: "invalid_request" });

  const owner = ownerHash((await sessionToken(true))!);
  let prepared;
  let reservation;
  try {
    prepared = await prepareRun({ projectId: id, ...parsed.data, owner });
    reservation = await reserveRun();
  } catch (error) {
    const failure = describeFailure(error);
    if (error instanceof BudgetExhaustedError) {
      console.warn(`run refused: project=${id} code=${failure.code}`);
      return fail(429, {
        error: failure.code,
        ...(failure.resetAt ? { resetAt: failure.resetAt } : {}),
      });
    }
    console.error(`run could not start: project=${id}`, error);
    return fail(500, { error: failure.code });
  }

  const encoder = new TextEncoder();
  let closed = false;
  const run = prepared;
  const held = reservation;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };
      const heartbeat = setInterval(() => send(": ping\n\n"), HEARTBEAT_MS);
      // The pipeline reports and logs its own failures; only errors outside it need an event here.
      let failureSent = false;
      executeRun(run, held, (event) => {
        if (event.type === "run_failed") failureSent = true;
        send(`data: ${JSON.stringify(event)}\n\n`);
      })
        .catch((error: unknown) => {
          if (failureSent) return;
          const failure = describeFailure(error);
          console.error(`run failed: project=${id} run=${run.runId} code=${failure.code}`, error);
          send(
            `data: ${JSON.stringify({ type: "run_failed", t: 0, error: failure.code, ...failure })}\n\n`,
          );
        })
        .finally(() => {
          clearInterval(heartbeat);
          if (!closed) controller.close();
          closed = true;
        });
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
