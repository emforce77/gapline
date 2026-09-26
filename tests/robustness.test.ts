import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, mkdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z, ZodError } from "zod";
import { MAX_UPLOAD_BYTES, RUN_TIME_LIMIT_SECONDS } from "../src/lib/api-contract";
import { ModelOutputError, ServiceError } from "../src/lib/errors";
import { callStructured, MAX_RETRY_WAIT_SECONDS, ProviderError } from "../src/lib/llm/openrouter";
import { FfmpegError } from "../src/lib/media/ffmpeg";
import { renderGaps } from "../src/lib/pipeline/context";
import { assessRoom, findGaps, SPEECH_GUARD_SECONDS } from "../src/lib/pipeline/gaps";
import { groupSegments, timeChunkWords, type RecognizeResponse } from "../src/lib/pipeline/hear";
import { fitSceneToClip } from "../src/lib/pipeline/watch";
import {
  admission,
  budgetDay,
  BudgetExhaustedError,
  liveStatus,
  reserveRun,
  settleRun,
  type BudgetState,
} from "../src/lib/runs/budget";
import { describeFailure } from "../src/lib/runs/failure";
import { sameOrigin } from "../src/lib/store/access";
import { validateAnalysis } from "../src/lib/store/analysis";
import { listActiveRuns, runDir, runStatus, RUN_OWNER_FILE } from "../src/lib/store/projects";

async function withDataDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const previous = { data: process.env.DATA_DIR, cap: process.env.DAILY_BUDGET_USD };
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-robust-"));
  process.env.DAILY_BUDGET_USD = "5";
  try {
    return await work(process.env.DATA_DIR);
  } finally {
    if (previous.data === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous.data;
    if (previous.cap === undefined) delete process.env.DAILY_BUDGET_USD;
    else process.env.DAILY_BUDGET_USD = previous.cap;
  }
}

describe("speech timing", () => {
  it("keeps a real Chirp 3 response with zero-length words and blocks their span", async () => {
    const body = JSON.parse(
      await readFile(join(process.cwd(), "tests/fixtures/chirp3-untimed-words.json"), "utf8"),
    ) as RecognizeResponse;
    const { words, untimed } = timeChunkWords(body, 0, 40);
    assert.equal(untimed, 3);
    assert.deepEqual(words[0], { start: 0, end: 1.24, word: "어쩔 수 없고요.", untimed: true });
    assert.ok(words.every((w) => w.end > w.start));
    const speech = groupSegments(words);
    assert.doesNotThrow(() => validateAnalysis({ speech }, 40));
    assert.equal(speech[0].start, 0);
    // No narration room is created where the untimed words were spoken.
    const gaps = findGaps({ speech, sounds: [] }, 40);
    assert.ok(gaps.every((g) => g.start >= 3.44 + SPEECH_GUARD_SECONDS - 1e-9));
  });

  it("spans untimed words to their timed neighbours, or to the chunk edges", () => {
    const word = (w: string, start?: string, end?: string) => ({
      word: w,
      ...(start ? { startOffset: start } : {}),
      ...(end ? { endOffset: end } : {}),
    });
    const body = (words: ReturnType<typeof word>[]): RecognizeResponse => ({
      results: [{ alternatives: [{ words }] }],
    });
    // Offsets are relative to the chunk; a missing start is proto3's 0 s, not missing timing.
    const middle = timeChunkWords(
      body([word("a", undefined, "1s"), word("b", "3s", "3s"), word("c", "5s", "6s")]),
      50,
      105,
    );
    assert.deepEqual(
      middle.words.map((w) => [w.start, w.end, w.word]),
      [
        [50, 51, "a"],
        [51, 55, "b"],
        [55, 56, "c"],
      ],
    );
    const tail = timeChunkWords(body([word("a", "1s", "2s"), word("b"), word("c")]), 0, 10);
    assert.deepEqual(tail.words.at(-1), { start: 2, end: 10, word: "b c", untimed: true });
    const touching = timeChunkWords(
      body([word("a", "1s", "2s"), word("b"), word("c", "2s", "3s")]),
      0,
      10,
    );
    assert.deepEqual(
      touching.words.map((w) => [w.start, w.end, w.word]),
      [
        [1, 2, "a b"],
        [2, 3, "c"],
      ],
    );
    const allUntimed = timeChunkWords(body([word("a"), word("b")]), 0, 7);
    assert.deepEqual(allUntimed.words, [{ start: 0, end: 7, word: "a b", untimed: true }]);
  });
});

describe("budget", () => {
  const now = new Date("2026-10-20T10:00:00Z");
  const { date, resetAt } = budgetDay(now);
  const entry = (over: Partial<BudgetState["entries"][number]>) => ({
    id: Math.random().toString(),
    date,
    scope: "demo" as const,
    amount: 2.5,
    cost: null,
    done: false,
    startedAt: now.toISOString(),
    ...over,
  });

  it("tells a live run holding the allowance apart from a spent day", () => {
    assert.equal(resetAt, "2026-10-21T00:00:00.000Z");
    const busy: BudgetState = {
      entries: [entry({ cost: 0.2, done: true }), entry({})],
      legacy: {},
    };
    assert.equal(admission(busy, date, 2.5, 5, now), "budget_busy");
    const spent: BudgetState = {
      entries: [entry({ cost: null, done: true }), entry({ cost: 0.3, done: true })],
      legacy: {},
    };
    assert.equal(admission(spent, date, 2.5, 5, now), "budget_daily");
    assert.equal(admission({ entries: [entry({})], legacy: {} }, date, 2.5, 5, now), null);
    // An unsettled reservation older than a run can last is spend, not a live run.
    const stale = new Date(now.getTime() - (RUN_TIME_LIMIT_SECONDS + 120) * 1000).toISOString();
    const orphan: BudgetState = {
      entries: [entry({ cost: 0.2, done: true }), entry({ startedAt: stale })],
      legacy: {},
    };
    assert.equal(admission(orphan, date, 2.5, 5, now), "budget_daily");
    assert.equal(
      admission({ entries: [], legacy: { [date]: 4 } }, date, 2.5, 5, now),
      "budget_daily",
    );
  });

  it("refuses with a coded error and reports the same through liveStatus", () =>
    withDataDir(async () => {
      assert.deepEqual((await liveStatus()).canStart, true);
      const first = await reserveRun();
      await reserveRun();
      await assert.rejects(
        reserveRun(),
        (e: unknown) => e instanceof BudgetExhaustedError && e.code === "budget_busy",
      );
      assert.equal((await liveStatus()).reason, "budget_busy");
      await settleRun(first, null);
      await assert.rejects(
        reserveRun(),
        (e: unknown) => e instanceof BudgetExhaustedError && e.code === "budget_busy" && !e.resetAt,
      );
      const state = JSON.parse(
        await readFile(join(process.env.DATA_DIR!, "budget/demo-v2.json"), "utf8"),
      );
      state.entries[1] = { ...state.entries[1], cost: 0.1, done: true };
      await writeFile(join(process.env.DATA_DIR!, "budget/demo-v2.json"), JSON.stringify(state));
      await assert.rejects(reserveRun(), (e: unknown) => {
        const failure = describeFailure(e);
        return failure.code === "budget_daily" && failure.resetAt === budgetDay(new Date()).resetAt;
      });
      const status = await liveStatus();
      assert.deepEqual(status, {
        canStart: false,
        reason: "budget_daily",
        resetAt: budgetDay(new Date()).resetAt,
      });
    }));
});

describe("request and failure contract", () => {
  it("rejects mutations without an Origin header", () => {
    const post = (headers: Record<string, string>) =>
      new Request("http://localhost:8080/api/projects", { method: "POST", headers });
    assert.equal(sameOrigin(post({ host: "scene.example" })), false);
    assert.equal(
      sameOrigin(post({ "sec-fetch-site": "same-origin", host: "scene.example" })),
      false,
    );
    assert.equal(sameOrigin(post({ origin: "http://scene.example", host: "scene.example" })), true);
  });

  it("maps internal errors to stable codes", () => {
    assert.deepEqual(describeFailure(new ProviderError("x", 429, true, 120)), {
      code: "provider_busy",
      retryable: true,
      retryAfterSeconds: 120,
    });
    assert.equal(describeFailure(new ProviderError("402", 402, false)).code, "provider_failed");
    assert.equal(
      describeFailure(new ServiceError("speech_failed", "x", true)).code,
      "speech_failed",
    );
    assert.equal(describeFailure(new FfmpegError("exited 1")).code, "media_failed");
    assert.equal(describeFailure(new ModelOutputError("x")).code, "model_output");
    let zod: unknown;
    try {
      z.object({ a: z.string() }).parse({});
    } catch (e) {
      zod = e;
    }
    assert.ok(zod instanceof ZodError);
    assert.equal(describeFailure(zod).code, "model_output");
    assert.equal(describeFailure(new TypeError("fetch failed")).code, "internal");
    assert.equal(
      describeFailure(new BudgetExhaustedError("run_allowance", "x")).code,
      "run_allowance",
    );
  });

  it("returns a long Retry-After as a retryable error instead of waiting", async () => {
    const original = globalThis.fetch;
    const oldKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "fixture";
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return new Response("{}", { status: 429, headers: { "Retry-After": "120" } });
    };
    const dir = await mkdtemp(join(tmpdir(), "scene-retry-cap-"));
    const started = Date.now();
    try {
      await assert.rejects(
        callStructured({
          label: "watch",
          model: "fixture",
          system: "",
          user: [],
          schemaName: "fixture",
          schema: z.object({ ok: z.boolean() }),
          ledgerFile: join(dir, "ledger.jsonl"),
        }),
        (e: unknown) => e instanceof ProviderError && e.retryable && e.retryAfterSeconds === 120,
      );
      assert.equal(calls, 1);
      assert.ok(Date.now() - started < MAX_RETRY_WAIT_SECONDS * 1000);
    } finally {
      globalThis.fetch = original;
      if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = oldKey;
    }
  });
});

describe("watch timestamps", () => {
  const scene = (end: number) => ({
    shots: [
      { start: 0, end: 8, setting: "lab", action: "a man waits", onScreenText: "" },
      { start: 8, end, setting: "lab", action: "a door opens", onScreenText: "" },
    ],
    sounds: [{ start: 10.2, end, label: "hum", kind: "ambient" as const }],
    characters: [],
  });

  it("clamps a small overshoot so the result passes the stored-analysis check", () => {
    const fitted = fitSceneToClip(scene(10.4), 10);
    assert.equal(fitted.shots[1].end, 10);
    assert.equal(fitted.sounds.length, 0);
    assert.doesNotThrow(() => validateAnalysis({ scene: fitted }, 10));
  });

  it("rejects a time far past the clip as a model output error", () => {
    assert.throws(() => fitSceneToClip(scene(10.8), 10), ModelOutputError);
  });
});

describe("room for description", () => {
  it("flags clips whose silences cannot hold more than a line or two", () => {
    const korean = assessRoom([{ id: "g1", start: 10, end: 12.46 }], 45);
    assert.deepEqual(korean, { gapSeconds: 2.46, thresholdSeconds: 3, little: true });
    assert.equal(assessRoom([{ id: "g1", start: 0, end: 29.82 }], 65).little, false);
    assert.deepEqual(assessRoom([{ id: "g1", start: 0, end: 4 }], 90), {
      gapSeconds: 4,
      thresholdSeconds: 4.5,
      little: true,
    });
    assert.equal(renderGaps([]), "(none)");
  });
});

describe("runs in progress", () => {
  it("lists the viewer's unfinished runs and reports each run's status", () =>
    withDataDir(async () => {
      const project = "active-test";
      const now = Date.parse("2026-10-20T10:00:00Z");
      const at = (secondsAgo: number) => new Date(now - secondsAgo * 1000).toISOString();
      const started = (runId: string) =>
        JSON.stringify({ type: "run_started", runId, language: "ko", density: "standard", t: 0 });
      const makeRun = async (
        runId: string,
        owner: string | null,
        secondsAgo: number,
        events: string[],
        done = false,
      ) => {
        const dir = runDir(project, runId);
        await mkdir(dir, { recursive: true });
        if (owner)
          await writeFile(
            join(dir, RUN_OWNER_FILE),
            JSON.stringify({
              ownerHash: owner,
              startedAt: at(secondsAgo),
              language: "ko",
              density: "standard",
            }),
          );
        await writeFile(join(dir, "events.jsonl"), events.map((e) => `${e}\n`).join(""));
        if (done) await writeFile(join(dir, "script.json"), "{}");
      };
      await makeRun("r-live", "me", 60, [started("r-live")]);
      await makeRun("r-other", "someone", 60, [started("r-other")]);
      await makeRun("r-failed", "me", 60, [
        started("r-failed"),
        '{"type":"run_failed","code":"internal","error":"internal","t":3}',
      ]);
      await makeRun("r-old", "me", RUN_TIME_LIMIT_SECONDS + 5, [started("r-old")]);
      await makeRun("r-done", "me", 30, [started("r-done"), '{"type":"run_done","t":30}'], true);
      await makeRun("r-script", null, 0, [started("r-script")]);
      await utimes(join(runDir(project, "r-script"), "events.jsonl"), now / 1000, now / 1000);

      const active = await listActiveRuns(project, "me", now);
      assert.deepEqual(
        active.map((r) => [r.runId, r.language, r.density, r.startedAt]),
        [["r-live", "ko", "standard", at(60)]],
      );
      assert.deepEqual(await listActiveRuns(project, undefined, now), []);
      assert.equal(await runStatus(project, "r-live", now), "running");
      assert.equal(await runStatus(project, "r-failed", now), "failed");
      assert.equal(await runStatus(project, "r-old", now), "interrupted");
      assert.equal(await runStatus(project, "r-done", now), "done");
      assert.equal(await runStatus(project, "r-script", now), "running");
      assert.equal(
        await runStatus(project, "r-script", now + (RUN_TIME_LIMIT_SECONDS + 1) * 1000),
        "interrupted",
      );
    }));
});

describe("API routes", () => {
  it("answers upload problems with JSON codes before touching the file", async () => {
    const { POST } = await import("../src/app/api/projects/route");
    const origin = { origin: "http://scene.example", host: "scene.example" };
    const noOrigin = await POST(
      new Request("http://scene.example/api/projects", { method: "POST" }),
    );
    assert.equal(noOrigin.status, 403);
    assert.deepEqual(await noOrigin.json(), { error: "forbidden" });

    const declared = await POST(
      new Request("http://scene.example/api/projects", {
        method: "POST",
        headers: { ...origin, "content-length": String(MAX_UPLOAD_BYTES * 2) },
        body: "x",
      }),
    );
    assert.equal(declared.status, 413);
    assert.deepEqual(await declared.json(), { error: "too_large", maxBytes: MAX_UPLOAD_BYTES });

    const big = new FormData();
    big.append(
      "video",
      new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], "big.mp4", { type: "video/mp4" }),
    );
    const large = await POST(
      new Request("http://scene.example/api/projects", {
        method: "POST",
        headers: origin,
        body: big,
      }),
    );
    assert.equal(large.status, 413);
    assert.equal((await large.json()).error, "too_large");

    const empty = await POST(
      new Request("http://scene.example/api/projects", {
        method: "POST",
        headers: origin,
        body: new FormData(),
      }),
    );
    assert.equal(empty.status, 400);
    assert.deepEqual(await empty.json(), { error: "missing_file" });

    const text = new FormData();
    text.append("video", new File(["hello"], "notes.txt", { type: "text/plain" }));
    const wrongType = await POST(
      new Request("http://scene.example/api/projects", {
        method: "POST",
        headers: origin,
        body: text,
      }),
    );
    assert.equal(wrongType.status, 415);
    assert.deepEqual(await wrongType.json(), { error: "not_video" });
  });

  it("refuses a run request without Origin and reports live status as JSON", () =>
    withDataDir(async () => {
      const runs = await import("../src/app/api/projects/[id]/runs/route");
      const refused = await runs.POST(
        new Request("http://scene.example/api/projects/tos-opening/runs", { method: "POST" }),
        { params: Promise.resolve({ id: "tos-opening" }) },
      );
      assert.equal(refused.status, 403);
      assert.deepEqual(await refused.json(), { error: "forbidden" });
      const status = await import("../src/app/api/live-status/route");
      const body = await (await status.GET()).json();
      assert.deepEqual(Object.keys(body).sort(), ["canStart", "reason", "resetAt"]);
      assert.equal(body.canStart, true);
    }));
});
