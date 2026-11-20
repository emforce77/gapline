import { assertSafeId } from "../store/projects";
import { executeAttempt } from "./attempt";
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
  await executeAttempt(projectId, runId, { signal: stop.signal });
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
