import { releaseUploadWork } from "../store/upload-work";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { RUN_TIME_LIMIT_SECONDS } from "../api-contract";
import { readCallRecords } from "../llm/ledger";
import { MODELS } from "../models";
import type { TimedRunEvent } from "../pipeline/events";
import { runDescription } from "../pipeline/run";
import { readAnalysisParts, saveAnalysisPart } from "../store/analysis";
import {
  claimJob,
  cancelJob,
  changeClaim,
  createJob,
  loadCheckpoint,
  saveCheckpoint,
  type RunJob,
} from "./job-state";
import { priorSpend } from "./prior-spend";
import { FfmpegTimeoutError } from "../media/ffmpeg";
import {
  readProject,
  projectDir,
  readRunSnapshot,
  RUN_OWNER_FILE,
  runDir,
  writeAnalysis,
} from "../store/projects";
import { indexRunStarted, indexRunEnded, logIndexFailure } from "../store/run-index";
import { attemptSignal } from "./attempt-signal";
import { newRunBudget, runChargeBound, settleRun, withRunBudget, type Reservation } from "./budget";
import { describeFailure } from "./failure";
import type { PreparedRun } from "./start-run";

type Emit = (event: TimedRunEvent) => void;

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
    analysisReused: { speech: !!run.cached.speech, scene: !!run.cached.scene },
    startedAt: Date.now(),
    reservation,
    state: "queued",
  };
  let markerReady = !run.owner;
  try {
    await mkdir(run.dir, { recursive: true });
    if (run.owner) {
      const startedAt = new Date(job.startedAt).toISOString();
      await writeFile(
        join(run.dir, RUN_OWNER_FILE),
        JSON.stringify({ ownerHash: run.owner, startedAt, language, density }),
      );
      markerReady = true;
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
    await createJob(job);
    return job;
  } catch (error) {
    if (markerReady)
      await event(job, failureEvent(job, error)).catch((writeError) =>
        console.error("Could not record start failure", writeError),
      );
    await settleRun(reservation, 0);
    await indexRunEnded(projectId, runId, true).catch(logIndexFailure(projectId, runId));
    await releaseUploadWork(projectId, uploadToken);
    throw error;
  }
}

/** A lost dispatch answer races the worker. Only the winner can claim or cancel the queued run. */
export async function cancelDispatch(projectId: string, runId: string): Promise<boolean> {
  const job = await cancelJob(projectId, runId);
  if (!job) return false;
  try {
    await event(job, failureEvent(job, new Error("Cloud Run Job dispatch failed")));
  } finally {
    await settleRun(job.reservation, 0);
    await indexRunEnded(projectId, runId, true).catch(logIndexFailure(projectId, runId));
    await releaseUploadWork(projectId, job.uploadToken);
  }
  return true;
}

export class TerminalRunFailure extends Error {}
class InjectedInterruption extends Error {}

async function ledger(dir: string) {
  return readCallRecords(join(dir, "ledger.jsonl")).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  });
}

async function finalize(job: RunJob, charge: number, failed: boolean) {
  await settleRun(job.reservation, charge);
  await indexRunEnded(job.projectId, job.runId, failed);
  await changeClaim(job, (current) => {
    current.state = "finished";
  });
  await releaseUploadWork(job.projectId, job.uploadToken);
}

async function replay(job: RunJob, events: TimedRunEvent[], emit?: Emit) {
  const prefix = events.slice(0, job.checkpoint?.eventCount ?? 1);
  const start = prefix.findLastIndex((e) => e.type === "run_started");
  if (start < 0) throw new Error("Run has no start event to replay");
  const t = Math.max((Date.now() - job.startedAt) / 1000, events.at(-1)?.t ?? 0);
  const copied = prefix.slice(start).map((e) => ({ ...e, t }));
  await appendFile(
    join(runDir(job.projectId, job.runId), "events.jsonl"),
    copied.map((e) => JSON.stringify(e) + "\n").join(""),
  );
  for (const e of copied) emit?.(e);
}

export async function executeAttempt(
  projectId: string,
  runId: string,
  options: {
    emit?: Emit;
    signal?: AbortSignal;
    callCapUsd?: number;
    execution?: string;
    attempt?: number;
    maxRetries?: number;
  } = {},
): Promise<void> {
  const attempt = options.attempt ?? 0;
  const job = await claimJob(projectId, runId, {
    execution: options.execution ?? "inline",
    attempt,
  });
  if (!job) return;
  const dir = runDir(projectId, runId);
  const budget = newRunBudget(job.reservation, options.callCapUsd);
  const remaining = job.startedAt + RUN_TIME_LIMIT_SECONDS * 1000 - Date.now();
  const timeout = AbortSignal.timeout(Math.max(0, remaining));
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const snapshot = () => readRunSnapshot(projectId, runId);
  const terminal = async (onEntry: boolean) => {
    const log = await snapshot();
    const end = log.events.findLast((e) => e.type === "run_done" || e.type === "run_failed");
    if (!end) return false;
    // The previous task may have stopped after delivery, without any unrecorded call in flight.
    const unclean = Math.max(
      0,
      (job.uncleanAttempts ?? 0) - (onEntry && job.previousAttemptUnclean ? 1 : 0),
    );
    const charge = priorSpend(await ledger(dir), unclean, budget.limit);
    await finalize(job, charge, end.type === "run_failed");
    return true;
  };
  if (await terminal(true)) return;
  budget.spent = priorSpend(await ledger(dir), job.uncleanAttempts ?? 0, budget.limit);
  if (remaining <= 0) {
    await finalize(job, runChargeBound(budget), true);
    throw new TerminalRunFailure("Run deadline elapsed");
  }
  let summary;
  try {
    signal.throwIfAborted();
    const resume = await loadCheckpoint(job);
    if (attempt > 0) await replay(job, (await snapshot()).events, options.emit);
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
            resume,
            analysisReused: job.analysisReused,
            onCheckpoint: options.execution
              ? async (state) => {
                  const { events } = await snapshot();
                  await saveCheckpoint(job, state, events.length);
                  // Persist the exact ledger before a worker is allowed to exit at this boundary.
                  await ledger(dir);
                  if (
                    attempt === 0 &&
                    options.execution !== "inline" &&
                    process.env.GAPLINE_FAULT === "exit-after:reviewed" &&
                    state.boundary === "reviewed"
                  )
                    throw new InjectedInterruption("Interrupted after reviewed checkpoint");
                }
              : undefined,
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
    // The final event is durable even if the worker stopped just before settling.
    if (await terminal(false)) return;
    const failure = describeFailure(error);
    const retryable =
      failure.code === "internal" ||
      error instanceof FfmpegTimeoutError ||
      (failure.retryable && (failure.code === "speech_failed" || failure.code === "voice_failed"));
    const calls = await ledger(dir);
    if (
      attempt < (options.maxRetries ?? 0) &&
      retryable &&
      Date.now() < job.startedAt + RUN_TIME_LIMIT_SECONDS * 1000
    ) {
      if (!(error instanceof InjectedInterruption))
        await changeClaim(job, (current) => {
          current.cleanExit = true;
        });
      throw error;
    }
    await event(job, failureEvent(job, error), options.emit);
    await finalize(
      job,
      Math.max(runChargeBound(budget), priorSpend(calls, job.uncleanAttempts ?? 0, budget.limit)),
      true,
    );
    if (options.execution)
      throw new TerminalRunFailure("Run ended with " + failure.code, { cause: error });
    throw error;
  }
  await finalize(
    job,
    Math.max(runChargeBound(budget), Math.min(summary.costUsd, budget.limit)),
    false,
  );
}
