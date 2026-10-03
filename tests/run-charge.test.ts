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
import { executeRun, prepareRun } from "../src/lib/runs/start-run";
import { projectDir, writeProject } from "../src/lib/store/projects";

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
});
