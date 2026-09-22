import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readCallRecords, summarizeCosts } from "../llm/ledger";
import { randomBytes } from "node:crypto";
import { analysisKey, readAnalysisParts, saveAnalysisPart } from "../store/analysis";
import { MODELS } from "../models";
import type { TimedRunEvent } from "../pipeline/events";
import { runDescription } from "../pipeline/run";
import type { Density, Language } from "../pipeline/schemas";
import { projectDir, readProject, runDir, writeAnalysis } from "../store/projects";
import { reserveRun, settleRun, withRunBudget, type BudgetScope } from "./budget";

export function newRunId(language: Language, density: Density): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(".", "")
    .slice(0, 18)
    .toLowerCase();
  return `${stamp}-${language}-${density}-${randomBytes(3).toString("hex")}`;
}

/** Starts a run for a project: budget reservation, cached analysis, the run itself, settlement. */
export async function startRun(input: {
  projectId: string;
  language: Language;
  density: Density;
  budgetScope?: BudgetScope;
  emit?: (event: TimedRunEvent) => void;
}): Promise<{ runId: string }> {
  const project = await readProject(input.projectId);
  const runId = newRunId(input.language, input.density);
  const dir = runDir(project.id, runId);
  const key = await analysisKey(project, MODELS.flash);
  const cached = await readAnalysisParts(project, key);
  const reservation = await reserveRun(input.budgetScope);
  try {
    const { summary } = await withRunBudget(reservation, () =>
      runDescription({
        runId,
        runDir: dir,
        clipFile: join(projectDir(project.id), "clip.mp4"),
        clipSeconds: project.clipSeconds,
        filmLanguageCode: project.filmLanguageCode,
        language: input.language,
        density: input.density,
        writerModel: MODELS.flash,
        reviewerModel: MODELS.flash,
        cached,
        onAnalysis: async (part) => {
          await saveAnalysisPart(project, key, part);
          const complete = await readAnalysisParts(project, key);
          if (complete.speech && complete.scene)
            await writeAnalysis(project.id, { speech: complete.speech, scene: complete.scene });
        },
        emit: input.emit,
      }),
    );
    await settleRun(reservation, summary.costStatus === "unresolved" ? null : summary.costUsd);
    return { runId };
  } catch (error) {
    const spent = await readCallRecords(join(dir, "ledger.jsonl")).then(
      (calls) => {
        const c = summarizeCosts(calls);
        return c.costStatus === "unresolved" ? null : c.costUsd;
      },
      () => null,
    );
    await settleRun(reservation, spent);
    throw error;
  }
}
