/**
 * The Cloud Run settings as deploy/cloud-run.sh sets them, so the deck's architecture slide and the
 * film's cloud scene cannot drift from what is deployed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../paths";

const DEPLOY = readFileSync(join(REPO, "deploy/cloud-run.sh"), "utf8");

function flag(name: string): string {
  const m = DEPLOY.match(new RegExp(`--${name}[ =]("[^"]*"|\\S+)`));
  if (!m) throw new Error(`deploy/cloud-run.sh has no --${name}`);
  return m[1].replace(/"/g, "");
}

export const SPEC = {
  env: flag("execution-environment"),
  cpu: flag("cpu"),
  memory: flag("memory"),
  min: flag("min-instances"),
  max: flag("max-instances"),
  concurrency: flag("concurrency"),
  region: DEPLOY.match(/GCP_REGION:-([a-z0-9-]+)/)?.[1],
};
if (!SPEC.region || !/type=cloud-storage/.test(DEPLOY) || !/--set-secrets/.test(DEPLOY))
  throw new Error("deploy/cloud-run.sh no longer mounts the bucket or reads a secret");
