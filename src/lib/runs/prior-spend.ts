import type { CallRecord } from "../llm/ledger";

/** An unclean task may have made one Gemini call that never reached its ledger. */
const UNCLEAN_ATTEMPT_USD = 1.1;

/** Rehydrate the run's allowance before another attempt is allowed to make a paid call. */
export function priorSpend(calls: CallRecord[], uncleanAttempts: number, limit: number): number {
  if (
    !Number.isSafeInteger(uncleanAttempts) ||
    uncleanAttempts < 0 ||
    !Number.isFinite(limit) ||
    limit <= 0
  )
    throw new Error("Invalid previous attempt budget");
  let spent = uncleanAttempts * UNCLEAN_ATTEMPT_USD;
  for (const call of calls) {
    // An old unresolved row with no recorded bound cannot safely release any of the reservation.
    const charge = call.costKnown === false ? (call.boundUsd ?? limit) : call.costUsd;
    if (!Number.isFinite(charge) || charge < 0) throw new Error("Invalid charge in run ledger");
    spent += charge;
  }
  return Math.min(limit, spent);
}
