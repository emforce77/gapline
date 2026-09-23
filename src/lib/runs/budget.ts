import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { RUN_TIME_LIMIT_SECONDS, type BudgetErrorCode, type LiveStatus } from "../api-contract";
import { dataDir } from "../store/projects";
import { readJson, updateJson } from "../store/atomic";

/** A conservative run ceiling; each paid call also checks its remaining allowance. */
export const RUN_RESERVE_USD = 2.5;
/** Float slack when comparing dollar sums against the cap. */
const CAP_EPSILON = 1e-9;
/** Seconds after its start when an unsettled reservation can no longer belong to a live run. */
const STALE_RESERVATION_SECONDS = RUN_TIME_LIMIT_SECONDS + 60;
export type BudgetScope = "demo" | "experiment";
export interface Reservation {
  id: string;
  date: string;
  scope: BudgetScope;
  amount: number;
}
export interface BudgetEntry extends Reservation {
  cost: number | null;
  done: boolean;
  /** ISO start time; absent on entries written before 2026-09-23. */
  startedAt?: string;
}
export interface BudgetState {
  entries: BudgetEntry[];
  legacy: Record<string, number>;
}
/** busy: another live run holds the rest of today's allowance. daily: today's allowance is spent. */
export class BudgetExhaustedError extends Error {
  constructor(
    public code: BudgetErrorCode | "run_allowance",
    message: string,
    public resetAt?: string,
  ) {
    super(message);
  }
}

function dailyCap(scope: BudgetScope): number {
  const cap = scope === "experiment" ? 10 : Number(process.env.DAILY_BUDGET_USD ?? "5");
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("Invalid DAILY_BUDGET_USD");
  return cap;
}

/** The budget day is the UTC date; it renews at the next 00:00 UTC. */
export function budgetDay(now: Date): { date: string; resetAt: string } {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return { date: now.toISOString().slice(0, 10), resetAt: new Date(next).toISOString() };
}

function initialState(): BudgetState {
  return { entries: [], legacy: {} };
}

/** Spend recorded by the budget format used before per-run reservations (demo scope only). */
async function legacySpend(scope: BudgetScope, date: string): Promise<number> {
  if (scope !== "demo") return 0;
  try {
    const old = JSON.parse(await readFile(join(dataDir(), "budget", `${date}.json`), "utf8"));
    return old.settledUsd + old.reservedUsd;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return 0;
  }
}

/**
 * Whether one more reservation of `amount` fits today's cap, and if not, why. Unsettled entries
 * younger than a run's time limit belong to live runs ("busy"); everything else, including
 * unsettled entries past the limit, is spend ("daily"). Charges are the same either way.
 */
export function admission(
  state: BudgetState,
  date: string,
  amount: number,
  cap: number,
  now: Date,
): BudgetErrorCode | null {
  const live = (e: BudgetEntry) =>
    !e.done &&
    (e.startedAt === undefined ||
      now.getTime() - Date.parse(e.startedAt) < STALE_RESERVATION_SECONDS * 1000);
  const today = state.entries.filter((e) => e.date === date);
  const spent = today
    .filter((e) => !live(e))
    .reduce((s, e) => s + (e.cost ?? e.amount), state.legacy[date] ?? 0);
  const held = today.filter(live).reduce((s, e) => s + e.amount, 0);
  if (spent + amount > cap + CAP_EPSILON) return "budget_daily";
  if (spent + held + amount > cap + CAP_EPSILON) return "budget_busy";
  return null;
}

export async function reserveRun(scope: BudgetScope = "demo"): Promise<Reservation> {
  const now = new Date();
  const { date, resetAt } = budgetDay(now);
  const legacy = await legacySpend(scope, date);
  const reservation: Reservation = { id: randomUUID(), date, scope, amount: RUN_RESERVE_USD };
  return updateJson<BudgetState, Reservation>(`budget/${scope}-v2.json`, initialState, (state) => {
    state.legacy[date] ??= legacy;
    let refusal = admission(state, date, reservation.amount, dailyCap(scope), now);
    if (!refusal && scope === "experiment") {
      const total = state.entries.reduce((s, e) => s + (e.cost ?? e.amount), 0);
      if (total + reservation.amount > 20) refusal = "budget_daily";
      else if (state.entries.some((e) => !e.done)) refusal = "budget_busy";
    }
    if (refusal === "budget_daily")
      throw new BudgetExhaustedError(refusal, "Today's live allowance is spent.", resetAt);
    if (refusal === "budget_busy")
      throw new BudgetExhaustedError(refusal, "Another live run holds today's allowance.");
    state.entries.push({ ...reservation, cost: null, done: false, startedAt: now.toISOString() });
    return reservation;
  });
}

/** Read-only check for the browser, before it uploads or asks for a run. */
export async function liveStatus(now = new Date()): Promise<LiveStatus> {
  const { date, resetAt } = budgetDay(now);
  const state = await readJson<BudgetState>("budget/demo-v2.json", initialState);
  state.legacy[date] ??= await legacySpend("demo", date);
  const reason = admission(state, date, RUN_RESERVE_USD, dailyCap("demo"), now);
  return { canStart: reason === null, reason, resetAt };
}

export async function settleRun(reservation: Reservation, costUsd: number | null): Promise<void> {
  if (costUsd !== null && (!Number.isFinite(costUsd) || costUsd < 0))
    throw new Error("Invalid cost");
  await updateJson<BudgetState, void>(
    `budget/${reservation.scope}-v2.json`,
    initialState,
    (state) => {
      const entry = state.entries.find((e) => e.id === reservation.id);
      if (!entry) throw new Error("Reservation not found");
      if (entry.done) return;
      entry.cost = costUsd;
      entry.done = true;
    },
  );
}
const running = new AsyncLocalStorage<{ limit: number; spent: number; pending: number }>();
export function withRunBudget<T>(reservation: Reservation, work: () => Promise<T>): Promise<T> {
  return running.run({ limit: reservation.amount, spent: 0, pending: 0 }, work);
}
/** Unknown charges consume the full bound; failed and retried requests count too. */
export function reserveCall(maxUsd: number): (costUsd: number | null) => void {
  const state = running.getStore();
  if (!state) return () => {};
  if (state.spent + state.pending + maxUsd > state.limit + CAP_EPSILON)
    throw new BudgetExhaustedError(
      "run_allowance",
      "This run reached its API allowance. Saved analysis can be reused.",
    );
  state.pending += maxUsd;
  let done = false;
  return (cost) => {
    if (done) return;
    done = true;
    state.pending -= maxUsd;
    state.spent += cost ?? maxUsd;
  };
}
