import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

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

export async function appendCallRecord(file: string, record: CallRecord): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  await appendFile(file, `${JSON.stringify(record)}\n`);
}

export async function readCallRecords(file: string): Promise<CallRecord[]> {
  const text = await readFile(file, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CallRecord);
}
