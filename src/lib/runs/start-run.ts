import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readCallRecords, summarizeCosts } from "../llm/ledger";
import { randomBytes } from "node:crypto";
import {
  analysisKey,
  readAnalysisParts,
  saveAnalysisPart,
  type AnalysisParts,
} from "../store/analysis";
import { MODELS } from "../models";
import type { TimedRunEvent } from "../pipeline/events";
import { runDescription } from "../pipeline/run";
import type { Density, Language } from "../pipeline/schemas";
import {
  projectDir,
  readProject,
  RUN_OWNER_FILE,
  runDir,
  writeAnalysis,
  type Project,
  type RunOwner,
} from "../store/projects";
import { indexRunEnded, indexRunStarted, logIndexFailure } from "../store/run-index";
import {
  newRunBudget,
  reserveRun,
  runChargeBound,
  settleRun,
  withRunBudget,
  type BudgetScope,
  type Reservation,
} from "./budget";

export function newRunId(language: Language, density: Density): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(".", "")
    .slice(0, 18)
    .toLowerCase();
  return `${stamp}-${language}-${density}-${randomBytes(3).toString("hex")}`;
}

interface RunRequest {
  projectId: string;
  language: Language;
  density: Density;
  /** Owner hash of the viewer who asked; lets them find the run again while it is running. */
  owner?: string;
}

export interface PreparedRun extends RunRequest {
  project: Project;
  runId: string;
  dir: string;
  key: string;
  cached: AnalysisParts;
}

/** Everything that can fail before money is involved: the project, the run id, cached analysis. */
export async function prepareRun(input: RunRequest): Promise<PreparedRun> {
  const project = await readProject(input.projectId);
  const runId = newRunId(input.language, input.density);
  const key = await analysisKey(project, MODELS.flash);
  const cached = await readAnalysisParts(project, key);
  return { ...input, project, runId, dir: runDir(project.id, runId), key, cached };
}

/** Runs a prepared run under its reservation and settles it, whatever happens. */
export async function executeRun(
  run: PreparedRun,
  reservation: Reservation,
  emit?: (event: TimedRunEvent) => void,
): Promise<{ runId: string }> {
  const { project, runId, dir, key } = run;
  const budget = newRunBudget(reservation);
  let summary: Awaited<ReturnType<typeof runDescription>>["summary"];
  try {
    if (run.owner) {
      await mkdir(dir, { recursive: true });
      const owner: RunOwner = {
        ownerHash: run.owner,
        startedAt: new Date().toISOString(),
        language: run.language,
        density: run.density,
      };
      const { startedAt, language, density } = owner;
      await Promise.all([
        writeFile(join(dir, RUN_OWNER_FILE), JSON.stringify(owner)),
        indexRunStarted(project.id, runId, {
          owner: run.owner,
          startedAt,
          work: { kind: "run", language, density },
        }).catch(logIndexFailure(project.id, runId)),
      ]);
    }
    ({ summary } = await withRunBudget(
      reservation,
      () =>
        runDescription({
          runId,
          runDir: dir,
          clipFile: join(projectDir(project.id), "clip.mp4"),
          clipSeconds: project.clipSeconds,
          filmLanguageCode: project.filmLanguageCode,
          language: run.language,
          density: run.density,
          writerModel: MODELS.flash,
          reviewerModel: MODELS.flash,
          cached: run.cached,
          onAnalysis: async (part) => {
            await saveAnalysisPart(project, key, part);
            const complete = await readAnalysisParts(project, key);
            if (complete.speech && complete.scene)
              await writeAnalysis(project.id, { speech: complete.speech, scene: complete.scene });
          },
          emit,
        }),
      budget,
    ));
  } catch (error) {
    await indexRunEnded(project.id, runId, true).catch(logIndexFailure(project.id, runId));
    // A run that stopped early (often before its ledger exists) is charged what its calls can
    // have cost, not the whole reservation: nine early failures must not spend a day's allowance.
    const spent = await readCallRecords(join(dir, "ledger.jsonl")).then(
      (calls) => {
        const c = summarizeCosts(calls);
        return c.costStatus === "unresolved" ? runChargeBound(budget) : c.costUsd;
      },
      () => runChargeBound(budget),
    );
    await settleRun(reservation, spent);
    throw error;
  }
  // The run has written its result and sent run_done; the index now lists it for everyone who may
  // see it. A settlement that fails now is logged, never turned into a failure of the run; the
  // unsettled entry counts in full until the time limit.
  await indexRunEnded(project.id, runId, false).catch(logIndexFailure(project.id, runId));
  await settleRun(
    reservation,
    summary.costStatus === "unresolved" ? runChargeBound(budget) : summary.costUsd,
  ).catch((error: unknown) =>
    console.error(`SETTLEMENT FAILED: run=${runId} reservation=${reservation.id}`, error),
  );
  return { runId };
}

/** Starts a run for a project: preparation, budget reservation, the run itself, settlement. */
export async function startRun(input: {
  projectId: string;
  language: Language;
  density: Density;
  budgetScope?: BudgetScope;
  emit?: (event: TimedRunEvent) => void;
}): Promise<{ runId: string }> {
  const prepared = await prepareRun(input);
  const reservation = await reserveRun(input.budgetScope);
  return executeRun(prepared, reservation, input.emit);
}
