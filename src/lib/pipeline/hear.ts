import { appendCallRecord } from "../llm/ledger";
import { runFfmpeg } from "../media/ffmpeg";
import { gcpProjectId, googleHeaders } from "../google/auth";
import type { SpeechSegment } from "./schemas";

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
 * Gemini's own timestamps drifted by up to 2.5 s on the sample clip, which is enough to make
 * narration talk over an actor; recognizer word offsets matched subtitle timing within 0.2 s.
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
  const chunks = await Promise.all(
    starts.map((from) =>
      recognizeChunk(
        input.clipFile,
        from,
        Math.min(CHUNK_SECONDS, input.clipSeconds - from),
        input.languageCode,
      ),
    ),
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
  await appendCallRecord(input.ledgerFile, {
    at: new Date(started).toISOString(),
    label: "hear",
    model: `speech-to-text:${STT_MODEL}`,
    provider: "Google Cloud",
    promptTokens: 0,
    completionTokens: 0,
    costUsd: (billedSeconds / 60) * STT_USD_PER_MINUTE,
    latencyMs: Date.now() - started,
    firstTokenMs: null,
    finishReason: "",
    ok: true,
  });

  const segments: SpeechSegment[] = [];
  for (const w of words) {
    const last = segments.at(-1);
    if (last && w.start - last.end <= SEGMENT_PAUSE_SECONDS) {
      last.end = w.end;
      last.text += ` ${w.word}`;
    } else {
      segments.push({ start: w.start, end: w.end, speaker: "", text: w.word });
    }
  }
  return segments;
}
