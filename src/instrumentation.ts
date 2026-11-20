import { executorConfig } from "./lib/runs/executor-config";

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") executorConfig();
}
