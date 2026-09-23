import { appendCallRecord } from "../llm/ledger";
import { runFfmpeg } from "../media/ffmpeg";
import { gcpProjectId, googleHeaders } from "../google/auth";
import { retryableStatus, ServiceError } from "../errors";
import { clampToClip } from "../store/analysis";
import type { SpeechSegment } from "./schemas";
import { reserveCall } from "../runs/budget";

/** Chirp 3 synchronous recognition accepts up to one minute per request. */
export const CHUNK_SECONDS = 55;
const OVERLAP_SECONDS = 5;
/** A pause longer than this starts a new speech segment. */
const SEGMENT_PAUSE_SECONDS = 0.35;
const STT_LOCATION = "us";
const STT_MODEL = "chirp_3";
/** Speech-to-Text v2 list price, USD per minute of audio (checked 2026-09-21). */
export const STT_USD_PER_MINUTE = 0.016;

export interface Word {
  start: number;
  end: number;
  word: string;
  /** A span standing in for words without usable timing (timeChunkWords). */
  untimed?: true;
}

export interface RecognizeResponse {
  results?: {
    alternatives?: { words?: { startOffset?: string; endOffset?: string; word: string }[] }[];
  }[];
  metadata?: { totalBilledDuration?: string };
}

/** Proto3 JSON omits zero durations, so a missing offset means 0 s. */
function seconds(offset: string | undefined): number {
  return offset ? Number(offset.replace("s", "")) : 0;
}

/**
 * Words of one recognized chunk, in the recognizer's order, with clip-relative times.
 * Chirp 3 sometimes returns words without usable timing (start = end, often both 0 at a clip
 * boundary). Such words are never dropped and never given invented times: each run of them becomes
 * one span from the previous timed word's end (or the chunk start) to the next timed word's start
 * (or the chunk end). That only removes narration room.
 */
export function timeChunkWords(
  body: RecognizeResponse,
  from: number,
  to: number,
): { words: Word[]; untimed: number } {
  const raw = (body.results ?? []).flatMap((result) =>
    (result.alternatives?.[0]?.words ?? []).map((w) => ({
      start: from + seconds(w.startOffset),
      end: from + seconds(w.endOffset),
      word: w.word,
    })),
  );
  const timed = (w: Word) =>
    Number.isFinite(w.start) && Number.isFinite(w.end) && w.start >= 0 && w.end > w.start;
  const words: Word[] = [];
  let untimed = 0;
  for (let i = 0; i < raw.length; i++) {
    if (timed(raw[i])) {
      words.push(raw[i]);
      continue;
    }
    let j = i;
    while (j < raw.length && !timed(raw[j])) j++;
    untimed += j - i;
    const text = raw
      .slice(i, j)
      .map((w) => w.word)
      .join(" ");
    const start = words.at(-1)?.end ?? from;
    const end = raw[j]?.start ?? to;
    if (end > start) words.push({ start, end, word: text, untimed: true });
    // Timed neighbours already touch: the words sit inside speech that is blocked anyway.
    else if (words.length > 0) words[words.length - 1].word += ` ${text}`;
    else if (raw[j]) raw[j] = { ...raw[j], word: `${text} ${raw[j].word}` };
    i = j - 1;
  }
  return { words, untimed };
}

/** One recognized span of the clip: its words in clip time, and what the provider billed. */
export interface RecognizedChunk {
  words: Word[];
  untimed: number;
  billedSeconds: number;
}

/** Recognizes `length` seconds of the clip from `from`; the same Chirp 3 request for every caller. */
export type SpanRecognizer = (from: number, length: number) => Promise<RecognizedChunk>;

/** Consecutive words closer than the pause threshold form one utterance. */
export function groupSegments(words: Word[]): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
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

async function recognizeChunk(
  clipFile: string,
  from: number,
  length: number,
  languageCode: string,
): Promise<RecognizedChunk> {
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
  }).catch((error: unknown) => {
    throw new ServiceError("speech_failed", `Speech-to-Text unreachable: ${String(error)}`, true);
  });
  if (!response.ok)
    throw new ServiceError(
      "speech_failed",
      `Speech-to-Text HTTP ${response.status}: ${await response.text()}`,
      retryableStatus(response.status),
    );
  const body = (await response.json()) as RecognizeResponse;
  return {
    ...timeChunkWords(body, from, from + length),
    billedSeconds: seconds(body.metadata?.totalBilledDuration),
  };
}

/** Chirp 3 over one clip in one language: the first pass and the re-listen share this request. */
export function chirpRecognizer(clipFile: string, languageCode: string): SpanRecognizer {
  return (from, length) => recognizeChunk(clipFile, from, length, languageCode);
}

export function speechCostUsd(billedSeconds: number): number {
  return (billedSeconds / 60) * STT_USD_PER_MINUTE;
}

/** One ledger row per recognition pass; a failed pass has an unknown charge. */
export async function recordSpeechCall(
  ledgerFile: string,
  call: { label: string; started: number } & (
    { ok: true; billedSeconds: number; untimedWords: number } | { ok: false; error: unknown }
  ),
): Promise<void> {
  await appendCallRecord(ledgerFile, {
    at: new Date(call.started).toISOString(),
    label: call.label,
    model: `speech-to-text:${STT_MODEL}`,
    provider: "Google Cloud",
    promptTokens: 0,
    completionTokens: 0,
    costUsd: call.ok ? speechCostUsd(call.billedSeconds) : 0,
    costKnown: call.ok && call.billedSeconds > 0,
    latencyMs: Date.now() - call.started,
    firstTokenMs: null,
    finishReason: "",
    ok: call.ok,
    ...(call.ok
      ? { untimedWords: call.untimedWords, billedSeconds: call.billedSeconds }
      : { error: String(call.error) }),
  });
}

/**
 * Word-timed speech from Google Speech-to-Text (Chirp 3), grouped into utterances.
 * Word offsets are provider measurements, not independent proof of dialogue boundaries.
 * Untimed words block the span around them rather than inventing silence (timeChunkWords).
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
    speechCostUsd(input.clipSeconds + starts.length * OVERLAP_SECONDS),
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
    await recordSpeechCall(input.ledgerFile, {
      label: "hear",
      started,
      ok: false,
      error: failed.reason,
    });
    throw failed.reason;
  }
  const chunks = results.map((r) => (r as PromiseFulfilledResult<RecognizedChunk>).value);
  // Each overlap belongs to the earlier chunk up to its midpoint, the later chunk after it.
  // A timed word goes by its start; an untimed span keeps whatever part lies in the chunk's share.
  const words: Word[] = [];
  chunks.forEach((chunk, i) => {
    const lower = i === 0 ? -Infinity : starts[i] + OVERLAP_SECONDS / 2;
    const upper = i === chunks.length - 1 ? Infinity : starts[i + 1] + OVERLAP_SECONDS / 2;
    for (const w of chunk.words) {
      if (w.start >= lower && w.start < upper) words.push(w);
      else if (w.untimed && w.end > lower && w.start < upper)
        words.push({ ...w, start: Math.max(w.start, lower), end: Math.min(w.end, upper) });
    }
  });
  const untimed = chunks.reduce((sum, c) => sum + c.untimed, 0);
  if (untimed > 0)
    console.warn(`hear: ${untimed} words without usable timing; their spans stay blocked`);

  const billedSeconds = chunks.reduce((sum, c) => sum + c.billedSeconds, 0);
  settleCall(billedSeconds > 0 ? speechCostUsd(billedSeconds) : null);
  await recordSpeechCall(input.ledgerFile, {
    label: "hear",
    started,
    ok: true,
    billedSeconds,
    untimedWords: untimed,
  });
  return groupSegments(clampToClip(words, input.clipSeconds));
}
