import { z } from "zod";
import { appendCallRecord, type CallRecord } from "./ledger";
import { setTimeout as delay } from "node:timers/promises";
import { reserveCall } from "../runs/budget";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
/** House default: never cap output below the model's own limit without a stated reason. */
export const MAX_OUTPUT_TOKENS = 64000;

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "video_url"; video_url: { url: string } }
  | { type: "input_audio"; input_audio: { data: string; format: "wav" | "mp3" | "m4a" } };

export interface StructuredCall<T> {
  /** Pipeline stage, recorded in the cost ledger (e.g. "listen", "write:round1"). */
  label: string;
  model: string;
  system: string;
  user: ContentPart[];
  schemaName: string;
  schema: z.ZodType<T>;
  temperature?: number;
  /** Gemini thinking level. Unset = the model default (high for Gemini 3.x). */
  reasoningEffort?: "low" | "medium" | "high";
  /** Where the call is recorded; one JSONL line per call. */
  ledgerFile: string;
  /** Receives streamed text so the UI can show the model writing. */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

function apiKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  return key;
}

interface StreamChunk {
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  provider?: string;
  model?: string;
  error?: { message?: string; code?: number };
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
    public retryAfterSeconds = 2,
  ) {
    super(message);
  }
}

export function retryAfterSeconds(value: string | null, now = Date.now()): number {
  if (!value) return 2;
  const numeric = Number(value);
  const seconds = Number.isFinite(numeric) ? numeric : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, seconds) : 2;
}

/**
 * Longest Retry-After waited out inside a request. A longer one ends the run with a retryable
 * error (provider_busy) instead of holding the viewer's request open.
 */
export const MAX_RETRY_WAIT_SECONDS = 30;

/**
 * One retry, with a separate ledger entry for every attempt, including streamed errors: after a
 * retryable provider error, or after output that is not valid JSON for the schema (a run should not
 * end on one malformed answer).
 */
export async function callStructured<T>(
  call: StructuredCall<T>,
): Promise<{ data: T; record: CallRecord }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await callOnce(call, attempt);
    } catch (error) {
      if ((error instanceof SyntaxError || error instanceof z.ZodError) && attempt === 1) {
        console.warn(`LLM output invalid, retrying once: label=${call.label} model=${call.model}`);
        continue;
      }
      if (
        !(error instanceof ProviderError) ||
        !error.retryable ||
        attempt === 2 ||
        error.retryAfterSeconds > MAX_RETRY_WAIT_SECONDS
      )
        throw error;
      await delay(error.retryAfterSeconds * 1000, undefined, { signal: call.signal });
    }
  }
}

/**
 * One Gemini call through OpenRouter with a JSON-schema response.
 * Streams (first byte early, UI can watch), reads the exact charge from the final usage chunk,
 * validates the parsed JSON with zod and records every call — failed ones included — in the ledger.
 */
async function callOnce<T>(
  call: StructuredCall<T>,
  attempt: number,
): Promise<{ data: T; record: CallRecord }> {
  const settleCall = reserveCall(1.1);
  const started = Date.now();
  let firstTokenAt: number | null = null;
  let text = "";
  let usage: StreamChunk["usage"] = undefined;
  let provider = "";
  let finishReason = "";
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  const record = (ok: boolean, error?: string): CallRecord => ({
    at: new Date(started).toISOString(),
    label: call.label,
    model: call.model,
    provider,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    costUsd: usage?.cost ?? 0,
    costKnown: typeof usage?.cost === "number",
    attempt,
    latencyMs: Date.now() - started,
    firstTokenMs: firstTokenAt === null ? null : firstTokenAt - started,
    finishReason,
    ok,
    error,
  });

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: call.signal ?? AbortSignal.timeout(240_000),
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/emforce77/scene-ad",
        "X-Title": "Gapline audio description",
      },
      body: JSON.stringify({
        model: call.model,
        provider: { max_price: { prompt: 0.75, completion: 3.75 } },
        stream: true,
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: call.temperature ?? 0.4,
        usage: { include: true },
        ...(call.reasoningEffort ? { reasoning: { effort: call.reasoningEffort } } : {}),
        messages: [
          { role: "system", content: call.system },
          { role: "user", content: call.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: call.schemaName, strict: true, schema: z.toJSONSchema(call.schema) },
        },
      }),
    });
    if (!response.ok || !response.body) {
      const body = await response.text();
      let message = body.slice(0, 600);
      try {
        message = JSON.parse(body).error?.message ?? message;
      } catch {}
      throw new ProviderError(
        `OpenRouter HTTP ${response.status}: ${message}`,
        response.status,
        response.status === 429 || response.status === 503,
        retryAfterSeconds(response.headers.get("retry-after")),
      );
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() + "\n" : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        // SSE framing: comments (": OPENROUTER PROCESSING") keep the socket alive; data lines carry JSON.
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        const chunk = JSON.parse(payload) as StreamChunk;
        if (chunk.provider) provider = chunk.provider;
        if (chunk.usage) usage = chunk.usage;
        if (chunk.error)
          throw new ProviderError(
            `OpenRouter stream error: ${chunk.error.message}`,
            chunk.error.code ?? 500,
            chunk.error.code === 429 || chunk.error.code === 503,
          );
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (finishReason === "error")
          throw new ProviderError("OpenRouter stream terminated with an error", 500, false);
        const delta = choice?.delta?.content;
        if (delta) {
          if (firstTokenAt === null) firstTokenAt = Date.now();
          text += delta;
          call.onDelta?.(delta);
        }
      }
      if (done) break;
    }

    const data = call.schema.parse(JSON.parse(text));
    const ok = record(true);
    await appendCallRecord(call.ledgerFile, ok);
    settleCall(ok.costKnown ? ok.costUsd : null);
    return { data, record: ok };
  } catch (error) {
    const failed = record(false, error instanceof Error ? error.message : String(error));
    await appendCallRecord(call.ledgerFile, failed);
    settleCall(failed.costKnown ? failed.costUsd : null);
    console.error(`LLM call failed: label=${call.label} model=${call.model} ${failed.error}`);
    throw error;
  } finally {
    await reader?.cancel().catch(() => {});
  }
}
