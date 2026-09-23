/**
 * The sample the film shows: one automatic Korean run of the Tears of Steel opening (65 s), made end
 * to end with no editor (SAMPLE_RUN in config.ts; runtime/showcase.json pins the same run for the
 * app). Every number the hook, constraint, review and result scenes print is computed here from its
 * script.json and cross-checked against the run's own summary.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { freeRoom } from "../../src/lib/pipeline/cues";
import { findGaps } from "../../src/lib/pipeline/gaps";
import { readJsonFile, ScriptSchema, type RunCue } from "../deck/data/schema";
import { agree, lastVersion, round2, span, TOLERANCE_S } from "../deck/data/showcase";
import { gloss } from "../deck/glosses";
import { runFile, SAMPLE_RUN } from "./config";

export const run = readJsonFile(runFile(SAMPLE_RUN, "script.json"), ScriptSchema);
if (run.parentRunId || run.humanEdits?.length)
  throw new Error(`${SAMPLE_RUN} is not an automatic run: the film says no one edited it`);

/** What the final check found and fixed (absent when it found nothing to fix), and what was reused. */
const FinalFixSchema = z.object({
  summary: z.object({
    analysisReused: z.object({ speech: z.boolean(), scene: z.boolean() }),
    finalFix: z
      .object({
        failing: z.number(),
        missing: z.number(),
        rewritten: z.number(),
        added: z.number(),
      })
      .optional(),
  }),
});
const extra = FinalFixSchema.parse(
  JSON.parse(readFileSync(runFile(SAMPLE_RUN, "script.json"), "utf8")),
).summary;
export const finalFix = extra.finalFix ?? null;

const clip = run.summary.clipSeconds;
const shipped = run.cues.filter((c) => c.status === "fits");
if (shipped.some((c) => c.versions.some((v) => v.by === "human" || v.by === "remove")))
  throw new Error(`${SAMPLE_RUN} holds a line an editor wrote`);

// ------------------------------------------------------------------ the whole clip (constraint)
const speechTotal = round2(run.speech.reduce((sum, s) => sum + span(s), 0));
const gapTotal = round2(run.gaps.reduce((sum, g) => sum + span(g), 0));
agree("usable silence", gapTotal, run.summary.gapSeconds);
const narrationTotal = round2(shipped.reduce((sum, c) => sum + (c.seconds ?? 0), 0));
agree("narration", narrationTotal, run.summary.narrationSeconds);
if (run.summary.overlapWithSpeechSeconds !== 0)
  throw new Error("the sample overlaps Chirp 3's speech; the film says it does not");
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
for (const c of shipped) {
  const g = run.gaps.find((gap) => gap.id === c.gapId);
  if (!g || c.start < g.start || c.start >= g.end)
    throw new Error(`line ${c.id} does not start in its gap`);
  if (c.seconds === undefined || c.start + c.seconds > c.windowEnd + TOLERANCE_S)
    throw new Error(`line ${c.id} runs past its window`);
}
const shortest = run.gaps.reduce((m, g) => (span(g) < span(m) ? g : m));

export const opening = {
  clip,
  speech: run.speech,
  speechTotal,
  gaps: run.gaps.map((g) => ({ ...g, seconds: round2(span(g)) })),
  gapTotal,
  shortestId: shortest.id,
  shortest: round2(span(shortest)),
  narrationTotal,
  lines: shipped
    .map((c) => ({
      id: c.id,
      start: c.start,
      windowEnd: c.windowEnd,
      voiced: round2(c.seconds ?? 0),
    }))
    .sort((a, b) => a.start - b.start),
  shots: run.scene.shots,
};

// ------------------------------------------------------------------ the seven seconds (hook)
const lockedIdx = run.speech.findIndex((s) => s.text.trim() === "locked.");
if (lockedIdx < 1) throw new Error("'locked.' not found in the opening speech");
const locked = run.speech[lockedIdx];
const freaky = run.speech[lockedIdx + 1];
if (!freaky.text.startsWith("This is pretty freaky"))
  throw new Error("unexpected line after 'locked.'");

export const seven = {
  /** Strip domain: end of the line before "locked." to the end of "This is pretty freaky." */
  domain: [run.speech[lockedIdx - 1].end, freaky.end] as const,
  locked,
  freaky,
  silence: round2(freaky.start - locked.end),
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
    })),
};
if (seven.lines.length !== 2)
  throw new Error(`expected 2 lines in the seven seconds, got ${seven.lines.length}`);

// ------------------------------------------------------------------ one line the reviewer sent back
const rejectedThenPassed = (c: RunCue) =>
  c.versions.length === 2 &&
  c.versions[0].review?.pass === false &&
  c.versions[1].by === "revise" &&
  c.versions[1].review?.pass === true;
const rewritten = shipped.filter(rejectedThenPassed).sort((a, b) => a.start - b.start)[0];
if (!rewritten)
  throw new Error(`no line of ${SAMPLE_RUN} was rejected once and passed on its rewrite`);
const [draft, rewrite] = rewritten.versions;
const hit = draft.review!.violations[0];
if (!rewrite.voice) throw new Error(`${rewritten.id}'s rewrite was not voiced`);

/** The line the review scene follows: rejected once, rewritten from the reviewer's fix, passed. */
export const line = {
  cueId: rewritten.id,
  start: rewritten.start,
  windowEnd: rewritten.windowEnd,
  room: round2(rewritten.windowEnd - rewritten.start),
  draft: { text: draft.text, gloss: gloss(draft.text), rule: hit.rule, fix: draft.review!.fix },
  rewrite: { text: rewrite.text, gloss: gloss(rewrite.text) },
  voiced: round2(rewrite.voice.seconds),
};

// ------------------------------------------------------------------ what the final check still lists
const voicedSpans = shipped.map((c) => ({ start: c.start, end: c.start + (c.seconds ?? 0) }));
const missing = run.summary.finalReview.missing;
export const notes = {
  listed: missing.length,
  /** Listed moments where no silence is left to speak in (the same rule the fix stage uses). */
  noRoom: missing.filter((m) => {
    const gap = run.gaps.find((g) => g.id === m.gapId);
    return !gap || !freeRoom(Math.min(Math.max(m.at, gap.start), gap.end), gap, voicedSpans);
  }).length,
  dropped: run.cues.filter((c) => c.status === "dropped").length,
};

export const summary = {
  seconds: run.summary.wallSeconds,
  costUsd: run.summary.costUsd,
  clipSeconds: clip,
  lines: shipped.length,
  qualityStatus: run.summary.qualityStatus,
  /** Hearing and watching came from an earlier run of the clip: their time and cost are not in it. */
  analysisReused: extra.analysisReused.speech && extra.analysisReused.scene,
  /** When the run started, from its own call ledger. */
  day: new Date(
    JSON.parse(readFileSync(runFile(SAMPLE_RUN, "ledger.jsonl"), "utf8").split("\n")[0])
      .at as string,
  ),
};
