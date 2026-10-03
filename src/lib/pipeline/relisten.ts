import { reserveCall } from "../runs/budget";
import type { RelistenReport } from "./events";
import { assessRoom, findGaps, MIN_GAP_SECONDS } from "./gaps";
import {
  CHUNK_SECONDS,
  groupSegments,
  noteOutcomes,
  padSlice,
  placeLongSpans,
  recordSpeechCall,
  settledSpeechCost,
  SLICE_PADDING_SECONDS,
  SLICES_IN_FLIGHT,
  speechCostUsd,
  wordsInSlice,
  type RecognizedChunk,
  type Slice,
  type SpanRecognizer,
  type SpeechOutcomes,
  type Word,
} from "./hear";
import { mapLimit } from "./map-limit";
import type { Gap, SpeechSegment } from "./schemas";

/** A longer silence is split so each padded slice fits one synchronous request. */
export const RELISTEN_MAX_PART_SECONDS = CHUNK_SECONDS - 2 * SLICE_PADDING_SECONDS;
/** Ledger label: the cost is counted under "hear", like the first pass. */
export const RELISTEN_LEDGER_LABEL = "hear:relisten";

/** One short piece of audio recognized on its own, and the part of a silence it answers for. */
export interface RelistenSlice extends Slice {
  gapId: string;
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
        ...padSlice(start, end, clipSeconds),
        ...(i > 0 ? { continues: true as const } : {}),
      });
    }
  }
  return slices;
}

/** Recognized words in a list of word spans; an untimed span stands for several. */
function countWords(words: Word[]): number {
  return words.reduce((n, w) => n + w.word.split(" ").length, 0);
}

/**
 * Recognizes each usable silence again as its own short slice and blocks whatever is heard there.
 * Over a long chunk a recognizer can attach an utterance to the wrong time (measured 2026-09-23 on
 * the Tears of Steel opening: Chirp 3 put "We have main engine start." about 2 s early, leaving a
 * talked-over "silence"); a short isolated slice places it where it is spoken. Words a slice cannot
 * place within UNPLACED_MAX_SECONDS are heard again in halves (placeLongSpans), so a stray untimed
 * token blocks a few seconds, not a whole part. Gaps are computed from speech alone, so hearing stays
 * independent of watching; protected sounds only shrink them.
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
  // A clip that fits one request and holds no speech: its one silence is the very audio the first
  // pass has just recognized on its own, so the same request would be sent again (it took up to
  // 15 s for 40–55 s of audio, measured 2026-10-03).
  const heardWhole =
    input.clipSeconds <= CHUNK_SECONDS &&
    slices.length === 1 &&
    slices[0].from === 0 &&
    slices[0].to === input.clipSeconds;
  if (heardWhole)
    return { speech: input.speech, report: { gapsChecked: 1, wordsFound: 0, blockedSeconds: 0 } };

  const started = Date.now();
  const outcomes: SpeechOutcomes = [];
  const recognize = noteOutcomes(input.recognize, outcomes);
  const failed = (error: unknown) =>
    recordSpeechCall(input.ledgerFile, {
      label: RELISTEN_LEDGER_LABEL,
      started,
      ok: false,
      error,
      outcomes,
    });
  const settleCall = reserveCall(speechCostUsd(slices.reduce((s, x) => s + x.to - x.from, 0)));
  let chunks: RecognizedChunk[];
  try {
    chunks = await mapLimit(slices, SLICES_IN_FLIGHT, (slice) =>
      recognize(slice.from, slice.to - slice.from),
    );
  } catch (error) {
    // mapLimit lets every started request finish first, so the outcomes are complete.
    settleCall(settledSpeechCost(outcomes));
    await failed(error);
    throw error;
  }
  const sliceSeconds = chunks.reduce((s, c) => s + c.billedSeconds, 0);
  settleCall(sliceSeconds > 0 ? speechCostUsd(sliceSeconds) : null);
  let placed: Awaited<ReturnType<typeof placeLongSpans>>;
  try {
    placed = await placeLongSpans(
      slices.flatMap((slice, i) => wordsInSlice(slice, chunks[i].words)),
      recognize,
      input.clipSeconds,
    );
  } catch (error) {
    await failed(error);
    throw error;
  }
  await recordSpeechCall(input.ledgerFile, {
    label: RELISTEN_LEDGER_LABEL,
    started,
    ok: true,
    billedSeconds: sliceSeconds + placed.billedSeconds,
    untimedWords: chunks.reduce((s, c) => s + c.untimed, 0),
  });

  const found = groupSegments(placed.words).map((s) => ({ ...s, heard: "relisten" as const }));
  const speech = [...input.speech, ...found].sort((a, b) => a.start - b.start);
  const after = findGaps({ speech, sounds: [] }, input.clipSeconds);
  const report: RelistenReport = {
    gapsChecked: new Set(slices.map((s) => s.gapId)).size,
    wordsFound: countWords(placed.words),
    blockedSeconds: round(
      assessRoom(before, input.clipSeconds).gapSeconds -
        assessRoom(after, input.clipSeconds).gapSeconds,
    ),
  };
  if (report.wordsFound > 0 || placed.requests > 0)
    console.info(
      `relisten: ${report.wordsFound} words in ${report.gapsChecked} silences; ` +
        `${report.blockedSeconds} s of room closed; ${placed.requests} half-spans heard again`,
    );
  return { speech, report };
}

function round(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}
