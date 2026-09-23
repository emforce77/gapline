/**
 * The Korean Tears of Steel opening (65 s): the automatic run and the finished track after its editor
 * sessions (data/showcase.ts). Every number the hook, constraint, reviewer and editor slides print is
 * computed here and cross-checked against the runs' own summaries.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { findGaps } from "../../../src/lib/pipeline/gaps";
import { gloss } from "../glosses";
import { LIVE_CHECK } from "../paths";
import { LiveCheckSchema, readJsonFile, type RunCue, type Script } from "./schema";
import {
  agree,
  cueOf,
  finalRun,
  humanEdits,
  lastVersion,
  originalRun,
  round2,
  runDir,
  sessions,
  span,
  TOLERANCE_S,
} from "./showcase";

export { finalRun, originalRun, round2 };
const live = readJsonFile(LIVE_CHECK, LiveCheckSchema);

const clip = finalRun.summary.clipSeconds;
const shipped = finalRun.cues.filter((c) => c.status !== "removed");
const removed = finalRun.cues.filter((c) => c.status === "removed");

// ------------------------------------------------------------------ the whole clip (constraint)
const speechTotal = round2(finalRun.speech.reduce((sum, s) => sum + span(s), 0));
const gapTotal = round2(finalRun.gaps.reduce((sum, g) => sum + span(g), 0));
agree("usable silence", gapTotal, finalRun.summary.gapSeconds);
const narrationTotal = round2(shipped.reduce((sum, c) => sum + (c.seconds ?? 0), 0));
agree("narration", narrationTotal, finalRun.summary.narrationSeconds);
if (finalRun.summary.overlapWithSpeechSeconds !== 0)
  throw new Error(
    "the final track overlaps Chirp 3's speech; the constraint slide says it does not",
  );

// The gaps must be exactly what Scene's own gap finder makes of this speech: that is what lets the
// slide say the rest of the clip is guard margins and pauses too short to use.
const recomputed = findGaps(
  {
    speech: finalRun.speech.map((s) => ({ ...s, speaker: "" })),
    sounds: finalRun.scene.sounds.map((s) => ({
      ...s,
      kind: s.kind as "protect" | "describe" | "ambient",
    })),
  },
  clip,
);
if (recomputed.length !== finalRun.gaps.length)
  throw new Error("gap finder disagrees with the run");
recomputed.forEach((g, i) => {
  agree(`gap ${g.id} start`, g.start, finalRun.gaps[i].start);
  agree(`gap ${g.id} end`, g.end, finalRun.gaps[i].end);
});
if (finalRun.scene.sounds.some((s) => s.kind === "protect"))
  throw new Error(
    "protected sounds present: the remainder is no longer only margins and short pauses",
  );

const shortest = finalRun.gaps.reduce((m, g) => (span(g) < span(m) ? g : m));
for (const c of shipped) {
  const g = finalRun.gaps.find((gap) => gap.id === c.gapId);
  if (!g || c.start < g.start || c.start >= g.end)
    throw new Error(`line ${c.id} does not start in its gap`);
  if (c.status !== "fits" || c.seconds === undefined) throw new Error(`line ${c.id} did not ship`);
  if (c.start + c.seconds > c.windowEnd + TOLERANCE_S)
    throw new Error(`line ${c.id} runs past its window`);
}

/** A line an editor took out: what it said and how long it was voiced before it went. */
function removedLine(c: RunCue) {
  const voiced = c.versions.find((v) => v.voice)?.voice;
  const edit = humanEdits.find((e) => e.cueId === c.id && e.action === "remove");
  if (!voiced || !edit) throw new Error(`removed line ${c.id} has no voice or no editor's removal`);
  return {
    id: c.id,
    gapId: c.gapId,
    start: c.start,
    windowEnd: c.windowEnd,
    voiced: round2(voiced.seconds),
    text: edit.before,
    gloss: gloss(edit.before),
    /** When the editor removed it (ISO, UTC). */
    at: edit.at,
  };
}

export const opening = {
  clip,
  speech: finalRun.speech,
  speechTotal,
  gaps: finalRun.gaps.map((g) => ({ ...g, seconds: round2(span(g)) })),
  gapTotal,
  remainder: round2(clip - speechTotal - gapTotal),
  shortestId: shortest.id,
  shortest: round2(span(shortest)),
  narrationTotal,
  /** Lines in the finished track, in time order. */
  lines: shipped
    .map((c) => ({
      id: c.id,
      start: c.start,
      windowEnd: c.windowEnd,
      voiced: round2(c.seconds ?? 0),
      byEditor: c.versions.some((v) => v.by === "human"),
    }))
    .sort((a, b) => a.start - b.start),
  /** Lines an editor removed from the track. */
  removed: removed.map(removedLine),
  sessions: sessions.length,
  shots: finalRun.scene.shots,
  sounds: finalRun.scene.sounds,
};

// ------------------------------------------------------------------ the seven seconds (hook)
const lockedIdx = finalRun.speech.findIndex((s) => s.text.trim() === "locked.");
if (lockedIdx < 1) throw new Error("'locked.' not found in the opening speech");
const locked = finalRun.speech[lockedIdx];
const freaky = finalRun.speech[lockedIdx + 1];
if (!freaky.text.startsWith("This is pretty freaky"))
  throw new Error("unexpected line after 'locked.'");
const hookGap = finalRun.gaps.find((g) => g.start >= locked.end && g.end <= freaky.start);
if (!hookGap) throw new Error("no usable silence between 'locked.' and 'This is pretty freaky.'");

export const seven = {
  /** Strip domain: end of the line before "locked." to the end of "This is pretty freaky." */
  domain: [finalRun.speech[lockedIdx - 1].end, freaky.end] as const,
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
    .map((c) => ({
      id: c.id,
      text: lastVersion(c).text,
      gloss: gloss(lastVersion(c).text),
      start: c.start,
      windowEnd: c.windowEnd,
      voiced: round2(c.seconds ?? 0),
      byEditor: lastVersion(c).by === "human",
    })),
};
if (seven.lines.length !== 2)
  throw new Error(`expected 2 lines in the seven seconds, got ${seven.lines.length}`);

// ------------------------------------------------------------------ one line's history (reviewer, editor)
const EDITED_ID = "L4";
const auto = cueOf(originalRun, EDITED_ID);
const [draft, rewrite] = auto.versions;
if (auto.status !== "dropped" || auto.versions.length !== 2)
  throw new Error("L4 was not dropped after one rewrite");
if (draft.review?.pass !== false || rewrite.review?.pass !== false)
  throw new Error("L4 was not rejected twice");
const missing = originalRun.summary.finalReview.missing.find(
  (m) => m.gapId === auto.gapId && m.at === auto.start,
);
if (!missing) throw new Error("the final check did not list L4's content as missing");
const edited = cueOf(finalRun, EDITED_ID);
const typed = lastVersion(edited);
if (typed.by !== "human" || !typed.voice || typed.review?.pass !== true)
  throw new Error("L4 final is not a passed human line");
if (!rewrite.review.fix.includes(typed.text))
  throw new Error("the editor's text is not the reviewer's suggested fix");

const finalVtt = join(runDir(finalRun.runId), "descriptions.vtt");
function vttTiming(text: string): string {
  const blocks = readFileSync(finalVtt, "utf8").split(/\n\s*\n/);
  const block = blocks.find((b) => b.trim().endsWith(text));
  const timing = block?.split("\n").find((l) => l.includes("-->"));
  if (!timing) throw new Error(`cue "${text}" not in ${finalVtt}`);
  return timing.trim();
}

const reviewStep = (v: typeof draft) => {
  const hit = v.review?.violations[0];
  if (!hit || !v.review) throw new Error("rejected version without a violation");
  return {
    text: v.text,
    gloss: gloss(v.text),
    rule: hit.rule,
    quote: hit.quote,
    reason: hit.reason,
    reasonGloss: gloss(hit.reason),
    fix: v.review.fix,
    fixGloss: gloss(v.review.fix),
  };
};

export const lineHistory = {
  id: EDITED_ID,
  start: auto.start,
  windowEnd: auto.windowEnd,
  room: round2(auto.windowEnd - auto.start),
  draft: reviewStep(draft),
  rewrite: reviewStep(rewrite),
  typed: { text: typed.text, gloss: gloss(typed.text), voiced: round2(typed.voice.seconds) },
  vtt: vttTiming(typed.text),
};
if (rewrite.by !== "revise")
  throw new Error("L4's second version is no longer the automatic rewrite");

// ------------------------------------------------------------------ what the final check listed (honesty)
const inSpeech = (t: number) => finalRun.speech.some((s) => t >= s.start && t < s.end);
/**
 * The automatic run's final check: what it listed as missing, and the editor's line that later filled
 * each place. The finished track is checked again; what it still lists is in `stillMissing`.
 */
export const autoCheck = {
  lines: originalRun.cues
    .filter((c) => c.status === "fits")
    .map((c) => ({
      id: c.id,
      start: c.start,
      voiced: round2(c.seconds ?? 0),
      text: lastVersion(c).text,
    }))
    .sort((a, b) => a.start - b.start),
  missing: originalRun.summary.finalReview.missing.map((m) => {
    const filled = shipped.find(
      (c) => m.at >= c.start && m.at < c.windowEnd && lastVersion(c).by === "human",
    );
    if (!filled) throw new Error(`nothing an editor typed fills the miss at ${m.at} s`);
    const line = lastVersion(filled);
    return {
      at: m.at,
      what: m.what,
      gloss: gloss(m.what),
      filled: {
        id: filled.id,
        start: filled.start,
        voiced: round2(filled.seconds ?? 0),
        text: line.text,
        gloss: gloss(line.text),
      },
    };
  }),
  stillMissing: finalRun.summary.finalReview.missing.map((m) => ({
    at: m.at,
    gapId: m.gapId,
    what: m.what,
    gloss: gloss(m.what),
    duringDialogue: inSpeech(m.at),
  })),
  finalStatus: finalRun.summary.qualityStatus,
};
if (autoCheck.missing.length !== 2) throw new Error("the automatic run no longer lists two misses");
if (originalRun.summary.qualityStatus !== "review_needed")
  throw new Error("the automatic run is no longer marked Review needed");

// ------------------------------------------------------------------ the editor session checked live
const liveSession = sessions.find((s) => s.runId === live.childRunId);
if (!liveSession || liveSession.parentRunId !== live.parentRunId)
  throw new Error("the live check's edit is not one of the sample's editor sessions");
agree("edit cost", live.childApiCost, liveSession.summary.costUsd);
agree("edit time", live.childWallSeconds, liveSession.summary.wallSeconds);
const liveLines = liveSession.cues.filter((c) => c.status === "fits").length;
if (live.unchangedWavFilesIdentical !== liveLines - 1)
  throw new Error("expected every other line's audio to be reused byte for byte");
export const editSession = {
  costUsd: live.childApiCost,
  seconds: live.childWallSeconds,
  reusedAudioFiles: live.unchangedWavFilesIdentical,
  service: live.service,
  idempotentRepeat: live.idempotentRepeat,
  privateRoutesDenied: live.privateUploadDeniedStatuses.filter((status) => status === 404).length,
  privateRoutesChecked: live.privateUploadDeniedStatuses.length,
};

const SECONDS_PER_MINUTE = 60;
/** What the finished sample track cost in API calls: the automatic run and every editor session. */
const showcaseRuns: Script[] = [originalRun, ...sessions];
const showcaseUsd = showcaseRuns.reduce((sum, r) => sum + r.summary.costUsd, 0);
export const showcaseCost = {
  runs: showcaseRuns.length,
  sessions: sessions.length,
  usd: showcaseUsd,
  perMinute: showcaseUsd / (clip / SECONDS_PER_MINUTE),
  draftPerMinute: originalRun.summary.costUsd / (clip / SECONDS_PER_MINUTE),
};
