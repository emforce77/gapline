/**
 * What a second recognizer (faster-whisper small) hears in the opening, on the whole clip and on
 * short slices recognized on their own (scripts/deck/probe/slice_asr.py), set against Scene's runs.
 *
 * The launch call, before and after. Chirp 3's first pass timed "We have main engine start." two
 * seconds early, so the call itself fell in what looked like a silence. Before: the evaluation's
 * default run of this clip (22 Sep 2026) wrote a line into that silence, and it played over the call.
 * After: since 23 Sep Scene recognizes each silence again on its own; the re-listen heard the call and
 * closed that silence, so the sample has no silence and no line there. Runs are compared by time
 * spans, never by gap ids, which each run numbers on its own.
 *
 * It also checks the claims the hook and constraint slides make: no words in the seven seconds, and no
 * line of the sample over speech either recognizer hears.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import {
  EVAL_SUMMARY,
  OPENING_SECOND_ASR,
  RELISTEN_FIXTURE,
  SHOWCASE_CLIP,
  SLICE_ASR,
} from "../paths";
import { gloss } from "../glosses";
import { analysis } from "./analysis";
import { opening, run as sample, seven } from "./sample";
import {
  EvalSummarySchema,
  readJsonFile,
  RelistenFixtureSchema,
  SecondAsrSchema,
  SliceAsrSchema,
} from "./schema";
import {
  lastVersion,
  overlap,
  pin,
  readRun,
  round2,
  runDay,
  span,
  TOLERANCE_S,
  unionOf,
} from "./runs";

const secondAsr = readJsonFile(OPENING_SECOND_ASR, SecondAsrSchema);
const sliceAsr = readJsonFile(SLICE_ASR, SliceAsrSchema);
const fixture = readJsonFile(RELISTEN_FIXTURE, RelistenFixtureSchema);

const clipHash = createHash("sha256").update(readFileSync(SHOWCASE_CLIP)).digest("hex");
if (sliceAsr.clipSha256 !== clipHash)
  throw new Error(`${SLICE_ASR} was made from another clip; run scripts/deck/probe/slice_asr.py`);

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
if (!call) throw new Error("the slices no longer hear the launch call on its own");
const isCall = (s: { text: string }) => plain(s.text) === plain(LAUNCH_CALL);

// ---------------------------------------------- before: the evaluation's default run of the clip
const evalSummary = readJsonFile(EVAL_SUMMARY, EvalSummarySchema);
const beforeRecords = evalSummary.runs.filter(
  (r) => r.projectId === pin.projectId && r.setting === "high" && r.status === "done",
);
if (beforeRecords.length !== 1)
  throw new Error(
    `expected one finished default-reviewer run of ${pin.projectId} in the evaluation`,
  );
const before = readRun(beforeRecords[0].runId);
if (before.parentRunId || before.humanEdits?.length)
  throw new Error(`${before.runId} is not an automatic run`);
if (before.speech.some((s) => s.heard === "relisten"))
  throw new Error(`${before.runId} already re-listened; it is no longer the case before the fix`);
// It heard what the sample's first pass heard: the re-listen's segment is the only difference.
const firstPass = sample.speech.filter((s) => s.heard !== "relisten");
if (!isDeepStrictEqual(firstPass, before.speech))
  throw new Error(`${before.runId}'s speech is not the sample's first pass`);

const chirpCall = firstPass.find(isCall);
if (!chirpCall) throw new Error("Chirp 3's first pass no longer hears the launch call");
const beforeGap = before.gaps.find((g) => overlap(g, call) > 0);
if (!beforeGap || overlap(beforeGap, call) < span(call) - TOLERANCE_S)
  throw new Error(`the launch call no longer lies inside one of ${before.runId}'s silences`);
const over = before.cues.filter(
  (c) =>
    c.status === "fits" && overlap({ start: c.start, end: c.start + (c.seconds ?? 0) }, call) > 0,
);
if (over.length !== 1) throw new Error(`expected one line of ${before.runId} over the launch call`);
const beforeLine = over[0];

// The regression test's fixture must answer as the slices did, over the before-run's silence and
// line, or the slide's "tested on this case" would describe another case.
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
  Math.abs(fixture.showcaseGap.start - beforeGap.start) > TOLERANCE_S ||
  Math.abs(fixture.showcaseGap.end - beforeGap.end) > TOLERANCE_S ||
  fixture.showcaseLine.at !== beforeLine.start ||
  fixture.showcaseLine.text !== lastVersion(beforeLine).text ||
  plain(inGap.map((w) => w.word).join(" ")) !== plain(LAUNCH_CALL) ||
  Math.abs(inGap[0].start - call.start) > TOLERANCE_S ||
  Math.abs(inGap[inGap.length - 1].end - call.end) > TOLERANCE_S
)
  throw new Error("the re-listen test's fixture no longer reproduces the measured launch call");

// ---------------------------------------------- after: the sample, with the re-listen's segment
const relistened = sample.speech.filter((s) => s.heard === "relisten");
const relistenCall = relistened.find(isCall);
if (relistened.length !== 1 || !relistenCall)
  throw new Error("the sample's re-listen no longer holds only the launch call");
if (relistenCall.start > call.start + TOLERANCE_S || relistenCall.end < call.end - TOLERANCE_S)
  throw new Error("the re-listen's segment does not cover the call as the slices hear it");
if (sample.gaps.some((g) => overlap(g, call) > 0))
  throw new Error("the sample still has a silence over the launch call");
if (opening.lines.some((l) => overlap({ start: l.start, end: l.start + l.voiced }, call) > 0))
  throw new Error("a line of the sample plays over the launch call");
// The silence it closed is the before-run's: same length as the re-listen reports.
if (Math.abs(span(beforeGap) - analysis.relisten.blockedSeconds) > TOLERANCE_S)
  throw new Error("the re-listen closed another silence than the one over the launch call");

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
  /** Where Chirp 3's first pass put it. */
  chirp: { start: chirpCall.start, end: chirpCall.end },
  /** Where the slices put it, and how much earlier Chirp 3's first pass placed it. */
  heard: { start: call.start, end: call.end },
  early: round2(call.start - chirpCall.start),
  wholeClip: wholeCall,
  /** Every slice around the call, as recognized on its own (from, to, words). */
  slices,
  /** Chirp 3's first pass over the drawn span. */
  chirpSpeech: firstPass.filter((s) => s.start < OPENING_SPAN[1]),
  watchLabel,
  source: sliceAsr.source,
  checkedAt: sliceAsr.producedAt,
  /** The evaluation's default run (22 Sep 2026): a silence over the call, and a line spoken there. */
  before: {
    runId: before.runId,
    day: runDay(before.runId),
    gap: { start: beforeGap.start, end: beforeGap.end, seconds: round2(span(beforeGap)) },
    line: {
      start: beforeLine.start,
      windowEnd: beforeLine.windowEnd,
      voiced: round2(beforeLine.seconds ?? 0),
      text: lastVersion(beforeLine).text,
      gloss: gloss(lastVersion(beforeLine).text),
    },
  },
  /** The sample: the re-listen heard the call, closed that silence, and no line was written there. */
  after: {
    runId: sample.runId,
    relisten: { start: relistenCall.start, end: relistenCall.end, text: relistenCall.text },
    /** The run that re-listened (the sample reused its hearing), and what it found. */
    relistenRunId: analysis.runId,
    report: analysis.relisten,
  },
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

// ------------------------------------------------------------------ no line of the sample over speech
const heardByEither = unionOf([
  ...sample.speech,
  ...secondAsr.segments,
  ...sliceAsr.slices.flatMap((s) => s.words),
]);
for (const l of opening.lines) {
  const said = { start: l.start, end: l.start + l.voiced };
  if (heardByEither.some((s) => overlap(said, s) > 0))
    throw new Error(`line ${l.id} overlaps speech one of the recognizers hears`);
}
