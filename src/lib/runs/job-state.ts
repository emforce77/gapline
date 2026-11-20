import { randomUUID } from "node:crypto";
import { readJson, updateJson } from "../store/atomic";
import type { RunCheckpoint } from "../pipeline/checkpoint";
import type { Density, Language } from "../pipeline/schemas";
import type { Reservation } from "./budget";

export interface AttemptId {
  execution: string;
  attempt: number;
}
interface Lease extends AttemptId {
  claimId: string;
}
export interface RunJob {
  projectId: string;
  runId: string;
  language: Language;
  density: Density;
  analysisKey: string;
  analysisReused: { speech: boolean; scene: boolean };
  uploadToken?: string;
  startedAt: number;
  reservation: Reservation;
  state: "queued" | "running" | "cancelled" | "finished";
  lease?: Lease;
  cleanExit?: boolean;
  previousAttemptUnclean?: boolean;
  uncleanAttempts?: number;
  checkpoint?: { boundary: RunCheckpoint["boundary"]; eventCount: number; file?: string };
}
const base = (projectId: string, runId: string) => `projects/${projectId}/runs/${runId}`;
const key = (projectId: string, runId: string) => base(projectId, runId) + "/job.json";
export const createJob = (job: RunJob) =>
  updateJson(
    key(job.projectId, job.runId),
    () => job,
    () => {},
  );

class Claimed extends Error {}
function changeJob<T>(projectId: string, runId: string, change: (job: RunJob) => T) {
  return updateJson<Partial<RunJob>, T>(
    key(projectId, runId),
    () => ({}),
    (job) => {
      if (!job.state || job.projectId !== projectId || job.runId !== runId)
        throw new Error("Run job was not prepared");
      return change(job as RunJob);
    },
  );
}

export function cancelJob(projectId: string, runId: string) {
  return changeJob(projectId, runId, (job) => {
    if (job.state !== "queued") throw new Claimed();
    job.state = "cancelled";
    return job;
  }).catch((error) => {
    if (error instanceof Claimed) return null;
    throw error;
  });
}
export function claimJob(projectId: string, runId: string, id: AttemptId) {
  return changeJob(projectId, runId, (job) => {
    if (
      job.state === "cancelled" ||
      job.state === "finished" ||
      (job.lease && (job.lease.execution !== id.execution || id.attempt <= job.lease.attempt))
    )
      throw new Claimed();
    job.previousAttemptUnclean = Boolean(job.lease && !job.cleanExit);
    if (job.previousAttemptUnclean) job.uncleanAttempts = (job.uncleanAttempts ?? 0) + 1;
    job.lease = { ...id, claimId: randomUUID() };
    job.state = "running";
    job.cleanExit = false;
    return job;
  }).catch((error) => {
    if (error instanceof Claimed) return null;
    throw error;
  });
}

export function changeClaim(job: RunJob, change: (current: RunJob) => void) {
  return changeJob(job.projectId, job.runId, (current) => {
    if (!job.lease || current.lease?.claimId !== job.lease.claimId)
      throw new Error("Worker no longer owns this run");
    change(current);
  });
}

export async function saveCheckpoint(job: RunJob, checkpoint: RunCheckpoint, eventCount: number) {
  let file: string | undefined;
  if (checkpoint.boundary !== "analyzed") {
    file =
      base(job.projectId, job.runId) +
      `/checkpoints/${job.lease!.claimId}-${checkpoint.boundary}.json`;
    await updateJson(
      file,
      () => checkpoint,
      () => {},
    );
  }
  await changeClaim(job, (current) => {
    current.checkpoint = { boundary: checkpoint.boundary, eventCount, file };
  });
}
export function loadCheckpoint(job: RunJob): Promise<RunCheckpoint | undefined> {
  if (!job.checkpoint) return Promise.resolve(undefined);
  if (job.checkpoint.boundary === "analyzed") return Promise.resolve({ boundary: "analyzed" });
  if (!job.checkpoint.file) throw new Error("Checkpoint has no contents");
  return readJson<RunCheckpoint>(job.checkpoint.file, () => {
    throw new Error("Missing checkpoint contents");
  });
}
