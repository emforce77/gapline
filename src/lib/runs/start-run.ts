import { randomBytes } from "node:crypto";
import type { TimedRunEvent } from "../pipeline/events";
import { MODELS } from "../models";
import type { Density, Language } from "../pipeline/schemas";
import { analysisKey, readAnalysisParts, type AnalysisParts } from "../store/analysis";
import { readProject, runDir, type Project } from "../store/projects";
import { beginRun, executeAttempt } from "./attempt";
import { reserveRun, type BudgetScope, type Reservation } from "./budget";

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

/** CLI callers retain the run ID, emitted events and rejection when their run fails. */
export async function executeRun(
  run: PreparedRun,
  reservation: Reservation,
  emit?: (event: TimedRunEvent) => void,
  callCapUsd?: number,
): Promise<{ runId: string }> {
  await beginRun(run, reservation, emit);
  await executeAttempt(run.projectId, run.runId, { emit, callCapUsd });
  return { runId: run.runId };
}

/** Starts a run for a project: preparation, budget reservation, the run itself, settlement. */
export async function startRun(input: {
  projectId: string;
  language: Language;
  density: Density;
  budgetScope?: BudgetScope;
  scriptBudget?: { limit: number; callCapUsd: number };
  emit?: (event: TimedRunEvent) => void;
}): Promise<{ runId: string }> {
  const prepared = await prepareRun(input);
  const reservation = await reserveRun(input.budgetScope, undefined, input.scriptBudget?.limit);
  return executeRun(prepared, reservation, input.emit, input.scriptBudget?.callCapUsd);
}
