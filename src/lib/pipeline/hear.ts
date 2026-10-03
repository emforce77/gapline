import { appendCallRecord } from "../llm/ledger";
import { runFfmpeg } from "../media/ffmpeg";
import { gcpProjectId, googleFetch } from "../google/auth";
import { refusedUnbilled, retryableStatus, ServiceError } from "../errors";
import { clampToClip } from "../store/analysis";
import { mapLimit } from "./map-limit";
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
/** Audio kept on each side of a slice recognized on its own, so a word at its edge is heard whole. */
export const SLICE_PADDING_SECONDS = 0.5;
/** Slices sent to the recognizer at once. */
export const SLICES_IN_FLIGHT = 3;
/**
 * The most narration room one word the recognizer could not place may block. Words without usable
 * timing stand for the whole span to their timed neighbours or to the edge of the audio, and a
 * "word" can come back stretched over many seconds (Sintel trailer, 2026-10-03: "What" at
 * 12.1–36.9 s). A longer span is recognized again in halves, up to PLACE_MAX_LEVELS times, until
 * each piece is placed or this short (placeLongSpans), so one stray token cannot close a whole chunk.
 */
export const UNPLACED_MAX_SECONDS = 4;
/**
 * Times placeLongSpans halves a span before what is still unplaced stays blocked as it is. Four
 * levels take any span up to 4 × 2⁴ = 64 s, more than one request holds, down to the limit above.
 */
export const PLACE_MAX_LEVELS = 4;
/** The most tokens one bracketed annotation spans, "[" to "]" (Chirp 3 sends "[ BACKGROUND]" as two). */
const ANNOTATION_MAX_TOKENS = 4;

export interface Word {
  start: number;
  end: number;
  word: string;
  /** A span standing in for words without usable timing (timeChunkWords). */
  untimed?: true;
  /** BCP-47 tag of the language the recognizer heard in this word's result. */
  lang?: string;
}

export interface RecognizeResponse {
  results?: {
    alternatives?: { words?: { startOffset?: string; endOffset?: string; word: string }[] }[];
    /** The language detected in this result, e.g. "en" when the request asked for "auto". */
    languageCode?: string;
  }[];
  metadata?: { totalBilledDuration?: string };
}

/** Proto3 JSON omits zero durations, so a missing offset means 0 s. */
function seconds(offset: string | undefined): number {
  return offset ? Number(offset.replace("s", "")) : 0;
}

/** A spoken word has at least one letter or digit, in any script. */
const SPOKEN = /[\p{L}\p{N}]/u;

/**
 * The recognizer's annotations taken out of one result's words: a run of tokens from one opening
 * with "[" to one closing with "]" within ANNOTATION_MAX_TOKENS, and any token with no letter or
 * digit. Chirp 3 answers audio without clear speech with "[BACKGROUND]" and marks other sounds the
 * same way ("[ SCREAM]", "[ ]"), split into tokens that may or may not carry times; none of them is
 * speech. It also leaves a lone "[" that never closes ("prison. I'm [", "[ 1.7 x 6Y", measured
 * 2026-10-03): only that token goes, since the words after it may be real speech.
 */
function dropAnnotations<T extends { word: string }>(
  tokens: T[],
): { words: T[]; annotations: string[] } {
  const words: T[] = [];
  const annotations: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].word.startsWith("[")) {
      const close = tokens
        .slice(i, i + ANNOTATION_MAX_TOKENS)
        .findIndex((t) => t.word.endsWith("]"));
      if (close !== -1) {
        annotations.push(
          tokens
            .slice(i, i + close + 1)
            .map((t) => t.word)
            .join(" "),
        );
        i += close;
        continue;
      }
    }
    if (SPOKEN.test(tokens[i].word)) words.push(tokens[i]);
    else annotations.push(tokens[i].word);
  }
  return { words, annotations };
}

/**
 * Words of one recognized chunk, in the recognizer's order, with clip-relative times, and the
 * annotations taken out of each result's words (dropAnnotations).
 * Chirp 3 sometimes returns words without usable timing (start = end, often both 0 at a clip
 * boundary). Such words are never dropped and never given invented times: each run of them becomes
 * one span from the previous timed word's end (or the chunk start) to the next timed word's start
 * (or the chunk end). That only removes narration room; a span longer than UNPLACED_MAX_SECONDS is
 * recognized again in halves (placeLongSpans).
 */
export function timeChunkWords(
  body: RecognizeResponse,
  from: number,
  to: number,
): { words: Word[]; untimed: number; annotations: string[] } {
  const results = (body.results ?? []).map((result) =>
    dropAnnotations(
      (result.alternatives?.[0]?.words ?? []).map((w): Word => ({
        start: from + seconds(w.startOffset),
        end: from + seconds(w.endOffset),
        word: w.word,
        ...(result.languageCode ? { lang: result.languageCode } : {}),
      })),
    ),
  );
  const raw = results.flatMap((r) => r.words);
  const annotations = results.flatMap((r) => r.annotations);
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
    const lang = raw[i].lang ? { lang: raw[i].lang } : {};
    if (end > start) words.push({ start, end, word: text, untimed: true, ...lang });
    // Timed neighbours already touch: the words sit inside speech that is blocked anyway.
    else if (words.length > 0) words[words.length - 1].word += ` ${text}`;
    else if (raw[j]) raw[j] = { ...raw[j], word: `${text} ${raw[j].word}` };
    i = j - 1;
  }
  return { words, untimed, annotations };
}

/** One recognized span of the clip: its words in clip time, and what the provider billed. */
export interface RecognizedChunk {
  words: Word[];
  untimed: number;
  billedSeconds: number;
}

/** Recognizes `length` seconds of the clip from `from`; the same Chirp 3 request for every caller. */
export type SpanRecognizer = (from: number, length: number) => Promise<RecognizedChunk>;

/** How recognition requests ended, kept so a batch that failed is charged what it can have cost. */
export type SpeechOutcomes = PromiseSettledResult<RecognizedChunk>[];

/** `recognize`, adding how each request ends to `outcomes`. */
export function noteOutcomes(recognize: SpanRecognizer, outcomes: SpeechOutcomes): SpanRecognizer {
  return async (from, length) => {
    try {
      const value = await recognize(from, length);
      outcomes.push({ status: "fulfilled", value });
      return value;
    } catch (reason) {
      outcomes.push({ status: "rejected", reason });
      throw reason;
    }
  };
}

/**
 * What settled recognition requests cost, in USD: list price for the seconds billed to those that
 * answered, nothing for refusals that are not billed (refusedUnbilled). Null (unknown, so the
 * whole bound counts) when another failure may have been billed, or when answers came back without
 * billed seconds.
 */
export function settledSpeechCost(outcomes: SpeechOutcomes): number | null {
  let billedSeconds = 0;
  let answered = 0;
  for (const outcome of outcomes) {
    if (outcome.status === "rejected") {
      if (!refusedUnbilled(outcome.reason)) return null;
      continue;
    }
    answered += 1;
    billedSeconds += outcome.value.billedSeconds;
  }
  if (answered > 0 && billedSeconds === 0) return null;
  return speechCostUsd(billedSeconds);
}

/**
 * Consecutive words closer than the pause threshold form one utterance, in one language: a
 * change of the recognized language starts a new segment, so each caption can carry its own.
 */
export function groupSegments(words: Word[]): SpeechSegment[] {
  const segments: SpeechSegment[] = [];
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    const last = segments.at(-1);
    if (last && w.start - last.end <= SEGMENT_PAUSE_SECONDS && last.lang === w.lang) {
      last.end = Math.max(last.end, w.end);
      last.text += ` ${w.word}`;
    } else {
      segments.push({
        start: w.start,
        end: w.end,
        speaker: "",
        text: w.word,
        ...(w.lang ? { lang: w.lang } : {}),
      });
    }
  }
  return segments;
}

/** A part of the clip recognized on its own, and the audio sent for it. */
export interface Slice {
  start: number;
  end: number;
  /** Audio sent to the recognizer: the part plus padding on each side, inside the clip. */
  from: number;
  to: number;
  /**
   * The part goes on from the part just before it, recognized separately: a timed word that starts
   * before this part is that part's, so a word across the cut is kept once.
   */
  continues?: true;
}

export function padSlice(start: number, end: number, clipSeconds: number): Slice {
  return {
    start,
    end,
    from: Math.max(0, start - SLICE_PADDING_SECONDS),
    to: Math.min(clipSeconds, end + SLICE_PADDING_SECONDS),
  };
}

/** Words whose span says only that they are somewhere inside it. */
function unplaced(w: Word): boolean {
  return w.untimed === true || w.end - w.start > UNPLACED_MAX_SECONDS;
}

/**
 * Words a slice's recognition puts in its part, in clip time. A timed word counts when it overlaps
 * the part at all (when it starts in it, at a cut from the part before: Slice.continues) and keeps
 * its whole span, cut only at the edges of the audio sent; words in the padding that stay outside
 * the part belong to speech heard elsewhere. An unplaced span (words without timing, or one word
 * longer than UNPLACED_MAX_SECONDS) is cut to the part: the padding on either side is answered for
 * by a neighbouring slice or by speech already heard.
 */
export function wordsInSlice(slice: Slice, words: Word[]): Word[] {
  return words.flatMap((w) => {
    if (unplaced(w))
      return w.end > slice.start && w.start < slice.end
        ? [{ ...w, start: Math.max(w.start, slice.start), end: Math.min(w.end, slice.end) }]
        : [];
    const opens = slice.continues ? w.start >= slice.start : w.end > slice.start;
    return opens && w.start < slice.end
      ? [{ ...w, start: Math.max(w.start, slice.from), end: Math.min(w.end, slice.to) }]
      : [];
  });
}

/** Unplaced words that overlap or touch, joined into one span standing for all of them. */
function joinUnplaced(words: Word[]): Word[] {
  const joined: Word[] = [];
  for (const w of [...words].sort((a, b) => a.start - b.start)) {
    const last = joined.at(-1);
    if (last && w.start <= last.end)
      joined[joined.length - 1] = {
        ...last,
        end: Math.max(last.end, w.end),
        word: `${last.word} ${w.word}`,
        untimed: true,
      };
    else joined.push(w);
  }
  return joined;
}

/**
 * Words with every span longer than UNPLACED_MAX_SECONDS recognized again: overlapping such spans
 * are joined, each is cut into two padded halves, both heard on their own, and what they place
 * replaces it; a half that still returns an unplaced span longer than the limit is halved again. A
 * half that hears nothing frees its room. A word already placed inside a re-heard span gives way
 * where the halves place words over it, so the same speech is not kept twice; where they hear
 * nothing it stays.
 * Only the given spans and the leftovers of one half are joined, never two halves: halves touch at
 * their cut and the padding answers for both, so joining them would rebuild the span and ask the
 * same two questions forever. A leftover is cut to its half's part (wordsInSlice), so spans halve
 * every level and PLACE_MAX_LEVELS bounds the work: a 55 s span costs at most 2 + 4 + 8 + 16 = 30
 * requests and 4 × 55 s of audio plus 1 s of padding per request (about $0.07). What is still
 * unplaced after the last level (only a span joined across chunks of a clip over 64 s) stays
 * blocked as it is. Uploads are at most 90 s, so every half fits one request. Each level reserves
 * its own budget; the caller writes the billed seconds into its ledger row.
 */
export async function placeLongSpans(
  words: Word[],
  recognize: SpanRecognizer,
  clipSeconds: number,
): Promise<{ words: Word[]; billedSeconds: number; requests: number }> {
  const tooLong = (w: Word) => w.end - w.start > UNPLACED_MAX_SECONDS;
  let placed = words.filter((w) => !tooLong(w));
  let pending = joinUnplaced(words.filter(tooLong));
  let billedSeconds = 0;
  let requests = 0;
  for (let level = 0; level < PLACE_MAX_LEVELS && pending.length > 0; level++) {
    const halves = pending.flatMap((w): Slice[] => {
      const middle = (w.start + w.end) / 2;
      return [
        padSlice(w.start, middle, clipSeconds),
        { ...padSlice(middle, w.end, clipSeconds), continues: true },
      ];
    });
    const settleCall = reserveCall(speechCostUsd(halves.reduce((s, h) => s + h.to - h.from, 0)));
    const outcomes: SpeechOutcomes = [];
    const heardOnce = noteOutcomes(recognize, outcomes);
    let chunks: RecognizedChunk[];
    try {
      chunks = await mapLimit(halves, SLICES_IN_FLIGHT, (h) => heardOnce(h.from, h.to - h.from));
    } catch (error) {
      // mapLimit lets every started request finish first, so the outcomes are complete.
      settleCall(settledSpeechCost(outcomes));
      throw error;
    }
    const billed = chunks.reduce((s, c) => s + c.billedSeconds, 0);
    settleCall(billed > 0 ? speechCostUsd(billed) : null);
    billedSeconds += billed;
    requests += halves.length;
    const heard = halves.map((h, i) => wordsInSlice(h, chunks[i].words));
    const found = heard.flat().filter((w) => !tooLong(w));
    const heardAgain = (w: Word) =>
      pending.some((s) => s.start <= w.start && w.end <= s.end) &&
      found.some((f) => f.start < w.end && w.start < f.end);
    placed = [...placed.filter((w) => !heardAgain(w)), ...found];
    pending = heard.flatMap((inHalf) => joinUnplaced(inHalf.filter(tooLong)));
  }
  return {
    words: [...placed, ...pending].sort((a, b) => a.start - b.start),
    billedSeconds,
    requests,
  };
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
  const response = await googleFetch(
    url,
    {
      method: "POST",
      body: JSON.stringify({
        config: {
          autoDecodingConfig: {},
          model: STT_MODEL,
          languageCodes: [languageCode],
          features: { enableWordTimeOffsets: true },
        },
        content: stdout.toString("base64"),
      }),
    },
    (error) =>
      new ServiceError("speech_failed", `Speech-to-Text unreachable: ${String(error)}`, true),
  );
  if (!response.ok)
    throw new ServiceError(
      "speech_failed",
      `Speech-to-Text HTTP ${response.status}: ${await response.text()}`,
      retryableStatus(response.status),
      response.status,
    );
  const body = (await response.json()) as RecognizeResponse;
  const { words, untimed, annotations } = timeChunkWords(body, from, from + length);
  if (annotations.length > 0)
    console.info(
      `hear: ${from.toFixed(2)}+${length.toFixed(2)} s: dropped ${annotations.length} ` +
        `recognizer annotation(s): ${annotations.join(", ")}`,
    );
  return { words, untimed, billedSeconds: seconds(body.metadata?.totalBilledDuration) };
}

/** Chirp 3 over one clip in one language: the first pass and the re-listen share this request. */
export function chirpRecognizer(clipFile: string, languageCode: string): SpanRecognizer {
  return (from, length) => recognizeChunk(clipFile, from, length, languageCode);
}

export function speechCostUsd(billedSeconds: number): number {
  return (billedSeconds / 60) * STT_USD_PER_MINUTE;
}

/**
 * One ledger row per recognition pass. A failed pass is charged what its requests can have cost
 * (settledSpeechCost): nothing when the service refused them unbilled, else usually unknown.
 */
export async function recordSpeechCall(
  ledgerFile: string,
  call: { label: string; started: number } & (
    | { ok: true; billedSeconds: number; untimedWords: number }
    | { ok: false; error: unknown; outcomes: SpeechOutcomes }
  ),
): Promise<void> {
  const failedCost = call.ok ? null : settledSpeechCost(call.outcomes);
  await appendCallRecord(ledgerFile, {
    at: new Date(call.started).toISOString(),
    label: call.label,
    model: `speech-to-text:${STT_MODEL}`,
    provider: "Google Cloud",
    promptTokens: 0,
    completionTokens: 0,
    costUsd: call.ok ? speechCostUsd(call.billedSeconds) : (failedCost ?? 0),
    costKnown: call.ok ? call.billedSeconds > 0 : failedCost !== null,
    ...(failedCost === 0 ? { costSource: "not_billed" as const } : {}),
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
 * Untimed words block the span around them rather than inventing silence (timeChunkWords); a span
 * too long to block is recognized again in halves (placeLongSpans).
 */
export async function hearSpeech(input: {
  clipFile: string;
  clipSeconds: number;
  languageCode: string;
  ledgerFile: string;
}): Promise<SpeechSegment[]> {
  const started = Date.now();
  const outcomes: SpeechOutcomes = [];
  const recognize = noteOutcomes(chirpRecognizer(input.clipFile, input.languageCode), outcomes);
  const starts: number[] = [];
  for (let t = 0; t < input.clipSeconds; t += CHUNK_SECONDS - OVERLAP_SECONDS) {
    starts.push(t);
    if (t + CHUNK_SECONDS >= input.clipSeconds) break;
  }
  const settleCall = reserveCall(
    speechCostUsd(input.clipSeconds + starts.length * OVERLAP_SECONDS),
  );
  const results = await Promise.allSettled(
    starts.map((from) => recognize(from, Math.min(CHUNK_SECONDS, input.clipSeconds - from))),
  );
  const failed = results.find((r) => r.status === "rejected");
  if (failed?.status === "rejected") {
    settleCall(settledSpeechCost(results));
    await recordSpeechCall(input.ledgerFile, {
      label: "hear",
      started,
      ok: false,
      error: failed.reason,
      outcomes,
    });
    throw failed.reason;
  }
  const chunks = results.map((r) => (r as PromiseFulfilledResult<RecognizedChunk>).value);
  const chunkSeconds = chunks.reduce((sum, c) => sum + c.billedSeconds, 0);
  settleCall(chunkSeconds > 0 ? speechCostUsd(chunkSeconds) : null);
  // Each overlap belongs to the earlier chunk up to its midpoint, the later chunk after it.
  // A timed word goes by its start; an unplaced span keeps whatever part lies in the chunk's share.
  const words: Word[] = [];
  chunks.forEach((chunk, i) => {
    const lower = i === 0 ? -Infinity : starts[i] + OVERLAP_SECONDS / 2;
    const upper = i === chunks.length - 1 ? Infinity : starts[i + 1] + OVERLAP_SECONDS / 2;
    for (const w of chunk.words) {
      if (unplaced(w)) {
        if (w.end > lower && w.start < upper)
          words.push({ ...w, start: Math.max(w.start, lower), end: Math.min(w.end, upper) });
      } else if (w.start >= lower && w.start < upper) words.push(w);
    }
  });
  const untimed = chunks.reduce((sum, c) => sum + c.untimed, 0);

  let placed: Awaited<ReturnType<typeof placeLongSpans>>;
  try {
    placed = await placeLongSpans(words, recognize, input.clipSeconds);
  } catch (error) {
    await recordSpeechCall(input.ledgerFile, {
      label: "hear",
      started,
      ok: false,
      error,
      outcomes,
    });
    throw error;
  }
  if (untimed > 0 || placed.requests > 0)
    console.warn(
      `hear: ${untimed} words without usable timing; ${placed.requests} half-spans heard again ` +
        `to place long spans (${placed.billedSeconds} s billed); shorter spans stay blocked`,
    );
  await recordSpeechCall(input.ledgerFile, {
    label: "hear",
    started,
    ok: true,
    billedSeconds: chunkSeconds + placed.billedSeconds,
    untimedWords: untimed,
  });
  return groupSegments(clampToClip(placed.words, input.clipSeconds));
}
