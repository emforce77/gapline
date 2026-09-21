import { z } from "zod";
import { appendCallRecord, type CallRecord } from "./ledger";

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

/**
 * One Gemini/Gemma call through OpenRouter with a JSON-schema response.
 * Streams (first byte early, UI can watch), reads the exact charge from the final usage chunk,
 * validates the parsed JSON with zod and records every call — failed ones included — in the ledger.
 */
export async function callStructured<T>(
  call: StructuredCall<T>,
): Promise<{ data: T; record: CallRecord }> {
  const started = Date.now();
  let firstTokenAt: number | null = null;
  let text = "";
  let usage: StreamChunk["usage"] = undefined;
  let provider = "";
  let finishReason = "";

  const record = (ok: boolean, error?: string): CallRecord => ({
    at: new Date(started).toISOString(),
    label: call.label,
    model: call.model,
    provider,
    promptTokens: usage?.prompt_tokens ?? 0,
    completionTokens: usage?.completion_tokens ?? 0,
    costUsd: usage?.cost ?? 0,
    latencyMs: Date.now() - started,
    firstTokenMs: firstTokenAt === null ? null : firstTokenAt - started,
    finishReason,
    ok,
    error,
  });

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: call.signal,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://github.com/emforce77/scene-ad",
        "X-Title": "Scene audio description",
      },
      body: JSON.stringify({
        model: call.model,
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
      throw new Error(
        `OpenRouter HTTP ${response.status}: ${(await response.text()).slice(0, 600)}`,
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        // SSE framing: comments (": OPENROUTER PROCESSING") keep the socket alive; data lines carry JSON.
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (payload === "[DONE]") continue;
        const chunk = JSON.parse(payload) as StreamChunk;
        if (chunk.error) throw new Error(`OpenRouter stream error: ${chunk.error.message}`);
        if (chunk.provider) provider = chunk.provider;
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta?.content;
        if (delta) {
          if (firstTokenAt === null) firstTokenAt = Date.now();
          text += delta;
          call.onDelta?.(delta);
        }
      }
    }

    const data = call.schema.parse(JSON.parse(text));
    const ok = record(true);
    await appendCallRecord(call.ledgerFile, ok);
    return { data, record: ok };
  } catch (error) {
    const failed = record(false, error instanceof Error ? error.message : String(error));
    await appendCallRecord(call.ledgerFile, failed);
    console.error(`LLM call failed: label=${call.label} model=${call.model} ${failed.error}`);
    throw error;
  }
}
