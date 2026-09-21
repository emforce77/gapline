import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { readCallRecords } from "../llm/ledger";
import { MODELS } from "../models";
import type { TimedRunEvent } from "../pipeline/events";
import { runDescription } from "../pipeline/run";
import type { Density, Language } from "../pipeline/schemas";
import { projectDir, readAnalysis, readProject, runDir, writeAnalysis } from "../store/projects";
import { reserveRun, settleRun } from "./budget";

export function newRunId(language: Language, density: Density): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(".", "")
    .slice(0, 18)
    .toLowerCase();
  return `${stamp}-${language}-${density}`;
}

/** Starts a run for a project: budget reservation, cached analysis, the run itself, settlement. */
export async function startRun(input: {
  projectId: string;
  language: Language;
  density: Density;
  emit?: (event: TimedRunEvent) => void;
}): Promise<{ runId: string }> {
  const project = await readProject(input.projectId);
  const runId = newRunId(input.language, input.density);
  const dir = runDir(project.id, runId);
  const cached = (await readAnalysis(project.id)) ?? undefined;
  const reservation = await reserveRun();
  try {
    const { summary } = await runDescription({
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
      emit: input.emit,
    });
    if (!cached) {
      const script = JSON.parse(await readFile(join(dir, "script.json"), "utf8"));
      await writeAnalysis(project.id, { speech: script.speech, scene: script.scene });
    }
    await settleRun(reservation, summary.costUsd);
    return { runId };
  } catch (error) {
    const spent = await readCallRecords(join(dir, "ledger.jsonl")).then(
      (calls) => calls.reduce((sum, c) => sum + c.costUsd, 0),
      () => 0,
    );
    await settleRun(reservation, spent);
    throw error;
  }
}
