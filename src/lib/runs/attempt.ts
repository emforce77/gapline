import { releaseUploadWork } from "../store/upload-work";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RUN_TIME_LIMIT_SECONDS } from "../api-contract";
import { readCallRecords, summarizeCosts } from "../llm/ledger";
import { MODELS } from "../models";
import type { TimedRunEvent } from "../pipeline/events";
import { runDescription } from "../pipeline/run";
import { readAnalysisParts, saveAnalysisPart } from "../store/analysis";
import { updateJson } from "../store/atomic";
import { readProject, projectDir, RUN_OWNER_FILE, runDir, writeAnalysis } from "../store/projects";
import { indexRunStarted, indexRunEnded, logIndexFailure } from "../store/run-index";
import { attemptSignal } from "./attempt-signal";
import { newRunBudget, runChargeBound, settleRun, withRunBudget, type Reservation } from "./budget";
import { describeFailure } from "./failure";
import type { PreparedRun } from "./start-run";

interface RunJob {
  projectId: string;
  runId: string;
  language: PreparedRun["language"];
  density: PreparedRun["density"];
  analysisKey: string;
  uploadToken?: string;
  analysisReused: boolean;
  startedAt: number;
  reservation: Reservation;
  state: "queued" | "running" | "cancelled";
}
type Emit = (event: TimedRunEvent) => void;
const key = (projectId: string, runId: string) => `projects/${projectId}/runs/${runId}/job.json`;

async function event(job: RunJob, message: TimedRunEvent, emit?: Emit) {
  await appendFile(
    join(runDir(job.projectId, job.runId), "events.jsonl"),
    JSON.stringify(message) + "\n",
  );
  emit?.(message);
}

function failureEvent(job: RunJob, error: unknown): TimedRunEvent {
  const failure = describeFailure(error);
  return {
    type: "run_failed",
    t: (Date.now() - job.startedAt) / 1000,
    error: failure.code,
    ...failure,
  };
}

export async function beginRun(
  run: PreparedRun,
  reservation: Reservation,
  emit?: Emit,
  uploadToken?: string,
): Promise<RunJob> {
  const { projectId, runId, language, density } = run;
  const job: RunJob = {
    projectId,
    runId,
    language,
    density,
    analysisKey: run.key,
    uploadToken,
    analysisReused: !!(run.cached.speech && run.cached.scene),
    startedAt: Date.now(),
    reservation,
    state: "queued",
  };
  try {
    await mkdir(run.dir, { recursive: true });
    if (run.owner) {
      const startedAt = new Date(job.startedAt).toISOString();
      await writeFile(
        join(run.dir, RUN_OWNER_FILE),
        JSON.stringify({ ownerHash: run.owner, startedAt, language, density }),
      );
      await indexRunStarted(projectId, runId, {
        owner: run.owner,
        startedAt,
        work: { kind: "run", language, density },
      });
    }
    await event(
      job,
      {
        type: "run_started",
        t: 0,
        runId,
        language,
        density,
        clipSeconds: run.project.clipSeconds,
        writerModel: MODELS.flash,
        reviewerModel: MODELS.flash,
      },
      emit,
    );
    await updateJson(
      key(projectId, runId),
      () => job,
      () => {},
    );
    return job;
  } catch (error) {
    await releaseUploadWork(projectId, uploadToken);
    await settleRun(reservation, 0);
    await indexRunEnded(projectId, runId, true).catch(logIndexFailure(projectId, runId));
    throw error;
  }
}

/** A lost dispatch answer races the worker. Only the winner can claim or cancel the queued run. */
async function takeJob(projectId: string, runId: string, state: RunJob["state"]) {
  // updateJson calls initial even on reads. A placeholder is never written when the job is absent.
  return updateJson<Partial<RunJob>, RunJob | null>(
    key(projectId, runId),
    () => ({}),
    (job) => {
      if (!job.state || job.projectId !== projectId || job.runId !== runId)
        throw new Error("Run job was not prepared");
      if (job.state !== "queued") return null;
      job.state = state;
      return job as RunJob;
    },
  );
}

export async function cancelDispatch(projectId: string, runId: string): Promise<boolean> {
  const job = await takeJob(projectId, runId, "cancelled");
  if (!job) return false;
  try {
    await event(job, failureEvent(job, new Error("Cloud Run Job dispatch failed")));
  } finally {
    await releaseUploadWork(projectId, job.uploadToken);
    await settleRun(job.reservation, 0);
    await indexRunEnded(projectId, runId, true).catch(logIndexFailure(projectId, runId));
  }
  return true;
}

export async function executeAttempt(
  projectId: string,
  runId: string,
  options: {
    emit?: Emit;
    signal?: AbortSignal;
    callCapUsd?: number;
  } = {},
): Promise<void> {
  const job = await takeJob(projectId, runId, "running");
  if (!job) return;
  const dir = runDir(projectId, runId);
  const budget = newRunBudget(job.reservation, options.callCapUsd);
  const remaining = job.startedAt + RUN_TIME_LIMIT_SECONDS * 1000 - Date.now();
  const timeout = AbortSignal.timeout(Math.max(0, remaining));
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  let summary;
  try {
    if (remaining <= 0) throw new Error("Run deadline elapsed before the worker started");
    signal.throwIfAborted();
    const project = await readProject(projectId);
    const cached = await readAnalysisParts(project, job.analysisKey);
    ({ summary } = await attemptSignal.run(signal, () =>
      withRunBudget(
        job.reservation,
        () =>
          runDescription({
            runId,
            runDir: dir,
            clipFile: join(projectDir(projectId), "clip.mp4"),
            clipSeconds: project.clipSeconds,
            filmLanguageCode: project.filmLanguageCode,
            density: job.density,
            language: job.language,
            writerModel: MODELS.flash,
            reviewerModel: MODELS.flash,
            startedAt: job.startedAt,
            reportFailure: false,
            streamFromLog: !options.emit,
            cached,
            emit: options.emit,
            onAnalysis: async (part) => {
              await saveAnalysisPart(project, job.analysisKey, part);
              const complete = await readAnalysisParts(project, job.analysisKey);
              if (complete.speech && complete.scene)
                await writeAnalysis(projectId, { speech: complete.speech, scene: complete.scene });
            },
          }),
        budget,
      ),
    ));
  } catch (error) {
    try {
      await event(job, failureEvent(job, error), options.emit);
    } finally {
      const charge = await readCallRecords(join(dir, "ledger.jsonl")).then(
        (calls) => {
          const costs = summarizeCosts(calls);
          return costs.costStatus === "known" && !budget.pending
            ? costs.costUsd
            : runChargeBound(budget);
        },
        () => runChargeBound(budget),
      );
      await releaseUploadWork(projectId, job.uploadToken);
      await settleRun(job.reservation, charge);
      await indexRunEnded(projectId, runId, true).catch(logIndexFailure(projectId, runId));
    }
    throw error;
  }
  await releaseUploadWork(projectId, job.uploadToken);
  await indexRunEnded(projectId, runId, false).catch(logIndexFailure(projectId, runId));
  await settleRun(
    job.reservation,
    summary.costStatus === "known" ? summary.costUsd : runChargeBound(budget),
  );
}
