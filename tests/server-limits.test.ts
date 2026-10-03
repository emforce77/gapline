import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { RUN_TIME_LIMIT_SECONDS } from "../src/lib/api-contract";
import { encodeWav } from "../src/lib/media/narration-track";
import type { Cue } from "../src/lib/pipeline/schemas";
import {
  admission,
  BudgetExhaustedError,
  reserveRun,
  settleRun,
  type BudgetEntry,
  type BudgetState,
} from "../src/lib/runs/budget";
import { editRun, EditError } from "../src/lib/runs/edit-run";
import { describeFailure } from "../src/lib/runs/failure";
import { updateObjectJson, type JsonBucket } from "../src/lib/store/atomic";
import { OWNER_COOKIE, ownerHash } from "../src/lib/store/access";
import {
  listActiveWork,
  readFresh,
  readRunSnapshot,
  RUN_EDITOR_FILE,
  RUN_OWNER_FILE,
  runDir,
  writeProject,
  type Project,
} from "../src/lib/store/projects";

/** A bucket in memory that keeps only the current generation, like the data bucket. */
function memoryBucket(onDownload?: (generation: number) => void) {
  const objects = new Map<string, { generation: number; body: string }>();
  const notFound = () => Object.assign(new Error("No such object"), { code: 404 });
  const bucket: JsonBucket = {
    file(name, options) {
      return {
        async getMetadata() {
          const object = objects.get(name);
          if (!object) throw notFound();
          return [{ generation: object.generation }];
        },
        async download() {
          onDownload?.(Number(options?.generation));
          const object = objects.get(name);
          if (!object || (options?.generation && object.generation !== Number(options.generation)))
            throw notFound();
          return [Buffer.from(object.body)];
        },
        async save(data, { preconditionOpts }) {
          const current = objects.get(name)?.generation ?? 0;
          if (current !== Number(preconditionOpts.ifGenerationMatch))
            throw Object.assign(new Error("Precondition failed"), { code: 412 });
          objects.set(name, { generation: current + 1, body: data });
        },
      };
    },
  };
  return { bucket, objects };
}

describe("conditional writes to the bucket", () => {
  it("reads again when another writer replaces the object between its lookup and its download", async () => {
    let raced = false;
    const { bucket, objects } = memoryBucket((generation) => {
      // The first pinned download: another run's reservation lands first, as on 2026-10-03.
      if (raced || !generation) return;
      raced = true;
      const state = JSON.parse(objects.get("budget")!.body) as { entries: string[] };
      state.entries.push("other");
      objects.set("budget", { generation: generation + 1, body: JSON.stringify(state) });
    });
    objects.set("budget", { generation: 1, body: JSON.stringify({ entries: ["mine"] }) });
    const settled = await updateObjectJson(
      bucket,
      "budget",
      () => ({ entries: [] as string[] }),
      (state) => {
        // settleRun's check: on an empty "initial" state this threw "Reservation not found".
        if (!state.entries.includes("mine")) throw new Error("Reservation not found");
        state.entries.push("settled");
        return state.entries.length;
      },
    );
    assert.equal(raced, true);
    assert.equal(settled, 3);
    assert.deepEqual(JSON.parse(objects.get("budget")!.body), {
      entries: ["mine", "other", "settled"],
    });
  });

  it("starts from the initial state only when there is no object yet", async () => {
    const { bucket, objects } = memoryBucket();
    await updateObjectJson(
      bucket,
      "new",
      () => ({ n: 0 }),
      (state) => {
        state.n += 1;
      },
    );
    assert.deepEqual(objects.get("new"), { generation: 1, body: '{"n":1}' });
  });
});

describe("reading a file another instance has just replaced", () => {
  it("reads it once more after ESTALE, and passes every other error on", async () => {
    // How Node reports gcsfuse's ESTALE: errno -116, code "Unknown system error -116".
    const stale = Object.assign(new Error("Unknown system error -116"), { errno: -116 });
    let reads = 0;
    const flaky = async () => {
      reads += 1;
      if (reads === 1) throw stale;
      return "fresh";
    };
    assert.equal(await readFresh("events.jsonl", flaky), "fresh");
    assert.equal(reads, 2);
    const missing = Object.assign(new Error("ENOENT"), { code: "ENOENT", errno: -2 });
    await assert.rejects(
      readFresh("events.jsonl", async () => {
        throw missing;
      }),
      missing,
    );
  });
});

const NOW = new Date("2026-10-03T12:00:00.000Z");
const DATE = "2026-10-03";
const entry = (owner: string | undefined, done: boolean, cost: number | null): BudgetEntry => ({
  id: `${owner}-${done}-${cost}`,
  date: DATE,
  scope: "demo",
  amount: 2.5,
  ...(owner ? { owner } : {}),
  cost,
  done,
  startedAt: new Date(NOW.getTime() - 60_000).toISOString(),
});
const state = (...entries: BudgetEntry[]): BudgetState => ({ entries, legacy: {} });

describe("one visitor's share of the daily allowance", () => {
  const visitor = { owner: "me", cap: 3 };

  it("holds one live run or edit per visitor", () => {
    assert.equal(
      admission(state(entry("me", false, null)), DATE, 2.5, 30, NOW, visitor),
      "visitor_busy",
    );
    assert.equal(admission(state(entry("you", false, null)), DATE, 2.5, 30, NOW, visitor), null);
    assert.equal(admission(state(entry("me", true, 0.2)), DATE, 2.5, 30, NOW, visitor), null);
  });

  it("starts nothing more once the visitor's spend today reaches the share", () => {
    const spent = state(entry("me", true, 1.5), { ...entry("me", true, 1.5), id: "second" });
    assert.equal(admission(spent, DATE, 2.5, 30, NOW, visitor), "visitor_daily");
    assert.equal(admission(spent, DATE, 2.5, 30, NOW, { owner: "you", cap: 3 }), null);
    // Without a visitor (scripts) only the shared cap applies.
    assert.equal(admission(spent, DATE, 2.5, 30, NOW), null);
  });

  it("still reports a spent shared allowance first, and a busy one after the visitor's rules", () => {
    assert.equal(
      admission(state(entry("me", true, 4)), DATE, 2.5, 5, NOW, visitor),
      "budget_daily",
    );
    assert.equal(
      admission(state(entry("you", false, null)), DATE, 2.5, 4, NOW, visitor),
      "budget_busy",
    );
  });

  it("refuses a visitor's second reservation until the first is settled", async () => {
    const previous = { data: process.env.DATA_DIR, cap: process.env.DAILY_BUDGET_USD };
    process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-visitor-"));
    process.env.DAILY_BUDGET_USD = "30";
    try {
      const first = await reserveRun("demo", "me");
      const refused = await reserveRun("demo", "me").catch((e: unknown) => e);
      assert.ok(refused instanceof BudgetExhaustedError);
      assert.equal(refused.code, "visitor_busy");
      assert.deepEqual(describeFailure(refused), { code: "visitor_busy", retryable: true });
      await reserveRun("demo", "you");
      await settleRun(first, 0.1);
      await reserveRun("demo", "me");
    } finally {
      for (const [name, value] of [
        ["DATA_DIR", previous.data],
        ["DAILY_BUDGET_USD", previous.cap],
      ] as const)
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
  });

  it("tells the visitor through live status what their next reservation would get", async () => {
    const previous = { data: process.env.DATA_DIR, cap: process.env.DAILY_BUDGET_USD };
    process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-visitor-status-"));
    process.env.DAILY_BUDGET_USD = "30";
    const token = "c".repeat(64);
    const status = async (cookie?: string) => {
      const { GET } = await import("../src/app/api/live-status/route");
      const request = new Request("http://scene.example/api/live-status", {
        headers: cookie ? { cookie } : {},
      });
      return (await GET(request)).json();
    };
    try {
      const held = await reserveRun("demo", ownerHash(token));
      const busy = await status(`theme=dark; ${OWNER_COOKIE}=${token}`);
      assert.equal(busy.canStart, false);
      assert.equal(busy.reason, null);
      assert.equal(busy.visitor, "visitor_busy");
      // Another visitor, and a page without a session, may still start one.
      assert.deepEqual(
        [(await status(`${OWNER_COOKIE}=${"d".repeat(64)}`)).canStart, (await status()).visitor],
        [true, null],
      );
      await settleRun(held, 3);
      const spent = await status(`${OWNER_COOKIE}=${token}`);
      assert.deepEqual([spent.canStart, spent.visitor], [false, "visitor_daily"]);
    } finally {
      for (const [name, value] of [
        ["DATA_DIR", previous.data],
        ["DAILY_BUDGET_USD", previous.cap],
      ] as const)
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    }
  });
});

describe("settling a finished run's reservation", () => {
  it("tries a failed write again, so the visitor is not held busy until the time limit", async () => {
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-settle-"));
    const warn = console.warn;
    try {
      const reservation = await reserveRun("demo", "me");
      // Another writer holds the local lock past updateJson's wait; it lets go once a retry is due.
      const lock = join(process.env.DATA_DIR, "budget", "demo-v2.json.lock");
      await mkdir(lock);
      let retries = 0;
      console.warn = (message: unknown) => {
        if (String(message).startsWith("settlement retry:")) retries += 1;
        void rm(lock, { recursive: true });
      };
      await settleRun(reservation, 0.4);
      assert.equal(retries, 1);
      const state = JSON.parse(
        await readFile(join(process.env.DATA_DIR, "budget", "demo-v2.json"), "utf8"),
      ) as BudgetState;
      assert.deepEqual(
        state.entries.map((e) => [e.cost, e.done]),
        [[0.4, true]],
      );
      // A reservation that is not there is reported at once, not tried again.
      const started = Date.now();
      await assert.rejects(settleRun({ ...reservation, id: "gone" }, 0), /Reservation not found/);
      assert.equal(retries, 1);
      assert.ok(Date.now() - started < 500);
    } finally {
      console.warn = warn;
      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
    }
  });
});

const SAMPLE: Project = {
  id: "sample-clip",
  title: "Sample clip",
  kind: "sample",
  clipSeconds: 10,
  filmLanguageCode: "en-US",
  attribution: "fixture",
  license: "fixture",
  createdAt: "2026-10-03T00:00:00.000Z",
  stripStepSeconds: 1,
};
const BASE = "20260928t064307205-en-standard-221ceb";
const ME = ownerHash("c".repeat(64));
const YOU = ownerHash("d".repeat(64));

async function writeRun(runId: string, files: Record<string, unknown>): Promise<void> {
  const dir = runDir(SAMPLE.id, runId);
  await mkdir(join(dir, "voice"), { recursive: true });
  for (const [name, content] of Object.entries(files))
    await writeFile(
      join(dir, name),
      Array.isArray(content)
        ? content.map((e) => JSON.stringify(e)).join("\n") + "\n"
        : JSON.stringify(content),
    );
}

describe("edits that fail, are retried, or are still being made", () => {
  let dir: string;
  const previous = {
    data: process.env.DATA_DIR,
    ffmpeg: process.env.FFMPEG_PATH,
    cap: process.env.DAILY_BUDGET_USD,
  };
  const original = globalThis.fetch;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "scene-edit-retry-"));
    process.env.DATA_DIR = dir;
    process.env.DAILY_BUDGET_USD = "30";
    // A removal stops at its first media step (no ffmpeg here), before any paid call.
    process.env.FFMPEG_PATH = join(dir, "no-ffmpeg");
    globalThis.fetch = (async () => {
      throw new Error("no network in this test");
    }) as typeof fetch;
    await writeProject(SAMPLE);
    // The clip an edit stats to find its kept watching copy; never decoded here (no ffmpeg).
    await writeFile(join(dir, "projects", SAMPLE.id, "clip.mp4"), "");
    const cue = {
      id: "L1",
      gapId: "g1",
      start: 1,
      seconds: 1,
      windowEnd: 5,
      status: "fits",
      audioFile: "voice/L1.wav",
      versions: [{ text: "A woman waits.", start: 1, by: "write", model: "fixture" }],
    } as Cue;
    await writeRun(BASE, {
      "events.jsonl": [
        { type: "run_started", runId: BASE, language: "en", density: "standard", t: 0 },
        { type: "run_done", t: 1 },
      ],
      "script.json": { runId: BASE, cues: [cue], gaps: [{ id: "g1", start: 0, end: 5 }] },
    });
    await writeFile(
      join(runDir(SAMPLE.id, BASE), "voice", "L1.wav"),
      encodeWav(new Int16Array(16000), 16000),
    );
  });

  after(async () => {
    globalThis.fetch = original;
    for (const [name, value] of [
      ["DATA_DIR", previous.data],
      ["FFMPEG_PATH", previous.ffmpeg],
      ["DAILY_BUDGET_USD", previous.cap],
    ] as const)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    await rm(dir, { recursive: true, force: true });
  });

  it("answers a malformed base run id as a missing run", async () => {
    const removal = { cueId: "L1", action: "remove" as const, requestId: "malformed-0001" };
    for (const runId of ["ABC", "a", "a".repeat(300), "../../x", "x\ny"]) {
      const error = await editRun(SAMPLE.id, runId, removal, ME).catch((e: unknown) => e);
      assert.ok(error instanceof EditError, runId);
      assert.deepEqual([error.code, error.status], ["not_found", 404]);
    }
  });

  it("makes a failed attempt again on a retry, in a run of its own, and keeps only its code", async () => {
    const removal = { cueId: "L1", action: "remove" as const, requestId: "retry-after-0001" };
    const spawnFailure = { code: "ENOENT", syscall: `spawn ${process.env.FFMPEG_PATH}` };
    await assert.rejects(editRun(SAMPLE.id, BASE, removal, ME), spawnFailure);
    // Before 2026-10-03 this answered 409 "failed" with the first error's raw text, forever.
    await assert.rejects(editRun(SAMPLE.id, BASE, removal, ME), spawnFailure);
    const runs = (await readdir(join(dir, "projects", SAMPLE.id, "runs"))).filter((id) =>
      id.startsWith("edit-"),
    );
    assert.equal(runs.length, 2);
    assert.ok(runs.some((id) => id.endsWith("-2")));
    const claims = join(dir, "projects", SAMPLE.id, "edits");
    const [claim] = await readdir(claims);
    const record = JSON.parse(await readFile(join(claims, claim), "utf8"));
    assert.deepEqual([record.state, record.attempts, record.error], ["failed", 2, "internal"]);
    // Both attempts were settled, so the visitor can start the next one.
    await settleRun(await reserveRun("demo", ME), 0);
  });

  it("answers a retry while the attempt is still going with 409 running, until its time is up", async () => {
    const removal = { cueId: "L1", action: "remove" as const, requestId: "retry-while-0001" };
    await assert.rejects(editRun(SAMPLE.id, BASE, removal, ME));
    const claims = join(dir, "projects", SAMPLE.id, "edits");
    for (const name of await readdir(claims)) {
      const file = join(claims, name);
      const record = JSON.parse(await readFile(file, "utf8"));
      if (record.attempts !== 1) continue;
      await writeFile(
        file,
        JSON.stringify({ ...record, state: "running", startedAt: new Date().toISOString() }),
      );
      const busy = await editRun(SAMPLE.id, BASE, removal, ME).catch((e: unknown) => e);
      assert.ok(busy instanceof EditError);
      assert.deepEqual([busy.code, busy.status], ["running", 409]);
      assert.doesNotMatch(busy.message, /spawn|ENOENT/);
      const stale = new Date(Date.now() - (RUN_TIME_LIMIT_SECONDS + 1) * 1000).toISOString();
      await writeFile(file, JSON.stringify({ ...record, state: "running", startedAt: stale }));
      await assert.rejects(editRun(SAMPLE.id, BASE, removal, ME), { code: "ENOENT" });
    }
  });

  it("lists the viewer's own edit while it is being made, and its run as running", async () => {
    const editing = `edit-${"e".repeat(40)}`;
    const startedAt = new Date().toISOString();
    await writeRun(editing, {
      [RUN_EDITOR_FILE]: {
        ownerHash: ME,
        startedAt,
        baseRunId: BASE,
        cueId: "L1",
        action: "rewrite",
        language: "en",
        density: "standard",
      },
    });
    // An edit from before 2026-10-03 has only its owner and is never listed as unfinished.
    await writeRun(`edit-${"f".repeat(40)}`, { [RUN_EDITOR_FILE]: { ownerHash: ME } });
    assert.deepEqual(await listActiveWork(SAMPLE.id, ME), {
      active: [],
      edits: [
        {
          runId: editing,
          baseRunId: BASE,
          cueId: "L1",
          action: "rewrite",
          language: "en",
          density: "standard",
          startedAt,
        },
      ],
    });
    assert.deepEqual(await listActiveWork(SAMPLE.id, YOU), { active: [], edits: [] });
    assert.deepEqual(await readRunSnapshot(SAMPLE.id, editing), { events: [], status: "running" });
  });

  it("never lists a run whose events end in run_done as still being made", async () => {
    const now = Date.now();
    const runId = new Date(now - 30_000)
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(".", "")
      .slice(0, 18)
      .toLowerCase()
      .concat("-en-standard-aaaaaa");
    const owner = { ownerHash: YOU, startedAt: new Date(now - 30_000).toISOString() };
    // script.json not visible yet (another instance's view of the bucket before 2026-10-03).
    await writeRun(runId, {
      [RUN_OWNER_FILE]: { ...owner, language: "en", density: "standard" },
      "events.jsonl": [
        { type: "run_started", runId, language: "en", density: "standard", t: 0 },
        { type: "run_done", t: 20 },
      ],
    });
    assert.deepEqual((await listActiveWork(SAMPLE.id, YOU, now)).active, []);
    // The same run without its final event is still being made.
    await writeRun(runId, {
      "events.jsonl": [{ type: "run_started", runId, language: "en", density: "standard", t: 0 }],
    });
    assert.deepEqual(
      (await listActiveWork(SAMPLE.id, YOU, now)).active.map((r) => r.runId),
      [runId],
    );
    // A run whose id dates it past the time limit is not even read.
    const later = now + (RUN_TIME_LIMIT_SECONDS + 120) * 1000;
    assert.deepEqual((await listActiveWork(SAMPLE.id, YOU, later)).active, []);
  });
});
