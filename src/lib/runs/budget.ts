import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "../store/projects";
import { updateJson } from "../store/atomic";

/** A conservative run ceiling; each paid call also checks its remaining allowance. */
export const RUN_RESERVE_USD = 2.5;
export type BudgetScope = "demo" | "experiment";
export interface Reservation {
  id: string;
  date: string;
  scope: BudgetScope;
  amount: number;
}
interface Entry extends Reservation {
  cost: number | null;
  done: boolean;
}
interface BudgetState {
  entries: Entry[];
  legacy: Record<string, number>;
}
export class BudgetExhaustedError extends Error {}

function dailyCap(scope: BudgetScope): number {
  const cap = scope === "experiment" ? 10 : Number(process.env.DAILY_BUDGET_USD ?? "5");
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("Invalid DAILY_BUDGET_USD");
  return cap;
}
export async function reserveRun(scope: BudgetScope = "demo"): Promise<Reservation> {
  const date = new Date().toISOString().slice(0, 10);
  let legacy = 0;
  if (scope === "demo") {
    try {
      const old = JSON.parse(await readFile(join(dataDir(), "budget", `${date}.json`), "utf8"));
      legacy = old.settledUsd + old.reservedUsd;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  const reservation: Reservation = { id: randomUUID(), date, scope, amount: RUN_RESERVE_USD };
  return updateJson<BudgetState, Reservation>(
    `budget/${scope}-v2.json`,
    () => ({ entries: [], legacy: {} }),
    (state) => {
      state.legacy[date] ??= legacy;
      const charge = (e: Entry) => e.cost ?? e.amount;
      const today = state.entries
        .filter((e) => e.date === date)
        .reduce((s, e) => s + charge(e), state.legacy[date]);
      const total = state.entries.reduce((s, e) => s + charge(e), 0);
      if (
        today + reservation.amount > dailyCap(scope) + 1e-9 ||
        (scope === "experiment" &&
          (total + reservation.amount > 20 || state.entries.some((e) => !e.done)))
      )
        throw new BudgetExhaustedError(
          "Budget or concurrency allowance exhausted; recorded runs remain available.",
        );
      state.entries.push({ ...reservation, cost: null, done: false });
      return reservation;
    },
  );
}
export async function settleRun(reservation: Reservation, costUsd: number | null): Promise<void> {
  if (costUsd !== null && (!Number.isFinite(costUsd) || costUsd < 0))
    throw new Error("Invalid cost");
  await updateJson<BudgetState, void>(
    `budget/${reservation.scope}-v2.json`,
    () => ({ entries: [], legacy: {} }),
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
  if (state.spent + state.pending + maxUsd > state.limit + 1e-9)
    throw new BudgetExhaustedError(
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
