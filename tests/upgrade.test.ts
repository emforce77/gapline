import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  ReviewSchema,
  ShotSchema,
  SpeechSegmentSchema,
  SceneMapSchema,
  RevisionSchema,
  type Cue,
} from "../src/lib/pipeline/schemas";
import {
  callStructured,
  estimateGeminiCost,
  MAX_OUTPUT_TOKENS,
  ProviderError,
  retryAfterSeconds,
} from "../src/lib/llm/gemini";
import { readCallRecords, summarizeCosts } from "../src/lib/llm/ledger";
import { analysisKey, readAnalysisParts, saveAnalysisPart } from "../src/lib/store/analysis";
import { projectDir, writeProject, type Project } from "../src/lib/store/projects";
import { canAccess, ownerHash, sameOrigin } from "../src/lib/store/access";
import { reserveRun, settleRun, withRunBudget, reserveCall } from "../src/lib/runs/budget";
import { editBounds } from "../src/lib/runs/edit-run";
import { withFetch } from "./with-fetch";

it("rejects invalid timestamps, contradictory verdicts and duplicate ids", () => {
  assert.equal(
    SpeechSegmentSchema.safeParse({ start: -1, end: 2, text: "a", speaker: "" }).success,
    false,
  );
  assert.equal(
    ShotSchema.safeParse({ start: 2, end: 1, setting: "", action: "", onScreenText: "" }).success,
    false,
  );
  const contradiction = {
    cueId: "L1",
    pass: true,
    violations: [{ rule: "unseen", quote: "a", reason: "a" }],
    fix: "",
  };
  assert.equal(ReviewSchema.safeParse({ verdicts: [contradiction], missing: [] }).success, false);
  const pass = { ...contradiction, violations: [] };
  assert.equal(ReviewSchema.safeParse({ verdicts: [pass, pass], missing: [] }).success, false);
  assert.equal(
    RevisionSchema.safeParse({
      revisions: [
        { cueId: "L1", text: "a" },
        { cueId: "L1", text: "b" },
      ],
      additions: [],
    }).success,
    false,
  );
  assert.equal(
    SceneMapSchema.safeParse({
      shots: [],
      sounds: [],
      characters: [1, 2].map(() => ({ id: "c1", look: "x", name: "", nameFirstSpokenAt: null })),
    }).success,
    false,
  );
});

it("sends native Gemini media/schema options and streams only answer parts through EOF", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scene-gemini-request-"));
  const deltas: string[] = [];
  const usage = {
    promptTokenCount: 100,
    candidatesTokenCount: 25,
    thoughtsTokenCount: 75,
    totalTokenCount: 200,
  };
  const schema = z.object({ ok: z.boolean() });
  await withFetch(
    async (url, init) => {
      assert.equal(
        url,
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse",
      );
      assert.equal(init?.method, "POST");
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-goog-api-key"), "preferred-fixture");
      assert.equal(headers.get("content-type"), "application/json");
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.systemInstruction.parts, [{ text: "Return an object." }]);
      assert.deepEqual(body.contents, [
        {
          role: "user",
          parts: [
            { text: "Describe these." },
            { inlineData: { mimeType: "video/mp4", data: "dmlkZW8=" } },
            { inlineData: { mimeType: "audio/wav", data: "YXVkaW8=" } },
          ],
        },
      ]);
      assert.equal(body.generationConfig.responseFormat.text.mimeType, "APPLICATION_JSON");
      assert.equal(body.generationConfig.responseFormat.text.schema.properties.ok.type, "boolean");
      assert.equal(body.generationConfig.responseFormat.text.schema.$schema, undefined);
      assert.equal(body.generationConfig.responseMimeType, undefined);
      assert.equal(body.generationConfig.responseJsonSchema, undefined);
      assert.equal(body.generationConfig.maxOutputTokens, MAX_OUTPUT_TOKENS);
      assert.equal(body.generationConfig.temperature, 0.2);
      assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "low");
      assert.equal(body.messages, undefined);
      assert.equal(body.response_format, undefined);
      const chunks = [
        { candidates: [{ content: { parts: [{ text: "private reasoning", thought: true }] } }] },
        { candidates: [{ content: { parts: [{ text: '{"ok":' }] } }] },
        {
          candidates: [{ content: { parts: [{ text: "true}" }] }, finishReason: "STOP" }],
          usageMetadata: usage,
        },
      ];
      // Fragment the actual bytes, and omit a final newline or [DONE] marker.
      const bytes = new TextEncoder().encode(
        chunks.map((chunk) => `data: ${JSON.stringify(chunk)}`).join("\n\n"),
      );
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.slice(0, 19));
            controller.enqueue(bytes.slice(19));
            controller.close();
          },
        }),
      );
    },
    async () => {
      process.env.GOOGLE_API_KEY = "preferred-fixture";
      const result = await callStructured({
        label: "watch",
        model: "gemini-3.8-flash",
        system: "Return an object.",
        user: [
          { type: "text", text: "Describe these." },
          { type: "video_url", video_url: { url: "data:video/mp4;base64,dmlkZW8=" } },
          { type: "input_audio", input_audio: { format: "wav", data: "YXVkaW8=" } },
        ],
        schemaName: "fixture",
        schema,
        temperature: 0.2,
        reasoningEffort: "low",
        ledgerFile: join(dir, "ledger.jsonl"),
        onDelta: (text) => deltas.push(text),
      });
      assert.deepEqual(result.data, { ok: true });
      assert.deepEqual(deltas, ['{"ok":', "true}"]);
      assert.equal(result.record.promptTokens, 100);
      assert.equal(result.record.completionTokens, 100);
      assert.equal(result.record.costKnown, true);
      assert.equal(result.record.costSource, "token_estimate");
      assert.equal(result.record.finishReason, "STOP");
    },
  );
});

it("estimates Gemini cached inputs and thought tokens at the price in force when the call began", () => {
  const usage = {
    promptTokenCount: 1_000_000,
    cachedContentTokenCount: 400_000,
    candidatesTokenCount: 100_000,
    thoughtsTokenCount: 200_000,
    totalTokenCount: 1_300_000,
  };
  const discounted = estimateGeminiCost(
    usage,
    "gemini-3.8-flash",
    Date.UTC(2026, 11, 31, 23, 59, 59),
  );
  assert.ok(discounted !== null && Math.abs(discounted - 1.605) < 1e-12);
  assert.equal(estimateGeminiCost(usage, "gemini-3.8-flash", Date.UTC(2027, 0, 1)), discounted * 2);
  const ordinary = { promptTokenCount: 100, candidatesTokenCount: 50, totalTokenCount: 150 };
  assert.equal(estimateGeminiCost(ordinary, "gemini-3.8-flash", Date.UTC(2026, 8, 29)), 0.0002625);
  for (const incomplete of [
    undefined,
    { promptTokenCount: 100 },
    { ...ordinary, totalTokenCount: 151 },
    { ...ordinary, cachedContentTokenCount: 101 },
    { ...ordinary, thoughtsTokenCount: -1 },
    { promptTokenCount: 0.5, candidatesTokenCount: 1, totalTokenCount: 1.5 },
  ]) {
    assert.equal(estimateGeminiCost(incomplete, "gemini-3.8-flash", Date.UTC(2026, 8, 29)), null);
  }
  assert.equal(estimateGeminiCost(ordinary, "unknown-model", Date.UTC(2026, 8, 29)), null);
});

it("keeps charges unknown when Gemini omits usage or the stream ends without a finish reason", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scene-gemini-usage-"));
  for (const complete of [true, false]) {
    const ledgerFile = join(dir, `${complete ? "missing-usage" : "truncated"}.jsonl`);
    let requests = 0;
    await withFetch(
      async () => {
        requests++;
        return new Response(
          `data: ${JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text: '{"ok":true}' }] },
                ...(complete ? { finishReason: "STOP" } : {}),
              },
            ],
            ...(!complete
              ? {
                  usageMetadata: {
                    promptTokenCount: 100,
                    candidatesTokenCount: 100,
                    totalTokenCount: 200,
                  },
                }
              : {}),
          })}\n\n`,
        );
      },
      async () => {
        const result = callStructured({
          label: "review",
          model: "gemini-3.8-flash",
          system: "",
          user: [{ type: "text", text: "Return an object." }],
          schemaName: "fixture",
          schema: z.object({ ok: z.boolean() }),
          ledgerFile,
        });
        if (complete) assert.deepEqual((await result).data, { ok: true });
        else await assert.rejects(result, ProviderError);
      },
    );
    assert.equal(requests, complete ? 1 : 2);
    const records = await readCallRecords(ledgerFile);
    assert.equal(records.length, requests);
    assert.ok(records.every((record) => record.costKnown === false && record.costUsd === 0));
    assert.equal(summarizeCosts(records).costStatus, "unresolved");
  }
});

it("honors Retry-After, retries at most once and retains unknown charges", async () => {
  const original = globalThis.fetch;
  const oldKey = process.env.GEMINI_API_KEY;
  const oldGoogleKey = process.env.GOOGLE_API_KEY;
  delete process.env.GOOGLE_API_KEY;
  process.env.GEMINI_API_KEY = "fixture";
  const dir = await mkdtemp(join(tmpdir(), "scene-retry-"));
  let calls = 0;
  let failAlways = false;
  globalThis.fetch = async () => {
    calls++;
    if (calls % 2 === 1 || failAlways)
      return new Response(
        JSON.stringify({ error: { message: "temporarily rate-limited upstream" } }),
        { status: 503, headers: { "Retry-After": "0" } },
      );
    return new Response(
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100, thoughtsTokenCount: 0, totalTokenCount: 200 } })}\n\n`,
    );
  };
  try {
    const input = {
      label: "review",
      model: "gemini-3.8-flash",
      system: "",
      user: [],
      schemaName: "fixture",
      schema: z.object({ ok: z.boolean() }),
      ledgerFile: join(dir, "ledger.jsonl"),
    };
    const result = await callStructured(input);
    assert.equal(result.data.ok, true);
    assert.equal(result.record.costKnown, true);
    assert.equal(result.record.costSource, "token_estimate");
    assert.ok(result.record.costUsd > 0);
    assert.equal(calls, 2);
    failAlways = true;
    await assert.rejects(
      callStructured(input),
      (e: unknown) => e instanceof ProviderError && e.retryable,
    );
    assert.equal(calls, 4);
    const records = await readCallRecords(input.ledgerFile);
    assert.equal(records.length, 4);
    assert.equal(summarizeCosts(records).costStatus, "unresolved");
    assert.equal(
      retryAfterSeconds("Tue, 22 Sep 2026 00:00:05 GMT", Date.parse("2026-09-22T00:00:00Z")),
      5,
    );
  } finally {
    globalThis.fetch = original;
    if (oldKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldKey;
    if (oldGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = oldGoogleKey;
  }
});

it("persists partial analysis before downstream failure and invalidates changed source or language", async () => {
  const previous = process.env.DATA_DIR;
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-cache-"));
  try {
    const project: Project = {
      id: "cache-test",
      title: "fixture",
      kind: "sample",
      clipSeconds: 5,
      filmLanguageCode: "en-US",
      attribution: "",
      license: "",
      createdAt: new Date().toISOString(),
      stripStepSeconds: 1,
    };
    await writeProject(project);
    await writeFile(join(projectDir(project.id), "clip.mp4"), "source-one");
    const key = await analysisKey(project, "fixture");
    const speech = [{ start: 1, end: 2, text: "hello", speaker: "" }];
    await saveAnalysisPart(project, key, { speech });
    assert.deepEqual((await readAnalysisParts(project, key)).speech, speech);
    const scene = {
      shots: [{ start: 0, end: 5, setting: "room", action: "waits", onScreenText: "" }],
      characters: [],
      sounds: [],
    };
    await saveAnalysisPart(project, key, { scene });
    assert.deepEqual(await readAnalysisParts(project, key), { speech, scene });
    assert.deepEqual(
      await readAnalysisParts(
        { ...project, filmLanguageCode: "ko-KR" },
        await analysisKey({ ...project, filmLanguageCode: "ko-KR" }, "fixture"),
      ),
      {},
    );
    await writeFile(join(projectDir(project.id), "clip.mp4"), "source-two");
    assert.deepEqual(await readAnalysisParts(project, await analysisKey(project, "fixture")), {});
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
  }
});

it("reserves concurrent budgets atomically, settles once, and holds unknown spend", async () => {
  const previous = process.env.DATA_DIR;
  const cap = process.env.DAILY_BUDGET_USD;
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-budget-"));
  process.env.DAILY_BUDGET_USD = "5";
  try {
    const results = await Promise.allSettled([reserveRun(), reserveRun(), reserveRun()]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 2);
    const reservations = results
      .filter(
        (r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof reserveRun>>> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value);
    await settleRun(reservations[0], null);
    await settleRun(reservations[1], 0.1);
    await settleRun(reservations[1], 0.1);
    await assert.rejects(reserveRun());
    await withRunBudget(reservations[0], async () => {
      const finish = reserveCall(2);
      assert.throws(() => reserveCall(1));
      finish(null);
      assert.throws(() => reserveCall(1));
    });
    const state = JSON.parse(
      await readFile(join(process.env.DATA_DIR!, "budget/demo-v2.json"), "utf8"),
    );
    assert.equal(state.entries.length, 2);
    assert.equal(state.entries[0].cost === null || state.entries[1].cost === null, true);
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    if (cap === undefined) delete process.env.DAILY_BUDGET_USD;
    else process.env.DAILY_BUDGET_USD = cap;
  }
});

it("restricts uploads to their owning session and edits to actual neighboring audio bounds", () => {
  const proxied = new Request("http://localhost:8080/api/projects", {
    headers: {
      origin: "https://scene.example",
      "x-forwarded-host": "scene.example",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(sameOrigin(proxied), true);
  assert.equal(
    sameOrigin(
      new Request(proxied, {
        headers: { origin: "https://other.example", "x-forwarded-host": "scene.example" },
      }),
    ),
    false,
  );
  assert.equal(
    sameOrigin(
      new Request(proxied, {
        headers: {
          origin: "https://scene.example",
          "x-forwarded-host": "scene.example",
          "sec-fetch-site": "cross-site",
        },
      }),
    ),
    false,
  );
  const p = { kind: "upload", ownerHash: ownerHash("a".repeat(64)) } as Project;
  assert.equal(canAccess(p, "a".repeat(64)), true);
  assert.equal(canAccess(p, "b".repeat(64)), false);
  assert.equal(canAccess({ ...p, ownerHash: undefined }, undefined), false);
  assert.equal(canAccess({ ...p, kind: "sample" }), true);
  const cues = [
    { id: "L1", start: 1, seconds: 2 },
    { id: "L2", start: 4, seconds: 1 },
    { id: "L3", start: 7, seconds: 2 },
  ].map((c) => ({ ...c, gapId: "g1", status: "fits" })) as Cue[];
  assert.deepEqual(editBounds(cues, [{ id: "g1", start: 0, end: 10 }], "L2"), { min: 3, max: 7 });
});
