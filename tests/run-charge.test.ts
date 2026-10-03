import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  newRunBudget,
  reserveCall,
  reserveRun,
  runChargeBound,
  withRunBudget,
  type BudgetState,
  type Reservation,
} from "../src/lib/runs/budget";
import { ServiceError } from "../src/lib/errors";
import { readCallRecords } from "../src/lib/llm/ledger";
import {
  placeLongSpans,
  settledSpeechCost,
  speechCostUsd,
  type RecognizedChunk,
  type SpeechOutcomes,
} from "../src/lib/pipeline/hear";
import { relistenGaps } from "../src/lib/pipeline/relisten";
import { synthesizeLine } from "../src/lib/pipeline/voice";
import { executeRun, prepareRun } from "../src/lib/runs/start-run";
import { projectDir, writeProject } from "../src/lib/store/projects";
import { withFetch } from "./with-fetch";

const RESERVATION: Reservation = { id: "fixture", date: "2026-10-03", scope: "demo", amount: 2.5 };

describe("what a run is charged when its ledger cannot say", () => {
  it("bounds a run by its calls, not by its reservation", async () => {
    const budget = newRunBudget(RESERVATION);
    assert.equal(runChargeBound(budget), 0);
    await withRunBudget(
      RESERVATION,
      async () => {
        reserveCall(0.3)(null); // unknown cost: its whole bound
        reserveCall(0.2)(0.05); // known cost
        reserveCall(0.4); // still in flight: its bound
      },
      budget,
    );
    assert.equal(runChargeBound(budget).toFixed(2), "0.75");
    budget.spent = 9;
    assert.equal(runChargeBound(budget), 2.5);
  });

  it("settles a run that stops before any paid call at no charge", async () => {
    const previous = {
      data: process.env.DATA_DIR,
      ffmpeg: process.env.FFMPEG_PATH,
      cap: process.env.DAILY_BUDGET_USD,
    };
    const originalFetch = globalThis.fetch;
    let calls = 0;
    process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-charge-"));
    process.env.FFMPEG_PATH = join(process.env.DATA_DIR, "no-ffmpeg");
    process.env.DAILY_BUDGET_USD = "5";
    globalThis.fetch = (async () => {
      calls += 1;
      throw new Error("no network in this test");
    }) as typeof fetch;
    try {
      await writeProject({
        id: "u-charge",
        title: "fixture",
        kind: "upload",
        clipSeconds: 10,
        filmLanguageCode: "en-US",
        attribution: "fixture",
        license: "fixture",
        createdAt: "2026-10-03T00:00:00.000Z",
        stripStepSeconds: 1,
      });
      await writeFile(join(projectDir("u-charge"), "clip.mp4"), "not a video");
      const run = await prepareRun({ projectId: "u-charge", language: "en", density: "standard" });
      const reservation = await reserveRun();
      await assert.rejects(executeRun(run, reservation));
      const state = JSON.parse(
        await readFile(join(process.env.DATA_DIR, "budget/demo-v2.json"), "utf8"),
      ) as BudgetState;
      const entry = state.entries.find((e) => e.id === reservation.id)!;
      assert.equal(entry.done, true);
      // Before 2026-10-03 this was null, which the daily cap counts as the full $2.50.
      assert.equal(typeof entry.cost, "number");
      assert.ok(entry.cost! < reservation.amount, `charged ${entry.cost}`);
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = originalFetch;
      for (const [name, value] of [
        ["DATA_DIR", previous.data],
        ["FFMPEG_PATH", previous.ffmpeg],
        ["DAILY_BUDGET_USD", previous.cap],
      ] as const) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it("charges a voice request the provider refused nothing", async () => {
    const ledgerFile = join(await mkdtemp(join(tmpdir(), "scene-charge-tts-")), "ledger.jsonl");
    const budget = newRunBudget(RESERVATION);
    await withFetch(
      // A 401 is sent once more with a new token (googleFetch); a 403 is the refusal as it is.
      async () => Response.json({ error: { status: "PERMISSION_DENIED" } }, { status: 403 }),
      () =>
        withRunBudget(
          RESERVATION,
          async () => {
            const refused = synthesizeLine({
              text: "A woman waits on the bridge.",
              language: "en",
              speakingRate: 1,
              ledgerFile,
              label: "voice:edit",
            });
            await assert.rejects(refused, ServiceError);
          },
          budget,
        ),
    );
    const [record] = await readCallRecords(ledgerFile);
    assert.deepEqual(
      [record.ok, record.costUsd, record.costKnown, record.costSource],
      [false, 0, true, "not_billed"],
    );
    // Before 2026-10-03 its bound stayed charged, and the run's ledger became "unresolved".
    assert.equal(runChargeBound(budget), 0);
  });
});

describe("what a refused speech request is charged", () => {
  const refused = (status: number) =>
    new ServiceError("speech_failed", `Speech-to-Text HTTP ${status}`, status === 429, status);
  const answered = (billedSeconds: number): PromiseSettledResult<RecognizedChunk> => ({
    status: "fulfilled",
    value: { words: [], untimed: 0, billedSeconds },
  });
  const failed = (reason: unknown): PromiseSettledResult<RecognizedChunk> => ({
    status: "rejected",
    reason,
  });

  it("charges nothing for a 4xx other than 429, and the answered requests at list price", () => {
    for (const status of [400, 401, 403, 404]) {
      assert.equal(settledSpeechCost([failed(refused(status))]), 0, String(status));
    }
    assert.equal(settledSpeechCost([answered(12), failed(refused(403))]), speechCostUsd(12));
  });

  it("leaves the charge unknown when a failure may have been billed", () => {
    const unknown: SpeechOutcomes[] = [
      [failed(refused(429))],
      [failed(refused(503))],
      [failed(new ServiceError("speech_failed", "unreachable", true))],
      [failed(new Error("ffmpeg exited 1"))],
      [answered(0), failed(refused(403))],
    ];
    for (const outcomes of unknown) assert.equal(settledSpeechCost(outcomes), null);
  });

  it("settles a re-listen the recognizer refused at no charge and records it as not billed", async () => {
    const ledgerFile = join(await mkdtemp(join(tmpdir(), "scene-charge-stt-")), "ledger.jsonl");
    const budget = newRunBudget(RESERVATION);
    let requests = 0;
    await withRunBudget(
      RESERVATION,
      async () => {
        const heard = relistenGaps({
          speech: [{ start: 4, end: 5, speaker: "", text: "a word" }],
          clipSeconds: 20,
          ledgerFile,
          recognize: async () => {
            requests += 1;
            throw refused(403);
          },
        });
        await assert.rejects(heard, ServiceError);
      },
      budget,
    );
    assert.ok(requests > 0);
    const [record] = await readCallRecords(ledgerFile);
    assert.deepEqual(
      [record.ok, record.costUsd, record.costKnown, record.costSource],
      [false, 0, true, "not_billed"],
    );
    // Before 2026-10-03 the whole reservation of a failed recognition stayed charged.
    assert.equal(runChargeBound(budget), 0);
  });

  it("charges a re-heard span's refused halves nothing", async () => {
    const budget = newRunBudget(RESERVATION);
    await withRunBudget(
      RESERVATION,
      async () => {
        const placing = placeLongSpans(
          [{ start: 0, end: 20, word: "x", untimed: true }],
          async () => {
            throw refused(400);
          },
          20,
        );
        await assert.rejects(placing, ServiceError);
      },
      budget,
    );
    assert.equal(runChargeBound(budget), 0);
  });
});
