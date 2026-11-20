import { stat } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { RUN_TIME_LIMIT_SECONDS } from "../api-contract";
import { readFresh } from "../store/projects";
import type { TimedRunEvent } from "../pipeline/events";

/** A tail starts at byte zero, including the durable run_started written before dispatch. */
export function runEventStream(file: string, startedAt: number, requestSignal: AbortSignal) {
  const stop = new AbortController();
  const signal = AbortSignal.any([stop.signal, requestSignal]);
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let position = 0;
      let size = -1;
      let pingAt = Date.now() + 15_000;
      try {
        while (!signal.aborted) {
          const nextSize = (await stat(file)).size;
          if (size !== nextSize) {
            const text = await readFresh(file);
            size = nextSize;
            let newline = text.indexOf("\n", position);
            while (newline !== -1) {
              const line = text.slice(position, newline);
              position = newline + 1;
              const entry = JSON.parse(line) as TimedRunEvent;
              if (signal.aborted) return;
              controller.enqueue(encoder.encode(`data: ${line}\n\n`));
              if (entry.type === "run_done" || entry.type === "run_failed") return;
              newline = text.indexOf("\n", position);
            }
          }
          if (Date.now() >= startedAt + RUN_TIME_LIMIT_SECONDS * 1000) return;
          if (Date.now() >= pingAt) {
            controller.enqueue(encoder.encode(": ping\n\n"));
            pingAt = Date.now() + 15_000;
          }
          await delay(1000, undefined, { signal });
        }
      } catch (error) {
        if (!signal.aborted) {
          controller.error(error);
          stop.abort();
        }
      } finally {
        if (!stop.signal.aborted) controller.close();
      }
    },
    cancel() {
      stop.abort();
    },
  });
}
