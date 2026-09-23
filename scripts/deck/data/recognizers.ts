/**
 * What a second recognizer (faster-whisper small) hears in the opening, on the whole clip and on
 * short slices recognized on their own (scripts/deck/probe/slice_asr.py). It gives the launch call
 * that Chirp 3's first pass timed two seconds early, which put the removed line over dialogue, and it
 * checks the claims the hook and constraint slides make: no words in the seven seconds, and no line
 * of the finished track over speech either recognizer hears.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { OPENING_SECOND_ASR, RELISTEN_FIXTURE, SHOWCASE_CLIP, SLICE_ASR } from "../paths";
import { opening, seven } from "./demo";
import { finalRun, round2, TOLERANCE_S } from "./showcase";
import { readJsonFile, RelistenFixtureSchema, SecondAsrSchema, SliceAsrSchema } from "./schema";

const secondAsr = readJsonFile(OPENING_SECOND_ASR, SecondAsrSchema);
const sliceAsr = readJsonFile(SLICE_ASR, SliceAsrSchema);
const fixture = readJsonFile(RELISTEN_FIXTURE, RelistenFixtureSchema);

const clipHash = createHash("sha256").update(readFileSync(SHOWCASE_CLIP)).digest("hex");
if (sliceAsr.clipSha256 !== clipHash)
  throw new Error(`${SLICE_ASR} was made from another clip; run scripts/deck/probe/slice_asr.py`);

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
const plain = (text: string) =>
  text
    .replace(/[.,!?]/g, "")
    .trim()
    .toLowerCase();

/** One slice as recognized on its own: its words joined, and where they start and end. */
function sliceText(i: number) {
  const s = sliceAsr.slices[i];
  if (!s || s.words.length === 0) throw new Error(`slice ${i} of ${SLICE_ASR} has no words`);
  return {
    from: s.from,
    to: s.to,
    text: s.words.map((w) => w.word).join(" "),
    start: s.words[0].start,
    end: s.words[s.words.length - 1].end,
    words: s.words,
  };
}

// ------------------------------------------------------------------ the launch call
const LAUNCH_CALL = "We have main engine start.";
/** The opening's first seconds, where the three slices around the launch call lie. */
export const OPENING_SPAN = [0, 11] as const;
const slices = [0, 1, 2].map(sliceText);
if (slices.some((s) => s.from < OPENING_SPAN[0] || s.to > OPENING_SPAN[1]))
  throw new Error("a launch-call slice lies outside the drawn span");
const call = slices.find((s) => plain(s.text) === plain(LAUNCH_CALL));
const chirpCall = finalRun.speech.find((s) => plain(s.text) === plain(LAUNCH_CALL));
if (!call || !chirpCall) throw new Error("the launch call is missing from one of the recognizers");

const gap = finalRun.gaps.find((g) => overlap(g, call) > 0);
if (!gap || overlap(gap, call) < call.end - call.start - TOLERANCE_S)
  throw new Error("the launch call no longer lies inside one of Chirp 3's silences");
const over = opening.removed.filter(
  (l) => overlap({ start: l.start, end: l.start + l.voiced }, call) > 0,
);
if (over.length !== 1 || over[0].gapId !== gap.id)
  throw new Error("expected one removed line over the launch call");

// The regression test's fixture must answer as the slices did, or the slide's "tested on this case"
// would describe another case.
const heard = fixture.relisten.flatMap((r) =>
  r.response.results.flatMap((res) =>
    res.alternatives.flatMap((a) =>
      a.words.map((w) => ({
        word: w.word,
        start: r.from + parseFloat(w.startOffset),
        end: r.from + parseFloat(w.endOffset),
      })),
    ),
  ),
);
const inGap = heard.filter((w) => overlap(w, fixture.showcaseGap) > 0);
if (
  fixture.showcaseGap.id !== gap.id ||
  Math.abs(fixture.showcaseGap.start - gap.start) > TOLERANCE_S ||
  Math.abs(fixture.showcaseGap.end - gap.end) > TOLERANCE_S ||
  fixture.showcaseLine.at !== over[0].start ||
  fixture.showcaseLine.text !== over[0].text ||
  plain(inGap.map((w) => w.word).join(" ")) !== plain(LAUNCH_CALL) ||
  Math.abs(inGap[0].start - call.start) > TOLERANCE_S ||
  Math.abs(inGap[inGap.length - 1].end - call.end) > TOLERANCE_S
)
  throw new Error("the re-listen test's fixture no longer reproduces the measured launch call");

/** The same recognizer on the whole clip: it hears the call where the slices do. */
const wholeWords = secondAsr.segments.flatMap((seg) => seg.words);
const callWords = plain(LAUNCH_CALL).split(" ");
const wholeAt = wholeWords.findIndex((_, i) =>
  callWords.every((w, j) => plain(wholeWords[i + j]?.word ?? "") === w),
);
if (wholeAt < 0)
  throw new Error("the whole-clip second recognizer no longer hears the launch call");
const wholeCall = {
  start: wholeWords[wholeAt].start,
  end: wholeWords[wholeAt + callWords.length - 1].end,
};
if (overlap(wholeCall, call) < TOLERANCE_S)
  throw new Error("the second recognizer puts the call elsewhere on the whole clip");

/** Scene's own watch pass heard a voice here too, but filed it as ambience, which blocks nothing. */
const watchLabel = opening.sounds.find((s) => s.start <= call.start && s.end >= call.end);
if (!watchLabel || watchLabel.kind === "protect")
  throw new Error("the watch pass's label over the launch call changed; the note describes it");

export const launchCall = {
  text: LAUNCH_CALL,
  chirp: { start: chirpCall.start, end: chirpCall.end },
  /** Where the slices put it, and how much earlier Chirp 3 placed it. */
  heard: { start: call.start, end: call.end },
  early: round2(call.start - chirpCall.start),
  wholeClip: wholeCall,
  gap: { id: gap.id, start: gap.start, end: gap.end, seconds: round2(gap.end - gap.start) },
  line: over[0],
  /** Every slice around the call, as recognized on its own (from, to, words). */
  slices,
  /** Chirp 3's first pass over the drawn span. */
  chirpSpeech: finalRun.speech.filter((s) => s.start < OPENING_SPAN[1]),
  watchLabel,
  source: sliceAsr.source,
  checkedAt: sliceAsr.producedAt,
};

// ------------------------------------------------------------------ the seven seconds, heard again
/** Word-boundary differences between the two recognizers at the ends of the silence (0.10 s here). */
const BOUNDARY_S = 0.2;
if (
  secondAsr.segments.some(
    (s) => Math.min(s.end, seven.freaky.start) - Math.max(s.start, seven.locked.end) > BOUNDARY_S,
  )
)
  throw new Error("the second recognizer hears speech inside the seven seconds");
const sevenSlice = sliceAsr.slices.find(
  (s) =>
    Math.abs(s.from - seven.locked.end) < TOLERANCE_S &&
    Math.abs(s.to - seven.freaky.start) < TOLERANCE_S,
);
if (!sevenSlice) throw new Error("the seven seconds were not recognized as a slice of their own");
if (sevenSlice.words.length > 0)
  throw new Error(
    "the seven seconds, recognized on their own, hold words; the hook slide says none",
  );
export const sevenHeard = {
  from: sevenSlice.from,
  to: sevenSlice.to,
  checkedAt: sliceAsr.producedAt,
};

// ------------------------------------------------------------------ no finished line over speech
const heardByEither = [
  ...finalRun.speech,
  ...secondAsr.segments,
  ...sliceAsr.slices.flatMap((s) => s.words),
];
for (const l of opening.lines) {
  const said = { start: l.start, end: l.start + l.voiced };
  if (heardByEither.some((s) => overlap(said, s) > 0))
    throw new Error(`line ${l.id} overlaps speech one of the recognizers hears`);
}
