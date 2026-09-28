/**
 * The sample every artifact shows: one automatic Korean run of the Tears of Steel opening (65 s),
 * pinned in runtime/showcase.json for the app, the film and the deck. It was started from the CLI
 * through the same startRun path as the Generate button. Every number here is computed from its
 * records and cross-checked against the run's own summary and events; the build stops when one
 * disagrees. Its hearing and watching came from an earlier run of the clip: see data/analysis.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parseWav } from "../../../src/lib/media/wav";
import { freeRoom } from "../../../src/lib/pipeline/cues";
import { findGaps } from "../../../src/lib/pipeline/gaps";
import { gloss } from "../glosses";
import { type RunCue } from "./schema";
import {
  agree,
  cueOf,
  lastVersion,
  pin,
  readRun,
  readRunEvents,
  round2,
  runDay,
  runDir,
  span,
  stagesOf,
  TOLERANCE_S,
  unionOf,
} from "./runs";

export const runId = pin.runs.ko;
export const run = readRun(runId);
if (run.parentRunId || run.humanEdits?.length)
  throw new Error(`${runId} is not an automatic run: it has a parent or records edits`);
if (run.cues.some((c) => c.status === "removed" || c.versions.some((v) => v.by === "human")))
  throw new Error(`${runId} holds a line a person wrote or removed`);
const { finalFix: recordedFix, analysisReused } = run.summary;
if (!recordedFix || !analysisReused)
  throw new Error(`${runId} predates the fix stage: its summary has no finalFix or analysisReused`);
const events = readRunEvents(runId);

const clip = run.summary.clipSeconds;
const shipped = run.cues.filter((c) => c.status === "fits");

// ------------------------------------------------------------------ the whole clip (constraint)
/** Dialogue as heard, overlapping segments counted once (the re-listen overlaps the first pass). */
const speechUnion = unionOf(run.speech);
const speechTotal = round2(speechUnion.reduce((sum, s) => sum + span(s), 0));
const gapTotal = round2(run.gaps.reduce((sum, g) => sum + span(g), 0));
agree("usable silence", gapTotal, run.summary.gapSeconds);
const narrationTotal = round2(shipped.reduce((sum, c) => sum + (c.seconds ?? 0), 0));
agree("narration", narrationTotal, run.summary.narrationSeconds);
if (run.summary.overlapWithSpeechSeconds !== 0)
  throw new Error("the sample overlaps Chirp 3's speech; the deck and the film say it does not");
if (shipped.length !== run.summary.cuesShipped)
  throw new Error(
    `counted ${shipped.length} shipped lines, the run records ${run.summary.cuesShipped}`,
  );

// The gaps must be exactly what Scene's own gap finder makes of this speech: that is what lets the
// remainder be called guard margins and pauses too short to use.
const recomputed = findGaps(
  {
    speech: run.speech.map((s) => ({ ...s, speaker: "" })),
    sounds: run.scene.sounds.map((s) => ({
      ...s,
      kind: s.kind as "protect" | "describe" | "ambient",
    })),
  },
  clip,
);
if (recomputed.length !== run.gaps.length) throw new Error("gap finder disagrees with the run");
recomputed.forEach((g, i) => {
  agree(`gap ${g.id} start`, g.start, run.gaps[i].start);
  agree(`gap ${g.id} end`, g.end, run.gaps[i].end);
});
if (run.scene.sounds.some((s) => s.kind === "protect"))
  throw new Error("protected sounds present: the remainder is no longer only margins and pauses");
for (const c of shipped) {
  const g = run.gaps.find((gap) => gap.id === c.gapId);
  if (!g || c.start < g.start || c.start >= g.end)
    throw new Error(`line ${c.id} does not start in its gap`);
  if (c.seconds === undefined || c.start + c.seconds > c.windowEnd + TOLERANCE_S)
    throw new Error(`line ${c.id} runs past its window`);
}
const shortest = run.gaps.reduce((m, g) => (span(g) < span(m) ? g : m));

/** The voice is read in windows this long... */
const ONSET_WINDOW_S = 0.01;
/** ...and starts at the first window within this many dB of the file's loudest one. */
const ONSET_BELOW_PEAK_DB = 30;
const PCM_BITS = 16;

/**
 * Seconds from a shipped line's start to its first spoken sound, from its voice file: the speech
 * synthesizer leads each file with near-silence, so words keyed to the line's start would show
 * before they are heard. The file must be the line's measured voice (same length).
 */
function voiceOnset(cueId: string, voiced: number): number {
  const wav = readFileSync(join(runDir(runId), "voice", `${cueId}.wav`));
  const info = parseWav(wav);
  if (info.bitsPerSample !== PCM_BITS)
    throw new Error(`${cueId}.wav is ${info.bitsPerSample}-bit, not ${PCM_BITS}-bit PCM`);
  agree(`${cueId}'s voice file length`, info.seconds, voiced);
  const frame = info.channels * (PCM_BITS / 8);
  const samples = Math.floor(info.dataLength / frame);
  const hop = Math.round(info.sampleRate * ONSET_WINDOW_S);
  const rms: number[] = [];
  for (let w = 0; w + hop <= samples; w += hop) {
    let energy = 0;
    for (let i = w; i < w + hop; i++) energy += wav.readInt16LE(info.dataOffset + i * frame) ** 2;
    rms.push(Math.sqrt(energy / hop));
  }
  const floor = Math.max(...rms) * 10 ** (-ONSET_BELOW_PEAK_DB / 20);
  return round2(rms.findIndex((r) => r >= floor) * ONSET_WINDOW_S);
}
const onsets = new Map(shipped.map((c) => [c.id, voiceOnset(c.id, c.seconds ?? 0)]));

export const opening = {
  clip,
  /** Every segment as recorded, the re-listen's (heard: "relisten") included. */
  speech: run.speech,
  /** Seconds of dialogue, overlaps counted once. */
  speechTotal,
  gaps: run.gaps.map((g) => ({ ...g, seconds: round2(span(g)) })),
  gapTotal,
  /** Guard margins around speech and pauses shorter than a usable silence. */
  remainder: round2(clip - speechTotal - gapTotal),
  shortestId: shortest.id,
  shortest: round2(span(shortest)),
  narrationTotal,
  /** Lines in the track, in time order. */
  lines: shipped
    .map((c) => ({
      id: c.id,
      gapId: c.gapId,
      start: c.start,
      windowEnd: c.windowEnd,
      voiced: round2(c.seconds ?? 0),
      /** Seconds into its voice before the first spoken sound. */
      onset: onsets.get(c.id)!,
      text: lastVersion(c).text,
      gloss: gloss(lastVersion(c).text),
    }))
    .sort((a, b) => a.start - b.start),
  shots: run.scene.shots,
  sounds: run.scene.sounds,
};

// ------------------------------------------------------------------ the seven seconds (hook)
const lockedIdx = run.speech.findIndex((s) => s.text.trim() === "locked.");
if (lockedIdx < 1) throw new Error("'locked.' not found in the opening speech");
const locked = run.speech[lockedIdx];
const freaky = run.speech[lockedIdx + 1];
if (!freaky.text.startsWith("This is pretty freaky"))
  throw new Error("unexpected line after 'locked.'");
const hookGap = run.gaps.find((g) => g.start >= locked.end && g.end <= freaky.start);
if (!hookGap) throw new Error("no usable silence between 'locked.' and 'This is pretty freaky.'");

export const seven = {
  /** Strip domain: end of the line before "locked." to the end of "This is pretty freaky." */
  domain: [run.speech[lockedIdx - 1].end, freaky.end] as const,
  locked,
  freaky,
  silence: round2(freaky.start - locked.end),
  usable: {
    id: hookGap.id,
    start: hookGap.start,
    end: hookGap.end,
    seconds: round2(span(hookGap)),
  },
  lines: shipped
    .filter((c) => c.start >= locked.end && c.start < freaky.start)
    .sort((a, b) => a.start - b.start)
    .map((c) => ({
      id: c.id,
      text: lastVersion(c).text,
      gloss: gloss(lastVersion(c).text),
      start: c.start,
      windowEnd: c.windowEnd,
      voiced: round2(c.seconds ?? 0),
      /** Seconds into its voice before the first spoken sound. */
      onset: onsets.get(c.id)!,
    })),
};
if (seven.lines.length !== 2)
  throw new Error(`expected 2 lines in the seven seconds, got ${seven.lines.length}`);
if (seven.lines.some((l) => l.start + l.voiced > freaky.start))
  throw new Error("a line in the seven seconds runs into 'This is pretty freaky.'");

// ------------------------------------------------------------------ stages, in the order they ran
/** The sample's own stages; hearing and watching were reused, so they are not among them. */
const SAMPLE_STAGES = ["gaps", "write", "review", "voice", "verify", "fix", "mix"];
export const stages = stagesOf(events);
if (stages.map((s) => s.id).join() !== SAMPLE_STAGES.join())
  throw new Error(`the sample's stages ran as ${stages.map((s) => s.id).join()}`);
const mixDone = events.stages.find((s) => s.stage === "mix" && s.state === "done");
if (!mixDone) throw new Error("the sample was never mixed");
agree("run time", mixDone.t, run.summary.wallSeconds);

// ------------------------------------------------------------------ one line sent back and rewritten
/** A rejection's first cited rule, with the reviewer's reason and fix and our English glosses. */
function rejectionOf(v: RunCue["versions"][number]) {
  const hit = v.review?.violations[0];
  if (!v.review || v.review.pass || !hit) throw new Error(`"${v.text}" was not rejected`);
  return {
    rule: hit.rule,
    quote: hit.quote,
    reason: hit.reason,
    reasonGloss: gloss(hit.reason),
    fix: v.review.fix,
    fixGloss: gloss(v.review.fix),
  };
}

const rejectedThenPassed = (c: RunCue) =>
  c.versions.length === 2 &&
  c.versions[0].review?.pass === false &&
  c.versions[1].by === "revise" &&
  c.versions[1].review?.pass === true;
const rewritten = shipped.filter(rejectedThenPassed).sort((a, b) => a.start - b.start)[0];
if (!rewritten) throw new Error(`no line of ${runId} was rejected once and passed on its rewrite`);
const [draft, rewrite] = rewritten.versions;
if (draft.review?.violations.length !== 1)
  throw new Error(`${rewritten.id}'s rejection cites more than one rule; the deck shows one`);
if (!draft.voice || !rewrite.voice)
  throw new Error(`${rewritten.id}'s draft or rewrite was not voiced`);

// Who sent it back: the per-line reviewer (rounds 1–3) or the final check (round 0, recorded by the
// fix stage after the verify stage read the whole voiced track).
const lineReviews = events.reviews.filter((r) => r.cueId === rewritten.id);
const rejection = lineReviews.find((r) => !r.verdict.pass);
const verifyDone = events.stages.find((s) => s.stage === "verify" && s.state === "done");
if (!rejection || !verifyDone) throw new Error(`${rewritten.id}'s rejection is not in the events`);
const rejectedBy: "final check" | "review" = rejection.round === 0 ? "final check" : "review";
if (
  rejectedBy === "final check" &&
  !(
    rejection.t >= verifyDone.t &&
    lineReviews.some((r) => r.round === 1 && r.verdict.pass && r.t < rejection.t)
  )
)
  throw new Error(`${rewritten.id}: a round-0 rejection that did not follow a passed review`);
if (!isDeepStrictEqual(rejection.verdict, draft.review))
  throw new Error(`${rewritten.id}: the rejection in the events is not the one its draft records`);

/** The line the reviewer slide and the film's review scene follow: sent back, rewritten, passed. */
export const line = {
  cueId: rewritten.id,
  start: rewritten.start,
  windowEnd: rewritten.windowEnd,
  room: round2(rewritten.windowEnd - rewritten.start),
  draft: {
    text: draft.text,
    gloss: gloss(draft.text),
    ...rejectionOf(draft),
    /** The draft was voiced before the final check sent it back. */
    voiced: round2(draft.voice.seconds),
  },
  rewrite: { text: rewrite.text, gloss: gloss(rewrite.text) },
  /** The rewrite's measured voice. */
  voiced: round2(rewrite.voice.seconds),
  /** English gloss of the line as it shipped (the rewrite). */
  gloss: gloss(rewrite.text),
  draftGloss: gloss(draft.text),
  rejectedBy,
};

// ------------------------------------------------------------------ lines the pipeline dropped
const droppedCues = run.cues.filter((c) => c.status === "dropped");

// ------------------------------------------------------------------ what the final check fixed and listed
const inDialogue = (t: number) => speechUnion.some((s) => t >= s.start && t < s.end);
const voicedSpans = shipped.map((c) => ({ start: c.start, end: c.start + (c.seconds ?? 0) }));
/** Moments the final check found missing, and the free room left for each (the fix stage's rule). */
export const missing = run.summary.finalReview.missing.map((m) => {
  const gap = run.gaps.find((g) => g.id === m.gapId);
  if (!gap) throw new Error(`the final check names gap ${m.gapId}, which ${runId} does not have`);
  const room = freeRoom(Math.min(Math.max(m.at, gap.start), gap.end), gap, voicedSpans);
  return {
    at: m.at,
    gapId: m.gapId,
    what: m.what,
    gloss: gloss(m.what),
    room: room && {
      start: round2(room.start),
      end: round2(room.end),
      seconds: round2(span(room)),
    },
    duringDialogue: inDialogue(m.at),
  };
});
if (missing.length === 0)
  throw new Error("the final check listed nothing; the deck shows its list");

const finalRejections = events.reviews.filter((r) => r.round === 0 && !r.verdict.pass);
const fixedByRewrite = finalRejections.filter((r) => {
  const c = cueOf(run, r.cueId);
  return c.status === "fits" && lastVersion(c).by === "revise" && lastVersion(c).review?.pass;
});
if (
  recordedFix.failing !== finalRejections.length ||
  recordedFix.rewritten !== fixedByRewrite.length
)
  throw new Error(`the events disagree with the run's finalFix ${JSON.stringify(recordedFix)}`);
if (recordedFix.missing !== missing.length)
  throw new Error(
    `finalFix counts ${recordedFix.missing} missing moments, the list has ${missing.length}`,
  );
if (rejectedBy === "final check" && !finalRejections.some((r) => r.cueId === line.cueId))
  throw new Error(`the final check's rejection is not ${line.cueId}'s`);

/** What the final check still lists: moments, how many have no silence left, and dropped lines. */
export const notes = {
  listed: missing.length,
  /** Listed moments where no silence is left to speak in (the same rule the fix stage uses). */
  noRoom: missing.filter((m) => !m.room).length,
  dropped: droppedCues.length,
};

export const summary = {
  seconds: run.summary.wallSeconds,
  costUsd: run.summary.costUsd,
  clipSeconds: clip,
  lines: shipped.length,
  qualityStatus: run.summary.qualityStatus,
  /** Hearing and watching came from an earlier run of the clip: their time and cost are not in it. */
  analysisReused: analysisReused.speech && analysisReused.scene,
  /** When the run started, from its own call ledger. */
  day: runDay(runId),
};
