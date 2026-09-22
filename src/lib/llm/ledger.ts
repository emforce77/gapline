import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

/** One paid call. costUsd is OpenRouter's own charge (usage.cost) or the TTS list price. */
export interface CallRecord {
  at: string;
  label: string;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  /** False when the provider did not return a charge; costUsd is only a known subtotal. */
  costKnown?: boolean;
  attempt?: number;
  latencyMs: number;
  firstTokenMs: number | null;
  finishReason: string;
  ok: boolean;
  error?: string;
  /** TTS only: characters billed. */
  characters?: number;
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
