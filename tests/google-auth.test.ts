import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { ServiceError } from "../src/lib/errors";
import { dropGoogleToken, googleFetch } from "../src/lib/google/auth";
import { readCallRecords } from "../src/lib/llm/ledger";
import { synthesizeLine } from "../src/lib/pipeline/voice";

const API = "https://texttospeech.googleapis.com/v1/text:synthesize";

/**
 * Runs `work` as on Cloud Run: the metadata server hands out "token-1", "token-2", … one per ask,
 * and every other request goes to `api` with the token it carried. Counts both.
 */
async function onCloudRun<T>(
  api: (token: string, init?: RequestInit) => Response,
  work: () => Promise<T>,
): Promise<{ result: T; tokens: number; sent: { token: string; body: unknown }[] }> {
  const original = globalThis.fetch;
  const saved = { project: process.env.GCP_PROJECT_ID, service: process.env.K_SERVICE };
  let tokens = 0;
  const sent: { token: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("metadata.google")) {
      tokens += 1;
      return Response.json({ access_token: `token-${tokens}`, expires_in: 3599 });
    }
    const token = new Headers(init?.headers).get("Authorization")!.replace("Bearer ", "");
    sent.push({ token, body: init?.body });
    return api(token, init);
  }) as typeof fetch;
  process.env.GCP_PROJECT_ID = "fixture";
  process.env.K_SERVICE = "fixture";
  try {
    return { result: await work(), tokens, sent };
  } finally {
    globalThis.fetch = original;
    for (const [name, value] of [
      ["GCP_PROJECT_ID", saved.project],
      ["K_SERVICE", saved.service],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

const unauthorized = () => Response.json({ error: { status: "UNAUTHENTICATED" } }, { status: 401 });
const request = { method: "POST", body: JSON.stringify({ input: { text: "fixture" } }) };

describe("googleFetch", () => {
  beforeEach(dropGoogleToken);

  it("sends once more with a new token after a 401", async () => {
    const { result, tokens, sent } = await onCloudRun(
      (token) => (token === "token-1" ? unauthorized() : Response.json({ ok: true })),
      () => googleFetch(API, request),
    );
    assert.equal(result.status, 200);
    assert.equal(tokens, 2);
    assert.deepEqual(
      sent.map((s) => s.token),
      ["token-1", "token-2"],
    );
    assert.equal(sent[1].body, request.body, "the same request again");
  });

  it("sends only once more: a second 401 is the answer", async () => {
    const { result, tokens, sent } = await onCloudRun(unauthorized, () =>
      googleFetch(API, request),
    );
    assert.equal(result.status, 401);
    assert.equal(tokens, 2);
    assert.equal(sent.length, 2);
  });

  it("does not send again after another refusal, and keeps the token", async () => {
    const { result, tokens, sent } = await onCloudRun(
      () => Response.json({ error: { status: "PERMISSION_DENIED" } }, { status: 403 }),
      async () => {
        const first = await googleFetch(API, request);
        await googleFetch(API, request);
        return first;
      },
    );
    assert.equal(result.status, 403);
    assert.equal(tokens, 1, "the cached token is still used");
    assert.equal(sent.length, 2);
  });

  it("turns a request that cannot be sent into the caller's error", async () => {
    await assert.rejects(
      onCloudRun(
        () => {
          throw new TypeError("fetch failed");
        },
        () =>
          googleFetch(
            API,
            request,
            (error) => new ServiceError("speech_failed", String(error), true),
          ),
      ),
      (error) => error instanceof ServiceError && /fetch failed/.test(error.message),
    );
  });

  it("voices a line whose first request carried a refused token", async () => {
    const ledgerFile = join(await mkdtemp(join(tmpdir(), "scene-auth-tts-")), "ledger.jsonl");
    const wav = Buffer.alloc(44 + 4_800);
    wav.write("RIFF", 0);
    wav.writeUInt32LE(36 + 4_800, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(24_000, 24);
    wav.writeUInt32LE(48_000, 28);
    wav.writeUInt16LE(2, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(4_800, 40);
    const { result, sent } = await onCloudRun(
      (token) =>
        token === "token-1"
          ? unauthorized()
          : Response.json({ audioContent: wav.toString("base64") }),
      () =>
        synthesizeLine({
          text: "A woman waits.",
          language: "en",
          speakingRate: 1,
          ledgerFile,
          label: "voice:fixture",
        }),
    );
    assert.equal(sent.length, 2);
    assert.equal(result.seconds, 0.1);
    const records = await readCallRecords(ledgerFile);
    assert.deepEqual(
      records.map((r) => [r.ok, r.characters]),
      [[true, 14]],
    );
  });
});
