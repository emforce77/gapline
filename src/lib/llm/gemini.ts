import { z } from "zod";
import { appendCallRecord, type CallRecord } from "./ledger";
import { setTimeout as delay } from "node:timers/promises";
import { reserveCall } from "../runs/budget";
import { MODELS } from "../models";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models";
/** House default: never cap output below the model's own limit without a stated reason. */
export const MAX_OUTPUT_TOKENS = 65536;

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
  /** Gemini thinking level. Unset = the model default. */
  reasoningEffort?: "low" | "medium" | "high";
  /** Where the call is recorded; one JSONL line per call. */
  ledgerFile: string;
  /** Receives streamed text so the UI can show the model writing. */
  onDelta?: (text: string) => void;
  signal?: AbortSignal;
}

function apiKey(): string {
  const key = process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GOOGLE_API_KEY or GEMINI_API_KEY is not set");
  return key;
}

export interface GeminiUsage {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  totalTokenCount?: number;
}

interface StreamChunk {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  usageMetadata?: GeminiUsage;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; code?: number };
}

/** Standard paid-tier list prices, checked 2026-09-29: https://ai.google.dev/gemini-api/docs/pricing. */
function priceMultiplier(started: number): number {
  return started >= Date.UTC(2027, 0, 1) ? 2 : 1;
}

/** Reported token usage times list price is an estimate, never a provider invoice. */
export function estimateGeminiCost(
  usage: GeminiUsage | undefined,
  model: string,
  started: number,
): number | null {
  if (!usage || model !== MODELS.flash) return null;
  const prompt = usage.promptTokenCount;
  const output = usage.candidatesTokenCount;
  const thoughts = usage.thoughtsTokenCount ?? 0;
  const cached = usage.cachedContentTokenCount ?? 0;
  const total = usage.totalTokenCount;
  const valid = (n: unknown): n is number =>
    typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
  if (!valid(prompt) || !valid(output) || !valid(thoughts) || !valid(cached) || !valid(total))
    return null;
  // Do not settle from partial usage or accidentally omit unreported thinking tokens.
  if (cached > prompt || total !== prompt + output + thoughts) return null;
  return (
    (((prompt - cached) * 0.75 + cached * 0.075 + (output + thoughts) * 3.75) *
      priceMultiplier(started)) /
    1_000_000
  );
}

function nativePart(part: ContentPart) {
  if (part.type === "text") return { text: part.text };
  if (part.type === "input_audio") {
    const mime = { wav: "audio/wav", mp3: "audio/mp3", m4a: "audio/mp4" } as const;
    return { inlineData: { mimeType: mime[part.input_audio.format], data: part.input_audio.data } };
  }
  const match = /^data:(video\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]*)$/i.exec(part.video_url.url);
  if (!match) throw new Error("Gemini video input must be an inline base64 video data URL");
  return { inlineData: { mimeType: match[1], data: match[2] } };
}

export class ProviderError extends Error {
  constructor(
    message: string,
    public status: number,
    public retryable: boolean,
    public retryAfterSeconds = 2,
    /** The API answered with an HTTP error before generating anything; Gemini bills none of these. */
    public rejected = false,
    /** The API named the wait (Retry-After or RetryInfo); otherwise the backoff sets it. */
    public waitGiven = false,
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

/** The wait a Gemini error body asks for (google.rpc.RetryInfo, e.g. "10.4s"), if any. */
export function retryInfoSeconds(body: unknown): number | null {
  const details = (body as { error?: { details?: { "@type"?: string; retryDelay?: string }[] } })
    ?.error?.details;
  const delay = details?.find((d) => d["@type"]?.endsWith("google.rpc.RetryInfo"))?.retryDelay;
  if (typeof delay !== "string" || !delay.endsWith("s")) return null;
  const seconds = Number(delay.slice(0, -1));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/**
 * Longest wait sat out inside a request. A longer one ends the run with a retryable error
 * (provider_busy) instead of holding the viewer's request open.
 */
export const MAX_RETRY_WAIT_SECONDS = 30;
/**
 * Attempts for a request the API rejected with 429 or 503 before generating. Those are not billed
 * ("If your request fails with a 400 or 500 error, you won't be charged", ai.google.dev billing,
 * read 2026-09-29), so they can be retried with exponential backoff as the troubleshooting guide
 * recommends. An error after the stream started may have been billed and is retried once.
 */
export const MAX_REJECTED_ATTEMPTS = 4;

/** Exponential backoff with jitter: about 2, 4 and 8 s after the first, second and third try. */
export function backoffSeconds(attempt: number, random = Math.random): number {
  return 2 ** attempt * (0.75 + random() * 0.5);
}

/**
 * Retries with a separate ledger entry for every attempt, including streamed errors: a rejected
 * request (HTTP 429 or 503) up to MAX_REJECTED_ATTEMPTS, any other retryable provider error once,
 * and output that is not valid JSON for the schema once (a run should not end on one malformed
 * answer).
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
      if (!(error instanceof ProviderError) || !error.retryable) throw error;
      const attempts = error.rejected ? MAX_REJECTED_ATTEMPTS : 2;
      const wait = error.waitGiven ? error.retryAfterSeconds : backoffSeconds(attempt);
      if (attempt >= attempts || wait > MAX_RETRY_WAIT_SECONDS) throw error;
      console.warn(
        `LLM provider busy, retrying in ${wait.toFixed(1)} s: label=${call.label} ` +
          `model=${call.model} attempt=${attempt} status=${error.status}`,
      );
      await delay(wait * 1000, undefined, { signal: call.signal });
    }
  }
}

/**
 * One direct Gemini API call with a JSON-schema response. Streamed text reaches the UI, final
 * usage yields a list-price estimate, and zod validates the JSON. Failed calls are recorded too.
 */
async function callOnce<T>(
  call: StructuredCall<T>,
  attempt: number,
): Promise<{ data: T; record: CallRecord }> {
  const started = Date.now();
  const settleCall = reserveCall(1.1 * priceMultiplier(started));
  let firstTokenAt: number | null = null;
  let text = "";
  let usage: GeminiUsage | undefined;
  let finishReason = "";
  let streamComplete = false;
  let rejected = false;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  const record = (ok: boolean, error?: string): CallRecord => {
    const cost = rejected
      ? 0
      : streamComplete && finishReason
        ? estimateGeminiCost(usage, call.model, started)
        : null;
    return {
      at: new Date(started).toISOString(),
      label: call.label,
      model: call.model,
      provider: "Google Gemini API",
      promptTokens: usage?.promptTokenCount ?? 0,
      completionTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      thinkingTokens: usage?.thoughtsTokenCount ?? 0,
      cachedTokens: usage?.cachedContentTokenCount ?? 0,
      costUsd: cost ?? 0,
      costKnown: cost !== null,
      costSource: rejected ? "not_billed" : cost === null ? "unknown" : "token_estimate",
      attempt,
      latencyMs: Date.now() - started,
      firstTokenMs: firstTokenAt === null ? null : firstTokenAt - started,
      finishReason,
      ok,
      error,
    };
  };

  try {
    const schema = z.toJSONSchema(call.schema);
    delete schema.$schema;
    const response = await fetch(
      `${GEMINI_URL}/${encodeURIComponent(call.model)}:streamGenerateContent?alt=sse`,
      {
        method: "POST",
        signal: call.signal ?? AbortSignal.timeout(240_000),
        headers: {
          "x-goog-api-key": apiKey(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: call.system }] },
          contents: [{ role: "user", parts: call.user.map(nativePart) }],
          generationConfig: {
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            temperature: call.temperature ?? 0.4,
            responseFormat: { text: { mimeType: "APPLICATION_JSON", schema } },
            ...(call.reasoningEffort
              ? { thinkingConfig: { thinkingLevel: call.reasoningEffort } }
              : {}),
          },
        }),
      },
    );
    if (!response.ok || !response.body) {
      rejected = !response.ok;
      const body = await response.text();
      let message = body.slice(0, 600);
      let hint: number | null = null;
      try {
        const parsed = JSON.parse(body);
        message = parsed.error?.message ?? message;
        hint = retryInfoSeconds(parsed);
      } catch {}
      const header = response.headers.get("retry-after");
      throw new ProviderError(
        `Gemini API HTTP ${response.status}: ${message}`,
        response.status,
        response.status === 429 || response.status === 503,
        header ? retryAfterSeconds(header) : (hint ?? 2),
        rejected,
        header !== null || hint !== null,
      );
    }

    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let eventLines: string[] = [];
    const consumeEvent = () => {
      if (eventLines.length === 0) return;
      const chunk = JSON.parse(eventLines.join("\n")) as StreamChunk;
      eventLines = [];
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
      if (chunk.error)
        throw new ProviderError(
          `Gemini API stream error: ${chunk.error.message ?? "unknown error"}`,
          chunk.error.code ?? 500,
          chunk.error.code === 429 || chunk.error.code === 503,
        );
      if (chunk.promptFeedback?.blockReason)
        throw new ProviderError(
          `Gemini API blocked the prompt: ${chunk.promptFeedback.blockReason}`,
          400,
          false,
        );
      const candidate = chunk.candidates?.[0];
      if (candidate?.finishReason) finishReason = candidate.finishReason;
      for (const part of candidate?.content?.parts ?? []) {
        if (!part.text || part.thought) continue;
        if (firstTokenAt === null) firstTokenAt = Date.now();
        text += part.text;
        call.onDelta?.(part.text);
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() + "\n\n" : decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line === "") consumeEvent();
        else if (line.startsWith("data:")) eventLines.push(line.slice(5).trimStart());
      }
      if (done) break;
    }
    streamComplete = true;
    if (!finishReason)
      throw new ProviderError(
        "Gemini API stream ended without a finish reason",
        502,
        true,
        0,
        false,
        true,
      );
    if (finishReason !== "STOP")
      throw new ProviderError(`Gemini API generation ended with ${finishReason}`, 502, false);

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
