import { appendCallRecord } from "../llm/ledger";
import { runFfmpeg } from "../media/ffmpeg";
import { gcpProjectId, googleHeaders } from "../google/auth";
import type { SpeechSegment } from "./schemas";
import { reserveCall } from "../runs/budget";

/** Chirp 3 synchronous recognition accepts up to one minute per request. */
const CHUNK_SECONDS = 55;
const OVERLAP_SECONDS = 5;
/** A pause longer than this starts a new speech segment. */
const SEGMENT_PAUSE_SECONDS = 0.35;
const STT_LOCATION = "us";
const STT_MODEL = "chirp_3";
/** Speech-to-Text v2 list price, USD per minute of audio (checked 2026-09-21). */
export const STT_USD_PER_MINUTE = 0.016;

interface Word {
  start: number;
  end: number;
  word: string;
}

interface RecognizeResponse {
  results?: {
    alternatives?: { words?: { startOffset?: string; endOffset?: string; word: string }[] }[];
  }[];
  metadata?: { totalBilledDuration?: string };
}

function seconds(offset: string | undefined): number {
  return offset ? Number(offset.replace("s", "")) : 0;
}

async function recognizeChunk(
  clipFile: string,
  from: number,
  length: number,
  languageCode: string,
): Promise<{ words: Word[]; billedSeconds: number }> {
  const { stdout } = await runFfmpeg([
    "-ss",
    String(from),
    "-t",
    String(length),
    "-i",
    clipFile,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "flac",
    "-f",
    "flac",
    "pipe:1",
  ]);
  const url =
    `https://${STT_LOCATION}-speech.googleapis.com/v2/projects/${gcpProjectId()}` +
    `/locations/${STT_LOCATION}/recognizers/_:recognize`;
  const response = await fetch(url, {
    method: "POST",
    headers: await googleHeaders(),
    body: JSON.stringify({
      config: {
        autoDecodingConfig: {},
        model: STT_MODEL,
        languageCodes: [languageCode],
        features: { enableWordTimeOffsets: true },
      },
      content: stdout.toString("base64"),
    }),
  });
  if (!response.ok)
    throw new Error(`Speech-to-Text HTTP ${response.status}: ${await response.text()}`);
  const body = (await response.json()) as RecognizeResponse;
  const words = (body.results ?? []).flatMap((result) =>
    (result.alternatives?.[0]?.words ?? []).map((w) => ({
      start: from + seconds(w.startOffset),
      end: from + seconds(w.endOffset),
      word: w.word,
    })),
  );
  return { words, billedSeconds: seconds(body.metadata?.totalBilledDuration) };
}

/**
 * Word-timed speech from Google Speech-to-Text (Chirp 3), grouped into utterances.
 * Word offsets are provider measurements, not independent proof of dialogue boundaries.
 * Reject unusable offsets rather than inventing silence around untimed speech.
 */
export async function hearSpeech(input: {
  clipFile: string;
  clipSeconds: number;
  languageCode: string;
  ledgerFile: string;
}): Promise<SpeechSegment[]> {
  const started = Date.now();
  const starts: number[] = [];
  for (let t = 0; t < input.clipSeconds; t += CHUNK_SECONDS - OVERLAP_SECONDS) {
    starts.push(t);
    if (t + CHUNK_SECONDS >= input.clipSeconds) break;
  }
  const settleCall = reserveCall(
    ((input.clipSeconds + starts.length * OVERLAP_SECONDS) / 60) * STT_USD_PER_MINUTE,
  );
  const results = await Promise.allSettled(
    starts.map((from) =>
      recognizeChunk(
        input.clipFile,
        from,
        Math.min(CHUNK_SECONDS, input.clipSeconds - from),
        input.languageCode,
      ),
    ),
  );
  const failed = results.find((r) => r.status === "rejected");
  if (failed?.status === "rejected") {
    settleCall(null);
    await appendCallRecord(input.ledgerFile, {
      at: new Date(started).toISOString(),
      label: "hear",
      model: `speech-to-text:${STT_MODEL}`,
      provider: "Google Cloud",
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      costKnown: false,
      latencyMs: Date.now() - started,
      firstTokenMs: null,
      finishReason: "",
      ok: false,
      error: String(failed.reason),
    });
    throw failed.reason;
  }
  const chunks = results.map(
    (r) => (r as PromiseFulfilledResult<{ words: Word[]; billedSeconds: number }>).value,
  );
  // Each overlap belongs to the earlier chunk up to its midpoint, the later chunk after it.
  const words: Word[] = [];
  chunks.forEach((chunk, i) => {
    const lower = i === 0 ? -Infinity : starts[i] + OVERLAP_SECONDS / 2;
    const upper = i === chunks.length - 1 ? Infinity : starts[i + 1] + OVERLAP_SECONDS / 2;
    words.push(...chunk.words.filter((w) => w.start >= lower && w.start < upper));
  });
  words.sort((a, b) => a.start - b.start);

  const billedSeconds = chunks.reduce((sum, c) => sum + c.billedSeconds, 0);
  settleCall(billedSeconds > 0 ? (billedSeconds / 60) * STT_USD_PER_MINUTE : null);
  await appendCallRecord(input.ledgerFile, {
    at: new Date(started).toISOString(),
    label: "hear",
    model: `speech-to-text:${STT_MODEL}`,
    provider: "Google Cloud",
    promptTokens: 0,
    completionTokens: 0,
    costUsd: (billedSeconds / 60) * STT_USD_PER_MINUTE,
    costKnown: billedSeconds > 0,
    latencyMs: Date.now() - started,
    firstTokenMs: null,
    finishReason: "",
    ok: true,
  });

  const segments: SpeechSegment[] = [];
  for (const w of words) {
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < 0 || w.end <= w.start) {
      throw new Error(
        "Speech recognition returned words without usable timing. This result was rejected; try a clip beginning before the spoken sentence.",
      );
    }
    const last = segments.at(-1);
    if (last && w.start - last.end <= SEGMENT_PAUSE_SECONDS) {
      last.end = Math.max(last.end, w.end);
      last.text += ` ${w.word}`;
    } else {
      segments.push({ start: w.start, end: w.end, speaker: "", text: w.word });
    }
  }
  return segments;
}
