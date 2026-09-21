import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const TOKEN_TTL_MS = 40 * 60 * 1000;
const METADATA_TOKEN_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token";

let cached: { token: string; expires: number } | null = null;

export function gcpProjectId(): string {
  const id = process.env.GCP_PROJECT_ID;
  if (!id) throw new Error("GCP_PROJECT_ID is not set");
  return id;
}

/**
 * OAuth token for Google Cloud REST APIs.
 * On Cloud Run (K_SERVICE is set) it comes from the metadata server as the service account;
 * locally it comes from the gcloud CLI configuration named in GCLOUD_CONFIGURATION.
 */
export async function googleAccessToken(): Promise<string> {
  if (cached && cached.expires > Date.now()) return cached.token;
  let token: string;
  if (process.env.K_SERVICE) {
    const response = await fetch(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" } });
    if (!response.ok) throw new Error(`Metadata token HTTP ${response.status}`);
    token = ((await response.json()) as { access_token: string }).access_token;
  } else {
    const configuration = process.env.GCLOUD_CONFIGURATION;
    if (!configuration) throw new Error("GCLOUD_CONFIGURATION is not set for local runs");
    const { stdout } = await run("gcloud", [
      "--configuration",
      configuration,
      "auth",
      "print-access-token",
    ]);
    token = stdout.trim();
  }
  cached = { token, expires: Date.now() + TOKEN_TTL_MS };
  return token;
}

export async function googleHeaders(): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await googleAccessToken()}`,
    "Content-Type": "application/json",
    "x-goog-user-project": gcpProjectId(),
  };
}
