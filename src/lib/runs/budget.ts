import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  RUN_TIME_LIMIT_SECONDS,
  type BudgetErrorCode,
  type LiveStatus,
  type VisitorBudgetErrorCode,
} from "../api-contract";
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
  /** Owner hash of the visitor whose run or edit holds it; absent for scripts and older entries. */
  owner?: string;
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
    public code: BudgetErrorCode | VisitorBudgetErrorCode | "run_allowance",
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

/**
 * What one visitor may use of the demo allowance in a day (VISITOR_DAILY_BUDGET_USD, default $3).
 * A visitor is a browser session (the owner cookie), and a new one costs nothing to get, so this
 * and the one-at-a-time rule keep an ordinary visitor (two tabs, two languages, a reload) from
 * holding the shared pool; they do not stop a script. The daily cap stays the hard ceiling.
 */
function visitorDailyCap(): number {
  const cap = Number(process.env.VISITOR_DAILY_BUDGET_USD ?? "3");
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("Invalid VISITOR_DAILY_BUDGET_USD");
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
 * With a `visitor`, it also holds one live entry at most, and starts nothing once what it has
 * spent today reaches its share; the run in flight then ends its day's use.
 */
export function admission(
  state: BudgetState,
  date: string,
  amount: number,
  cap: number,
  now: Date,
): BudgetErrorCode | null;
export function admission(
  state: BudgetState,
  date: string,
  amount: number,
  cap: number,
  now: Date,
  visitor?: { owner: string; cap: number },
): BudgetErrorCode | VisitorBudgetErrorCode | null;
export function admission(
  state: BudgetState,
  date: string,
  amount: number,
  cap: number,
  now: Date,
  visitor?: { owner: string; cap: number },
): BudgetErrorCode | VisitorBudgetErrorCode | null {
  const live = (e: BudgetEntry) =>
    !e.done &&
    (e.startedAt === undefined ||
      now.getTime() - Date.parse(e.startedAt) < STALE_RESERVATION_SECONDS * 1000);
  const charge = (s: number, e: BudgetEntry) => s + (e.cost ?? e.amount);
  const today = state.entries.filter((e) => e.date === date);
  const spent = today.filter((e) => !live(e)).reduce(charge, state.legacy[date] ?? 0);
  const held = today.filter(live).reduce((s, e) => s + e.amount, 0);
  if (spent + amount > cap + CAP_EPSILON) return "budget_daily";
  if (visitor) {
    const own = today.filter((e) => e.owner === visitor.owner);
    if (own.some(live)) return "visitor_busy";
    if (own.reduce(charge, 0) >= visitor.cap - CAP_EPSILON) return "visitor_daily";
  }
  if (spent + held + amount > cap + CAP_EPSILON) return "budget_busy";
  return null;
}

const REFUSALS: Record<BudgetErrorCode | VisitorBudgetErrorCode, string> = {
  budget_daily: "Today's live allowance is spent.",
  budget_busy: "Another live run holds today's allowance.",
  visitor_busy: "This visitor's other live run or edit is still going.",
  visitor_daily: "This visitor used their share of today's live allowance.",
};

/**
 * Holds RUN_RESERVE_USD of today's allowance for one run or edit. `owner` (the visitor's owner
 * hash) applies the per-visitor rules on the demo allowance; scripts pass none.
 */
export async function reserveRun(
  scope: BudgetScope = "demo",
  owner?: string,
): Promise<Reservation> {
  const now = new Date();
  const { date, resetAt } = budgetDay(now);
  const legacy = await legacySpend(scope, date);
  const reservation: Reservation = {
    id: randomUUID(),
    date,
    scope,
    amount: RUN_RESERVE_USD,
    ...(owner ? { owner } : {}),
  };
  const visitor = owner && scope === "demo" ? { owner, cap: visitorDailyCap() } : undefined;
  return updateJson<BudgetState, Reservation>(`budget/${scope}-v2.json`, initialState, (state) => {
    state.legacy[date] ??= legacy;
    let refusal = admission(state, date, reservation.amount, dailyCap(scope), now, visitor);
    if (!refusal && scope === "experiment") {
      const total = state.entries.reduce((s, e) => s + (e.cost ?? e.amount), 0);
      if (total + reservation.amount > 20) refusal = "budget_daily";
      else if (state.entries.some((e) => !e.done)) refusal = "budget_busy";
    }
    if (refusal)
      throw new BudgetExhaustedError(
        refusal,
        REFUSALS[refusal],
        refusal === "budget_daily" || refusal === "visitor_daily" ? resetAt : undefined,
      );
    state.entries.push({ ...reservation, cost: null, done: false, startedAt: now.toISOString() });
    return reservation;
  });
}

/**
 * Read-only check for the browser, before it uploads or asks for a run. With the viewer's owner
 * hash it also applies the per-visitor rules, so a page is not offered a start reserveRun refuses.
 */
export async function liveStatus(viewer?: string, now = new Date()): Promise<LiveStatus> {
  const { date, resetAt } = budgetDay(now);
  const state = await readJson<BudgetState>("budget/demo-v2.json", initialState);
  state.legacy[date] ??= await legacySpend("demo", date);
  const cap = dailyCap("demo");
  const reason = admission(state, date, RUN_RESERVE_USD, cap, now);
  const own = viewer
    ? admission(state, date, RUN_RESERVE_USD, cap, now, { owner: viewer, cap: visitorDailyCap() })
    : null;
  const visitor = own === "visitor_busy" || own === "visitor_daily" ? own : null;
  return { canStart: reason === null && visitor === null, reason, visitor, resetAt };
}

/**
 * Pauses before settleRun tries again. An entry left unsettled holds its visitor as busy and counts
 * its whole reservation until the time limit (admission), and the budget object takes about one
 * write a second (a busy object answers 429/503), so a failed write is worth two more tries.
 */
const SETTLE_RETRY_DELAYS_MS = [1_000, 3_000];

export async function settleRun(reservation: Reservation, costUsd: number | null): Promise<void> {
  if (costUsd !== null && (!Number.isFinite(costUsd) || costUsd < 0))
    throw new Error("Invalid cost");
  let missing = false;
  for (let attempt = 0; ; attempt++) {
    try {
      await updateJson<BudgetState, void>(
        `budget/${reservation.scope}-v2.json`,
        initialState,
        (state) => {
          const entry = state.entries.find((e) => e.id === reservation.id);
          missing = !entry;
          if (!entry) throw new Error("Reservation not found");
          if (entry.done) return;
          entry.cost = costUsd;
          entry.done = true;
        },
      );
      return;
    } catch (error) {
      // A reservation that is not there will not appear by trying again.
      if (missing || attempt === SETTLE_RETRY_DELAYS_MS.length) throw error;
      console.warn(`settlement retry: reservation=${reservation.id} attempt=${attempt + 1}`, error);
      await delay(SETTLE_RETRY_DELAYS_MS[attempt]);
    }
  }
}
/** What one run's paid calls have used: settled calls at their cost, unknown ones at their bound. */
export interface RunBudget {
  limit: number;
  spent: number;
  /** Bounds of calls still in flight. */
  pending: number;
}
const running = new AsyncLocalStorage<RunBudget>();
export function newRunBudget(reservation: Reservation): RunBudget {
  return { limit: reservation.amount, spent: 0, pending: 0 };
}
export function withRunBudget<T>(
  reservation: Reservation,
  work: () => Promise<T>,
  budget: RunBudget = newRunBudget(reservation),
): Promise<T> {
  return running.run(budget, work);
}
/**
 * The most a run can have been charged when its ledger cannot say exactly (a call without usage,
 * a run that stopped before writing its ledger): every call so far at its cost or, if unknown, its
 * bound, plus the calls still in flight at their bound. Never more than the reservation.
 */
export function runChargeBound(budget: RunBudget): number {
  return Math.min(budget.limit, budget.spent + budget.pending);
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
