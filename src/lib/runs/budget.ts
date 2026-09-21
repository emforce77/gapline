import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "../store/projects";

/**
 * A public demo URL can be run by anyone, so live runs share a daily allowance.
 * Each run reserves the most a short clip has cost so far and settles to the measured cost when done.
 */
export const RUN_RESERVE_USD = 0.3;

function dailyCap(): number {
  const cap = Number(process.env.DAILY_BUDGET_USD ?? "5");
  if (!Number.isFinite(cap) || cap <= 0)
    throw new Error("DAILY_BUDGET_USD must be a positive number");
  return cap;
}

interface DayLedger {
  date: string;
  settledUsd: number;
  reservedUsd: number;
  runs: number;
}

function ledgerFile(date: string): string {
  return join(dataDir(), "budget", `${date}.json`);
}

async function readDay(date: string): Promise<DayLedger> {
  try {
    return JSON.parse(await readFile(ledgerFile(date), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { date, settledUsd: 0, reservedUsd: 0, runs: 0 };
    }
    throw error;
  }
}

async function writeDay(day: DayLedger): Promise<void> {
  await mkdir(join(dataDir(), "budget"), { recursive: true });
  await writeFile(ledgerFile(day.date), JSON.stringify(day, null, 2));
}

export class BudgetExhaustedError extends Error {}

export async function reserveRun(): Promise<{ date: string }> {
  const date = new Date().toISOString().slice(0, 10);
  const day = await readDay(date);
  if (day.settledUsd + day.reservedUsd + RUN_RESERVE_USD > dailyCap()) {
    throw new BudgetExhaustedError(
      `Today's live-run allowance ($${dailyCap().toFixed(2)}) is used up; the recorded runs remain viewable.`,
    );
  }
  day.reservedUsd += RUN_RESERVE_USD;
  await writeDay(day);
  return { date };
}

export async function settleRun(reservation: { date: string }, costUsd: number): Promise<void> {
  const day = await readDay(reservation.date);
  day.reservedUsd = Math.max(0, day.reservedUsd - RUN_RESERVE_USD);
  day.settledUsd += costUsd;
  day.runs += 1;
  await writeDay(day);
}
