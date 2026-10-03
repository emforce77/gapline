import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
/** A token is replaced this long before it expires, so no request carries an expiring one. */
const TOKEN_MARGIN_MS = 5 * 60 * 1000;
/**
 * gcloud does not say how long the token it prints still lives (it can hand back one minted
 * earlier), so a local token is asked for again after a few minutes.
 */
const LOCAL_TOKEN_TTL_MS = 5 * 60 * 1000;
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
  if (process.env.K_SERVICE) {
    const response = await fetch(METADATA_TOKEN_URL, { headers: { "Metadata-Flavor": "Google" } });
    if (!response.ok) throw new Error(`Metadata token HTTP ${response.status}`);
    const body = (await response.json()) as { access_token: string; expires_in: number };
    // The metadata server hands out its current token with whatever lifetime it has left. A fixed
    // 40-minute cache sent expired tokens (Speech/TTS HTTP 401) for minutes on 2026-10-03.
    if (!Number.isFinite(body.expires_in)) throw new Error("Metadata token has no expires_in");
    cached = {
      token: body.access_token,
      expires: Date.now() + body.expires_in * 1000 - TOKEN_MARGIN_MS,
    };
    return body.access_token;
  }
  const configuration = process.env.GCLOUD_CONFIGURATION;
  if (!configuration) throw new Error("GCLOUD_CONFIGURATION is not set for local runs");
  const { stdout } = await run("gcloud", [
    "--configuration",
    configuration,
    "auth",
    "print-access-token",
  ]);
  cached = { token: stdout.trim(), expires: Date.now() + LOCAL_TOKEN_TTL_MS };
  return cached.token;
}

export async function googleHeaders(): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await googleAccessToken()}`,
    "Content-Type": "application/json",
    "x-goog-user-project": gcpProjectId(),
  };
}
