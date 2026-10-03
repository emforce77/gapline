/**
 * The Cloud Run settings as deploy/cloud-run.sh sets them, so the deck's architecture slide and the
 * film's cloud scene cannot drift from what is deployed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../paths";

const DEPLOY = readFileSync(join(REPO, "deploy/cloud-run.sh"), "utf8");
// Comments quote gcloud commands too ("gcloud run services update --min-instances 0"), and the first
// match once read "0`" (2026-10-04), so only the script's commands are searched.
const COMMANDS = DEPLOY.split("\n")
  .filter((l) => !l.trimStart().startsWith("#"))
  .join("\n");
const SHELL_DEFAULT = /^\$\{[A-Z_]+:-([^}]*)\}$/;

/** A flag's value in the deploy command; one the caller may override ("${MIN_INSTANCES:-1}") reads as its default. */
export function deployFlag(name: string): string {
  const m = COMMANDS.match(new RegExp(`--${name}[ =]("[^"]*"|\\S+)`));
  if (!m) throw new Error(`deploy/cloud-run.sh has no --${name}`);
  return m[1].replace(/"/g, "").replace(SHELL_DEFAULT, "$1");
}

export const SPEC = {
  env: deployFlag("execution-environment"),
  cpu: deployFlag("cpu"),
  memory: deployFlag("memory"),
  min: deployFlag("min-instances"),
  max: deployFlag("max-instances"),
  concurrency: deployFlag("concurrency"),
  region: DEPLOY.match(/GCP_REGION:-([a-z0-9-]+)/)?.[1],
};
if (!SPEC.region || !/type=cloud-storage/.test(DEPLOY) || !/--set-secrets/.test(DEPLOY))
  throw new Error("deploy/cloud-run.sh no longer mounts the bucket or reads a secret");
