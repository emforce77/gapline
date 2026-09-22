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
import { callStructured, ProviderError, retryAfterSeconds } from "../src/lib/llm/openrouter";
import { readCallRecords, summarizeCosts } from "../src/lib/llm/ledger";
import { analysisKey, readAnalysisParts, saveAnalysisPart } from "../src/lib/store/analysis";
import { projectDir, writeProject, type Project } from "../src/lib/store/projects";
import { canAccess, ownerHash, sameOrigin } from "../src/lib/store/access";
import { reserveRun, settleRun, withRunBudget, reserveCall } from "../src/lib/runs/budget";
import { editBounds } from "../src/lib/runs/edit-run";

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

it("honors Retry-After, retries at most once and retains unknown charges", async () => {
  const original = globalThis.fetch;
  const oldKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "fixture";
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
      `data: ${JSON.stringify({ choices: [{ delta: { content: '{"ok":true}' }, finish_reason: "stop" }], usage: { cost: 0.01 } })}\n\ndata: [DONE]`,
    );
  };
  try {
    const input = {
      label: "review",
      model: "fixture",
      system: "",
      user: [],
      schemaName: "fixture",
      schema: z.object({ ok: z.boolean() }),
      ledgerFile: join(dir, "ledger.jsonl"),
    };
    assert.equal((await callStructured(input)).data.ok, true);
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
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldKey;
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
