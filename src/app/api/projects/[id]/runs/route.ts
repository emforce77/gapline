import { z } from "zod";
import { BudgetExhaustedError } from "@/lib/runs/budget";
import { startRun } from "@/lib/runs/start-run";
import { listRuns } from "@/lib/store/projects";
import { accessibleProject, sameOrigin } from "@/lib/store/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** A 90 s clip takes a few minutes end to end; Cloud Run's request timeout is set above this. */
export const maxDuration = 900;

const HEARTBEAT_MS = 15_000;
const StartSchema = z.object({
  language: z.enum(["ko", "en"]),
  density: z.enum(["standard", "brief"]),
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await accessibleProject(id))) return new Response("Not found", { status: 404 });
  return Response.json({ runs: await listRuns(id) });
}

/**
 * Starts a run and streams its events as Server-Sent Events. The run keeps going if the viewer
 * disconnects; its results are saved and listed like any other run.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  if (!(await accessibleProject(id))) return new Response("Not found", { status: 404 });
  const parsed = StartSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json({ error: "language and density are required" }, { status: 400 });

  const encoder = new TextEncoder();
  let closed = false;
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
      // The pipeline reports its own failures; only errors raised before it starts need an event here.
      let failureSent = false;
      startRun({
        projectId: id,
        language: parsed.data.language,
        density: parsed.data.density,
        emit: (event) => {
          if (event.type === "run_failed") failureSent = true;
          send(`data: ${JSON.stringify(event)}\n\n`);
        },
      })
        .catch((error: unknown) => {
          const budget = error instanceof BudgetExhaustedError;
          console.error(`run failed: project=${id}`, error);
          if (failureSent) return;
          send(
            `data: ${JSON.stringify({
              type: "run_failed",
              t: 0,
              error: budget ? "budget" : error instanceof Error ? error.message : String(error),
            })}\n\n`,
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
