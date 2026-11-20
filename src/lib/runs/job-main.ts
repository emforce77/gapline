import { assertSafeId } from "../store/projects";
import { executeAttempt, TerminalRunFailure } from "./attempt";
import { executorConfig } from "./executor-config";

async function main() {
  const config = executorConfig();
  if (process.argv.includes("--self-test")) {
    console.log(`Gapline run worker ready (${config.mode})`);
    return;
  }
  if (config.mode !== "job") throw new Error("A Cloud Run worker requires RUN_EXECUTOR=job");
  const projectId = process.env.GAPLINE_PROJECT_ID ?? "";
  const runId = process.env.GAPLINE_RUN_ID ?? "";
  assertSafeId(projectId);
  assertSafeId(runId);
  const stop = new AbortController();
  process.once("SIGTERM", () => stop.abort(new Error("Task is stopping")));
  const execution = process.env.CLOUD_RUN_EXECUTION;
  const attempt = Number(process.env.CLOUD_RUN_TASK_ATTEMPT);
  if (!execution || !Number.isSafeInteger(attempt) || attempt < 0)
    throw new Error("Missing Cloud Run task identity");
  await executeAttempt(projectId, runId, {
    signal: stop.signal,
    execution,
    attempt,
    maxRetries: 2,
  });
}
main().catch((error) => {
  console.error(error);
  process.exitCode = error instanceof TerminalRunFailure ? 0 : 1;
});
