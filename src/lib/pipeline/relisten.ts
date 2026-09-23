import { reserveCall } from "../runs/budget";
import type { RelistenReport } from "./events";
import { assessRoom, findGaps, MIN_GAP_SECONDS } from "./gaps";
import {
  CHUNK_SECONDS,
  groupSegments,
  recordSpeechCall,
  speechCostUsd,
  type RecognizedChunk,
  type SpanRecognizer,
} from "./hear";
import { mapLimit } from "./map-limit";
import type { Gap, SpeechSegment } from "./schemas";

/** Audio kept on each side of a silence, so a word at its edge is heard whole. */
export const RELISTEN_PADDING_SECONDS = 0.5;
/** Slices sent to the recognizer at once. */
export const RELISTEN_CONCURRENCY = 3;
/** A longer silence is split so each padded slice fits one synchronous request. */
export const RELISTEN_MAX_PART_SECONDS = CHUNK_SECONDS - 2 * RELISTEN_PADDING_SECONDS;
/** Ledger label: the cost is counted under "hear", like the first pass. */
export const RELISTEN_LEDGER_LABEL = "hear:relisten";

/** One short piece of audio recognized on its own, and the part of a silence it answers for. */
export interface RelistenSlice {
  gapId: string;
  start: number;
  end: number;
  /** Audio sent to the recognizer: the part plus padding on each side, inside the clip. */
  from: number;
  to: number;
}

/** Every silence long enough to hold a line, cut into parts that fit one request, then padded. */
export function planRelisten(gaps: Gap[], clipSeconds: number): RelistenSlice[] {
  const slices: RelistenSlice[] = [];
  for (const gap of gaps) {
    const length = gap.end - gap.start;
    if (length < MIN_GAP_SECONDS) continue;
    const parts = Math.ceil(length / RELISTEN_MAX_PART_SECONDS);
    for (let i = 0; i < parts; i++) {
      const start = gap.start + (length * i) / parts;
      const end = i === parts - 1 ? gap.end : gap.start + (length * (i + 1)) / parts;
      slices.push({
        gapId: gap.id,
        start,
        end,
        from: Math.max(0, start - RELISTEN_PADDING_SECONDS),
        to: Math.min(clipSeconds, end + RELISTEN_PADDING_SECONDS),
      });
    }
  }
  return slices;
}

/**
 * Speech a slice's recognition puts inside its part of the silence, tagged as found on re-listen.
 * A timed word counts when it overlaps the part at all, and keeps its whole span, cut only at the
 * slice edges. Words in the padding that stay outside the part belong to speech already heard.
 * Words without usable timing could sit anywhere in the slice, so the whole part is blocked.
 */
export function speechInSlice(
  slice: RelistenSlice,
  chunk: RecognizedChunk,
): { segments: SpeechSegment[]; words: number } {
  if (chunk.untimed > 0) {
    const text = chunk.words.map((w) => w.word).join(" ");
    return {
      segments: [{ start: slice.start, end: slice.end, speaker: "", text, heard: "relisten" }],
      words: chunk.words.filter((w) => !w.untimed).length + chunk.untimed,
    };
  }
  const inside = chunk.words
    .filter((w) => w.end > slice.start && w.start < slice.end)
    .map((w) => ({ ...w, start: Math.max(w.start, slice.from), end: Math.min(w.end, slice.to) }));
  return {
    segments: groupSegments(inside).map((s) => ({ ...s, heard: "relisten" as const })),
    words: inside.length,
  };
}

/**
 * Recognizes each usable silence again as its own short slice and blocks whatever is heard there.
 * Over a long chunk a recognizer can attach an utterance to the wrong time (measured 2026-09-23 on
 * the Tears of Steel opening: Chirp 3 put "We have main engine start." about 2 s early, leaving a
 * talked-over "silence"); a short isolated slice places it where it is spoken. Gaps are computed
 * from speech alone, so hearing stays independent of watching; protected sounds only shrink them.
 */
export async function relistenGaps(input: {
  speech: SpeechSegment[];
  clipSeconds: number;
  ledgerFile: string;
  recognize: SpanRecognizer;
}): Promise<{ speech: SpeechSegment[]; report: RelistenReport }> {
  const before = findGaps({ speech: input.speech, sounds: [] }, input.clipSeconds);
  const slices = planRelisten(before, input.clipSeconds);
  if (slices.length === 0)
    return { speech: input.speech, report: { gapsChecked: 0, wordsFound: 0, blockedSeconds: 0 } };

  const started = Date.now();
  const settleCall = reserveCall(speechCostUsd(slices.reduce((s, x) => s + x.to - x.from, 0)));
  let chunks: RecognizedChunk[];
  try {
    chunks = await mapLimit(slices, RELISTEN_CONCURRENCY, (slice) =>
      input.recognize(slice.from, slice.to - slice.from),
    );
  } catch (error) {
    settleCall(null);
    await recordSpeechCall(input.ledgerFile, {
      label: RELISTEN_LEDGER_LABEL,
      started,
      ok: false,
      error,
    });
    throw error;
  }
  const billedSeconds = chunks.reduce((s, c) => s + c.billedSeconds, 0);
  settleCall(billedSeconds > 0 ? speechCostUsd(billedSeconds) : null);
  await recordSpeechCall(input.ledgerFile, {
    label: RELISTEN_LEDGER_LABEL,
    started,
    ok: true,
    billedSeconds,
    untimedWords: chunks.reduce((s, c) => s + c.untimed, 0),
  });

  const heard = slices.map((slice, i) => speechInSlice(slice, chunks[i]));
  const speech = [...input.speech, ...heard.flatMap((h) => h.segments)].sort(
    (a, b) => a.start - b.start,
  );
  const after = findGaps({ speech, sounds: [] }, input.clipSeconds);
  const report: RelistenReport = {
    gapsChecked: new Set(slices.map((s) => s.gapId)).size,
    wordsFound: heard.reduce((s, h) => s + h.words, 0),
    blockedSeconds: round(
      assessRoom(before, input.clipSeconds).gapSeconds -
        assessRoom(after, input.clipSeconds).gapSeconds,
    ),
  };
  if (report.wordsFound > 0)
    console.info(
      `relisten: ${report.wordsFound} words in ${report.gapsChecked} silences; ` +
        `${report.blockedSeconds} s of room closed`,
    );
  return { speech, report };
}

function round(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}
