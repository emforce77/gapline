import { readFile } from "node:fs/promises";
import { BufferedAppend } from "../store/buffered-append";

/** One paid call. New Gemini costs are token-based estimates; historical records retain their source. */
export interface CallRecord {
  at: string;
  label: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  /** False when usage is incomplete; costUsd contributes only the known subtotal. */
  costKnown?: boolean;
  /**
   * Optional for compatibility with historical ledgers. Estimates are not provider invoices.
   * not_billed: the API rejected the request with an HTTP error before generating (no charge).
   */
  costSource?: "token_estimate" | "provider_charge" | "list_price" | "not_billed" | "unknown";
  thinkingTokens?: number;
  cachedTokens?: number;
  attempt?: number;
  latencyMs: number;
  firstTokenMs: number | null;
  finishReason: string;
  ok: boolean;
  error?: string;
  /** TTS only: characters billed. */
  characters?: number;
  /** STT only: words returned without usable timing (kept as blocked spans). */
  untimedWords?: number;
  /** STT only: audio seconds the provider billed (metadata.totalBilledDuration). */
  billedSeconds?: number;
}

export function summarizeCosts(calls: CallRecord[]) {
  return {
    costUsd: calls.reduce((s, c) => s + c.costUsd, 0),
    costStatus: calls.some((c) => c.costKnown === false)
      ? ("unresolved" as const)
      : ("known" as const),
  };
}

/** Open ledgers by file. Records are written in batches; readCallRecords writes the rest first. */
const ledgers = new Map<string, BufferedAppend>();

/** Queues one record; it is written within a second, or before the next read of this ledger. */
export async function appendCallRecord(file: string, record: CallRecord): Promise<void> {
  let ledger = ledgers.get(file);
  if (!ledger) ledgers.set(file, (ledger = new BufferedAppend(file)));
  ledger.add(`${JSON.stringify(record)}\n`);
}

/** Every record of a ledger, including those still queued in this process. */
export async function readCallRecords(file: string): Promise<CallRecord[]> {
  const ledger = ledgers.get(file);
  if (ledger) {
    await ledger.flush();
    if (ledger.idle && ledgers.get(file) === ledger) ledgers.delete(file);
  }
  const text = await readFile(file, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CallRecord);
}
