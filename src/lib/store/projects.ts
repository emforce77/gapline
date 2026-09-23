import { mkdir, readdir, readFile, writeFile, copyFile, access, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { RUN_TIME_LIMIT_SECONDS, type ActiveRun, type RunStatus } from "../api-contract";
import type { RunSummary, TimedRunEvent } from "../pipeline/events";
import type { SceneMap, SpeechSegment } from "../pipeline/schemas";

/**
 * Everything lives under DATA_DIR: ./runtime locally, a Cloud Storage bucket mounted as a volume on
 * Cloud Run. Layout:
 *   projects/<id>/project.json   metadata
 *   projects/<id>/clip.mp4       the analysed clip (H.264/AAC)
 *   projects/<id>/strip.jpg      one thumbnail per second, for the timeline
 *   projects/<id>/analysis-{speech,scene}.json  separately validated keyed components
 *   projects/<id>/analysis.json  combined analysis for display and legacy results
 *   projects/<id>/runs/<runId>/  events, ledger, script and media of one run
 *   projects/<id>/runs/<runId>/owner.json  who started a live run (never served)
 */
export function dataDir(): string {
  return resolve(process.env.DATA_DIR || "runtime");
}

export const ProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["sample", "upload"]),
  clipSeconds: z.number(),
  filmLanguageCode: z.string(),
  attribution: z.string(),
  license: z.string(),
  createdAt: z.string(),
  ownerHash: z.string().optional(),
  /** Seconds covered by each thumbnail in strip.jpg. */
  stripStepSeconds: z.number(),
});
export type Project = z.infer<typeof ProjectSchema>;

export interface RunListing {
  runId: string;
  language: string;
  density: string;
  summary: RunSummary | null;
  createdAt: string;
  /** The editor's change that produced this run; absent for automatic runs. */
  lastEdit?: { cueId: string; action: "rewrite" | "remove" };
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** Project and run ids come from URLs; only this shape is ever joined into a path. */
export function assertSafeId(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error(`Invalid id: ${id}`);
  return id;
}

export function projectDir(id: string): string {
  return join(dataDir(), "projects", assertSafeId(id));
}

export function runDir(projectId: string, runId: string): string {
  return join(projectDir(projectId), "runs", assertSafeId(runId));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readProject(id: string): Promise<Project> {
  const raw = await readFile(join(projectDir(id), "project.json"), "utf8");
  return ProjectSchema.parse(JSON.parse(raw));
}

export async function writeProject(project: Project): Promise<void> {
  await mkdir(projectDir(project.id), { recursive: true });
  await writeFile(join(projectDir(project.id), "project.json"), JSON.stringify(project, null, 2));
}

export async function listProjects(): Promise<Project[]> {
  const root = join(dataDir(), "projects");
  if (!(await exists(root))) return [];
  const ids = await readdir(root);
  const projects: Project[] = [];
  for (const id of ids) {
    if (!ID_PATTERN.test(id) || !(await exists(join(root, id, "project.json")))) continue;
    projects.push(await readProject(id));
  }
  return projects.sort((a, b) =>
    a.kind === b.kind ? b.createdAt.localeCompare(a.createdAt) : a.kind === "sample" ? -1 : 1,
  );
}

export async function readAnalysis(
  id: string,
): Promise<{ speech: SpeechSegment[]; scene: SceneMap } | null> {
  const file = join(projectDir(id), "analysis.json");
  if (!(await exists(file))) return null;
  return JSON.parse(await readFile(file, "utf8"));
}

export async function writeAnalysis(
  id: string,
  analysis: { speech: SpeechSegment[]; scene: SceneMap },
): Promise<void> {
  await writeFile(join(projectDir(id), "analysis.json"), JSON.stringify(analysis, null, 2));
}

/** Finished runs, newest first. A run without script.json failed or is still running. */
export async function listRuns(projectId: string): Promise<RunListing[]> {
  const root = join(projectDir(projectId), "runs");
  if (!(await exists(root))) return [];
  const listings: RunListing[] = [];
  for (const runId of await readdir(root)) {
    if (!ID_PATTERN.test(runId)) continue;
    const script = join(root, runId, "script.json");
    if (!(await exists(script))) continue;
    const parsed = JSON.parse(await readFile(script, "utf8"));
    const edit = parsed.humanEdits?.at(-1);
    const started = JSON.parse(
      (await readFile(join(root, runId, "events.jsonl"), "utf8")).split("\n")[0],
    );
    listings.push({
      runId,
      language: started.language,
      density: started.density,
      summary: parsed.summary ?? null,
      createdAt: (await stat(script)).mtime.toISOString(),
      ...(edit
        ? {
            lastEdit: {
              cueId: edit.cueId,
              action: edit.action === "remove" ? ("remove" as const) : ("rewrite" as const),
            },
          }
        : {}),
    });
  }
  return listings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Written when a live run starts, so its starter can find it again after a reload. */
export const RUN_OWNER_FILE = "owner.json";
export interface RunOwner {
  ownerHash: string;
  startedAt: string;
  language: ActiveRun["language"];
  density: ActiveRun["density"];
}

async function readEvents(file: string): Promise<TimedRunEvent[]> {
  return (await readFile(file, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TimedRunEvent);
}

function withinTimeLimit(since: Date | string, now: number): boolean {
  return now - new Date(since).getTime() < RUN_TIME_LIMIT_SECONDS * 1000;
}

/**
 * State of one run from its files: script.json means done, a run_failed event means failed, and a
 * run with neither is running until the time limit passes, then interrupted (its process is gone).
 */
export async function runStatus(
  projectId: string,
  runId: string,
  now = Date.now(),
): Promise<RunStatus> {
  const dir = runDir(projectId, runId);
  if (await exists(join(dir, "script.json"))) return "done";
  const eventsFile = join(dir, "events.jsonl");
  if ((await readEvents(eventsFile)).some((e) => e.type === "run_failed")) return "failed";
  const ownerFile = join(dir, RUN_OWNER_FILE);
  // Runs started without an owner (scripts, older runs): no run lasts past the limit after its last event.
  const since = (await exists(ownerFile))
    ? (JSON.parse(await readFile(ownerFile, "utf8")) as RunOwner).startedAt
    : (await stat(eventsFile)).mtime;
  return withinTimeLimit(since, now) ? "running" : "interrupted";
}

/** Unfinished runs this viewer started, still within the time limit, newest first. */
export async function listActiveRuns(
  projectId: string,
  viewerHash: string | undefined,
  now = Date.now(),
): Promise<ActiveRun[]> {
  const root = join(projectDir(projectId), "runs");
  if (!viewerHash || !(await exists(root))) return [];
  const active: ActiveRun[] = [];
  for (const runId of await readdir(root)) {
    if (!ID_PATTERN.test(runId)) continue;
    const dir = join(root, runId);
    const ownerFile = join(dir, RUN_OWNER_FILE);
    if (!(await exists(ownerFile)) || (await exists(join(dir, "script.json")))) continue;
    const owner = JSON.parse(await readFile(ownerFile, "utf8")) as RunOwner;
    if (owner.ownerHash !== viewerHash || !withinTimeLimit(owner.startedAt, now)) continue;
    // The owner file is written just before the first event, so a very young run has none yet.
    const eventsFile = join(dir, "events.jsonl");
    const written = await exists(eventsFile);
    const events = written ? await readEvents(eventsFile) : [];
    if (events.some((e) => e.type === "run_failed" || e.type === "run_done")) continue;
    active.push({
      runId,
      language: owner.language,
      density: owner.density,
      startedAt: owner.startedAt,
      lastEventAt: written ? (await stat(eventsFile)).mtime.toISOString() : owner.startedAt,
    });
  }
  return active.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function importFile(source: string, projectId: string, name: string): Promise<void> {
  await copyFile(source, join(projectDir(projectId), name));
}
