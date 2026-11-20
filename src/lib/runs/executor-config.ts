export type ExecutorConfig = { mode: "inline" } | { mode: "job"; name: string; region: string };

export function executorConfig(env: Record<string, string | undefined> = process.env): ExecutorConfig {
  if (env.RUN_EXECUTOR === "inline") return { mode: "inline" };
  if (env.RUN_EXECUTOR !== "job") throw new Error("RUN_EXECUTOR must be inline or job");
  const name = env.RUN_JOB_NAME;
  const region = env.RUN_JOB_REGION;
  if (!name || !region) throw new Error("RUN_JOB_NAME and RUN_JOB_REGION are required");
  return { mode: "job", name, region };
}
