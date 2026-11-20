import { AsyncLocalStorage } from "node:async_hooks";

/** In-flight media and provider calls share the attempt's deadline and shutdown signal. */
export const attemptSignal = new AsyncLocalStorage<AbortSignal>();

export function withinAttempt(signal: AbortSignal): AbortSignal {
  const current = attemptSignal.getStore();
  return current ? AbortSignal.any([current, signal]) : signal;
}
