import { googleAccessToken } from "../src/lib/google/auth";

/** Replaces fetch for one test; every request must be one the test expects. */
export async function withFetch<T>(
  handler: (url: string, init?: RequestInit) => Promise<Response>,
  work: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  const keys = ["GCP_PROJECT_ID", "GOOGLE_API_KEY", "GEMINI_API_KEY", "K_SERVICE"] as const;
  const saved = keys.map((k) => process.env[k]);
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const address = String(url);
    if (address.includes("metadata.google"))
      return Response.json({ access_token: "fixture", expires_in: 3599 });
    return handler(address, init);
  }) as typeof fetch;
  process.env.GCP_PROJECT_ID = "fixture";
  process.env.GEMINI_API_KEY = "fixture";
  delete process.env.GOOGLE_API_KEY;
  process.env.K_SERVICE = "fixture";
  await googleAccessToken();
  delete process.env.K_SERVICE;
  try {
    return await work();
  } finally {
    globalThis.fetch = original;
    keys.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  }
}
