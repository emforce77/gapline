import { gcpProjectId, googleFetch } from "../google/auth";
import type { ExecutorConfig } from "./executor-config";

export async function launchJob(
  config: Extract<ExecutorConfig, { mode: "job" }>,
  projectId: string,
  runId: string,
) {
  const resource = `projects/${gcpProjectId()}/locations/${config.region}/jobs/${config.name}`;
  const response = await googleFetch(
    `https://run.googleapis.com/v2/${resource}:run`,
    {
      method: "POST",
      body: JSON.stringify({
        overrides: {
          containerOverrides: [
            {
              env: [
                { name: "GAPLINE_PROJECT_ID", value: projectId },
                { name: "GAPLINE_RUN_ID", value: runId },
              ],
            },
          ],
        },
      }),
    },
    undefined,
    { timeoutMs: 20_000, refreshToken: false },
  );
  if (!response.ok) throw new Error(`jobs.run returned HTTP ${response.status}`);
  const operation = (await response.json()) as { name: string };
  console.info(`Accepted run=${runId} operation=${operation.name}`);
}
