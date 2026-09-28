/**
 * Where the sample's hearing and watching came from. Gapline keeps
 * the last analysis of a clip and reuses it: the sample (data/sample.ts) took its speech, re-listen
 * and scene map from an earlier run of the same clip on the same day. That run's hear and watch calls
 * are the only record of what the analysis cost, so the build fails if its folder is gone.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { runId as sampleRunId, summary as sampleSummary } from "./sample";
import {
  readLedger,
  readRun,
  readRunEvents,
  runDay,
  runDir,
  stagesOf,
  TOLERANCE_USD,
} from "./runs";

/** The earlier run whose hearing and watching the sample reused (23 Sep 2026, 14 min before it). */
const ANALYSIS_RUN = "20260923t064439178-ko-standard-837b9f";
/** Stages that hear and watch the clip; they run in parallel, the re-listen after the first pass. */
const ANALYSIS_STAGES = ["hear", "relisten", "watch"];
/** Ledger label of the re-listen (RELISTEN_LEDGER_LABEL in src/lib/pipeline/relisten.ts). */
const RELISTEN_LABEL = "hear:relisten";

const analysisRun = readRun(ANALYSIS_RUN);
if (
  analysisRun.summary.analysisReused?.speech !== false ||
  analysisRun.summary.analysisReused.scene
)
  throw new Error(`${ANALYSIS_RUN} did not hear and watch the clip itself`);
if (!sampleSummary.analysisReused)
  throw new Error(`${sampleRunId} heard or watched the clip itself; it reused nothing`);

// What the sample heard and saw must be exactly what this run heard and saw, field for field.
const rawOf = (id: string) =>
  JSON.parse(readFileSync(join(runDir(id), "script.json"), "utf8")) as Record<string, unknown>;
const sampleRaw = rawOf(sampleRunId);
const analysisRaw = rawOf(ANALYSIS_RUN);
for (const key of ["speech", "scene", "gaps"])
  if (!isDeepStrictEqual(sampleRaw[key], analysisRaw[key]))
    throw new Error(`${sampleRunId}'s ${key} is not ${ANALYSIS_RUN}'s: the reuse claim is wrong`);
const day = runDay(ANALYSIS_RUN);
if (day >= sampleSummary.day) throw new Error(`${ANALYSIS_RUN} did not run before the sample`);

const events = readRunEvents(ANALYSIS_RUN);
const stages = stagesOf(events).filter((s) => ANALYSIS_STAGES.includes(s.id));
if (stages.length !== ANALYSIS_STAGES.length)
  throw new Error(`${ANALYSIS_RUN} is missing one of ${ANALYSIS_STAGES.join(", ")}`);
/** Hearing and watching run side by side: the analysis took until the last of them finished. */
const seconds = Math.max(
  ...events.stages
    .filter((s) => ANALYSIS_STAGES.includes(s.stage) && s.state === "done")
    .map((s) => s.t),
);

// Their cost, from the run's summary, recomputed from its ledger.
const ledger = readLedger(ANALYSIS_RUN);
const ledgerUsd = (match: (label: string) => boolean) =>
  ledger.filter((e) => match(e.label)).reduce((sum, e) => sum + e.costUsd, 0);
const hearCostUsd = analysisRun.summary.costByStage.hear;
const watchCostUsd = analysisRun.summary.costByStage.watch;
if (
  hearCostUsd === undefined ||
  watchCostUsd === undefined ||
  Math.abs(ledgerUsd((l) => l === "hear" || l.startsWith("hear:")) - hearCostUsd) > TOLERANCE_USD ||
  Math.abs(ledgerUsd((l) => l === "watch") - watchCostUsd) > TOLERANCE_USD
)
  throw new Error(`${ANALYSIS_RUN}: hear and watch costs disagree with its ledger`);

// ------------------------------------------------------------------ the re-listen, on real audio
const [report, ...more] = events.relisten;
const relistenCall = ledger.filter((e) => e.label === RELISTEN_LABEL);
const relistenStage = stages.find((s) => s.id === "relisten");
if (!report || more.length > 0 || relistenCall.length !== 1 || !relistenStage)
  throw new Error(`${ANALYSIS_RUN}: expected one re-listen report and one re-listen call`);
if (relistenCall[0].billedSeconds === undefined)
  throw new Error(`${ANALYSIS_RUN}: the re-listen call records no billed seconds`);

export const analysis = {
  runId: ANALYSIS_RUN,
  day,
  /** Hearing (first pass and re-listen) plus watching. */
  costUsd: hearCostUsd + watchCostUsd,
  seconds,
  hearCostUsd,
  watchCostUsd,
  /** hear, relisten, watch: each with its own seconds. */
  stages,
  /** Chirp 3 recognizing each usable silence again on its own, 23 Sep 2026. */
  relisten: {
    gapsChecked: report.gapsChecked,
    wordsFound: report.wordsFound,
    /** Narration room the words it found closed. */
    blockedSeconds: report.blockedSeconds,
    costUsd: relistenCall[0].costUsd,
    billedSeconds: relistenCall[0].billedSeconds,
    seconds: relistenStage.seconds,
  },
};
