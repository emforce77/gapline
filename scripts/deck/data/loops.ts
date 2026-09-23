/**
 * What the two loops did in the default reviewer's finished evaluation runs (22 Sep 2026), counted
 * line by line from each run's script.json and cross-checked against the runs' own summaries. The
 * how-it-works slide prints these counts on its loops.
 */
import { join } from "node:path";
import { EVAL_SUMMARY, REPO } from "../paths";
import { EvalSummarySchema, readJsonFile, ScriptSchema, type RunCue } from "./schema";

const summary = readJsonFile(EVAL_SUMMARY, EvalSummarySchema);
const runs = summary.runs.filter((r) => r.setting === "high" && r.status === "done");
if (runs.length === 0) throw new Error("no finished default-reviewer runs in the evaluation");
const scripts = runs.map((r) =>
  readJsonFile(
    join(REPO, "runtime/projects", r.projectId, "runs", r.runId, "script.json"),
    ScriptSchema,
  ),
);

const cues = scripts.flatMap((s) => s.cues);
/**
 * The city sequence's rifle-scope line (cue L6), rejected as "not on screen" for crosshairs: the
 * film's master shows a faint reticle at that moment, so the notes call that rejection disputed.
 */
const DISPUTED = { projectId: "eval-tos-city", cueId: "L6", rule: "unseen" };
const shipped = (c: RunCue) => c.status === "fits";
const sentBack = cues.filter((c) => c.versions.some((v) => v.review?.pass === false));
/** A line whose first voicing overran its room: it was sped up or shortened. */
const ranLong = cues.filter((c) =>
  c.versions.some((v) => (v.voice?.rate ?? 1) > 1 || v.by === "shorten"),
);
if (sentBack.some((c) => ranLong.includes(c)))
  throw new Error("a line went through both loops; the slide counts them apart");

const fittedFaster = ranLong.filter(
  (c) => shipped(c) && !c.versions.some((v) => v.by === "shorten"),
);
const rates = fittedFaster.map((c) => c.versions[c.versions.length - 1].voice?.rate ?? 1);

// Every dropped line must be one the final check listed as missing in its run: the slide says so.
const droppedUnlisted = scripts.flatMap((s) =>
  s.cues
    .filter((c) => !shipped(c))
    .filter(
      (c) => !s.summary.finalReview.missing.some((m) => m.at >= c.start && m.at < c.windowEnd),
    )
    .map((c) => `${s.runId} ${c.id}`),
);
if (droppedUnlisted.length > 0)
  throw new Error(`dropped lines the final check did not list: ${droppedUnlisted.join(", ")}`);

const disputedRun = runs.findIndex((r) => r.projectId === DISPUTED.projectId);
const disputed = scripts[disputedRun]?.cues.find((c) => c.id === DISPUTED.cueId);
if (
  !disputed ||
  !sentBack.includes(disputed) ||
  disputed.versions[0].review?.violations[0]?.rule !== DISPUTED.rule
)
  throw new Error("the disputed rifle-scope rejection is no longer among the lines sent back");

export const loopCounts = {
  runs: runs.length,
  written: cues.length,
  voiced: cues.filter(shipped).length,
  sentBack: sentBack.length,
  passedRewrite: sentBack.filter(shipped).length,
  droppedAfterReview: sentBack.filter((c) => !shipped(c)).length,
  ranLong: ranLong.length,
  fittedFaster: fittedFaster.length,
  fasterRates: rates,
  shortenedAndFitted: ranLong.filter(
    (c) => shipped(c) && c.versions.some((v) => v.by === "shorten"),
  ).length,
  droppedTooLong: ranLong.filter((c) => !shipped(c)).length,
  /** Of the lines sent back, those whose rejection the notes call disputed. */
  disputedRejections: 1,
  overlapSeconds: scripts.reduce((sum, s) => sum + s.summary.overlapWithSpeechSeconds, 0),
};

/** Runs where an independent recognizer hears speech under a voiced line, and the longest such line. */
const candidates = runs.flatMap((r) =>
  (r.independentAsrOverlapCandidates ?? []).map((c) => ({ ...c, projectId: r.projectId })),
);
if (candidates.length === 0) throw new Error("no independent-recognizer overlaps to report");
export const independentOverlaps = {
  runs: runs.filter((r) => (r.independentAsrOverlapCandidates ?? []).length > 0).length,
  longest: candidates.reduce((a, b) => (b.seconds > a.seconds ? b : a)),
};

const recordedShipped = scripts.reduce((n, s) => n + s.summary.cuesShipped, 0);
if (recordedShipped !== loopCounts.voiced)
  throw new Error(`counted ${loopCounts.voiced} voiced lines, the runs record ${recordedShipped}`);
if (
  loopCounts.written - loopCounts.voiced !==
  loopCounts.droppedAfterReview + loopCounts.droppedTooLong
)
  throw new Error("some dropped line left by neither loop; the slide would not account for it");
if (loopCounts.overlapSeconds !== 0)
  throw new Error("a voiced line overlaps the recognized speech; the slide says none does");
