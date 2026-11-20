import { z } from "zod";
import type { ApiErrorBody, RequestErrorCode, RunErrorCode } from "@/lib/api-contract";
import { BudgetExhaustedError, reserveRun } from "@/lib/runs/budget";
import { describeFailure } from "@/lib/runs/failure";
import { join } from "node:path";
import { executorConfig } from "@/lib/runs/executor-config";
import { beginRun, cancelDispatch, executeAttempt } from "@/lib/runs/attempt";
import { runEventStream } from "@/lib/runs/event-stream";
import { launchJob } from "@/lib/runs/job-launch";
import { prepareRun } from "@/lib/runs/start-run";
import { listActiveRuns, listRuns, listRunsAndWork } from "@/lib/store/run-index";
import { accessibleProject, ownerHash, sameOrigin, sessionToken } from "@/lib/store/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Equals RUN_TIME_LIMIT_SECONDS and Cloud Run's timeout; measured runs took 2.3–6.4 min (2026-10-03). */
export const maxDuration = 900;

const StartSchema = z.object({
  language: z.enum(["ko", "en"]),
  density: z.enum(["standard", "brief"]),
});

function fail(status: number, body: ApiErrorBody<RequestErrorCode | RunErrorCode>): Response {
  return Response.json(body, { status });
}

/**
 * Finished runs this viewer may see (on the sample: the public ones and their own), plus the
 * viewer's own runs (`active`) and edits (`edits`, ActiveEdit) that are still going, to resume
 * after a reload. The workspace asks for this list when it opens, so a viewer without a session
 * gets one here: an edit's answer comes only when the edit ends, too late to carry the cookie
 * that makes the result theirs if the page was closed meanwhile.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await accessibleProject(id);
  if (!project) return fail(404, { error: "not_found" });
  const existing = await sessionToken();
  if (!existing) {
    // A new session has made nothing yet: the public runs are all it can see.
    await sessionToken(true);
    return Response.json(
      { runs: await listRuns(project, undefined), active: [], edits: [] },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
  const listed = await listRunsAndWork(project, ownerHash(existing));
  return Response.json(listed, { headers: { "Cache-Control": "private, no-store" } });
}

/**
 * Reserves budget, then starts a run and streams its events as Server-Sent Events. A refused
 * reservation is a JSON 429 (budget_busy / budget_daily / visitor_busy / visitor_daily), before any
 * stream. A viewer whose run of this clip is still going gets 409 run_active naming it, instead
 * of a second paid run. The run keeps going if the viewer disconnects; they can find it again in
 * GET `active`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!sameOrigin(request)) return fail(403, { error: "forbidden" });
  if (!(await accessibleProject(id))) return fail(404, { error: "not_found" });
  const parsed = StartSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail(400, { error: "invalid_request" });

  const owner = ownerHash((await sessionToken(true))!);
  // Two runs of one clip from one visitor at once; the reservation's own rule (one live run or
  // edit per visitor) also refuses the rare second request that arrives before this one's run starts.
  const [running] = await listActiveRuns(id, owner);
  if (running) {
    console.warn(`run refused: project=${id} code=run_active running=${running.runId}`);
    return fail(409, {
      error: "run_active",
      runId: running.runId,
      language: running.language,
      density: running.density,
    });
  }
  const config = executorConfig();
  let prepared;
  let reservation;
  try {
    prepared = await prepareRun({ projectId: id, ...parsed.data, owner });
    reservation = await reserveRun("demo", owner);
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

  const job = await beginRun(prepared, reservation);
  if (config.mode === "job") {
    try {
      await launchJob(config, id, job.runId);
    } catch (error) {
      console.error(`Dispatch failed for run=${job.runId}`, error);
      await cancelDispatch(id, job.runId);
    }
  } else {
    void executeAttempt(id, job.runId).catch((error) =>
      console.error(`Run failed: ${job.runId}`, error),
    );
  }
  const stream = runEventStream(join(prepared.dir, "events.jsonl"), job.startedAt, request.signal);
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
