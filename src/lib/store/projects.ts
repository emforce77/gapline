import { mkdir, readdir, readFile, writeFile, copyFile, access, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { RUN_TIME_LIMIT_SECONDS, type ActiveRun, type RunStatus } from "../api-contract";
import type { RunSummary, TimedRunEvent } from "../pipeline/events";
import { mapLimit } from "../pipeline/map-limit";
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
 *   projects/<id>/runs/<runId>/owner.json  who started a live run from the web (never served)
 *   projects/<id>/runs/<runId>/editor.json who made an edit from the web (never served); a file of
 *     its own, because owner.json also means "a generate run its starter can resume"
 * Everyone can open a sample, so on a sample a run with either file belongs to that viewer alone
 * (runVisibleTo). Runs made by scripts, such as the curated sample results, have neither and are
 * public. An upload is reachable only by its owner, so every run of it is theirs.
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

/**
 * On Cloud Run every file call is a network round trip to the bucket, so listings read their
 * projects and runs this many at a time instead of one after another.
 */
const READS_IN_FLIGHT = 8;

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * The result of a read, or `missing` when the file (or its directory) is not there. Reading
 * straight away saves the separate existence check, which costs a round trip of its own.
 */
async function unlessMissing<T, M>(read: Promise<T>, missing: M): Promise<T | M> {
  try {
    return await read;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return missing;
    throw error;
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

/** Every project, samples first, then newest first. It reads every project.json, uploads included. */
export async function listProjects(): Promise<Project[]> {
  const ids = await unlessMissing(readdir(join(dataDir(), "projects")), []);
  const read = await mapLimit(
    ids.filter((id) => ID_PATTERN.test(id)),
    READS_IN_FLIGHT,
    (id) => unlessMissing(readProject(id), null),
  );
  const projects = read.filter((p): p is Project => p !== null);
  return projects.sort((a, b) =>
    a.kind === b.kind ? b.createdAt.localeCompare(a.createdAt) : a.kind === "sample" ? -1 : 1,
  );
}

export async function readAnalysis(
  id: string,
): Promise<{ speech: SpeechSegment[]; scene: SceneMap } | null> {
  const raw = await unlessMissing(readFile(join(projectDir(id), "analysis.json"), "utf8"), null);
  return raw === null ? null : JSON.parse(raw);
}

export async function writeAnalysis(
  id: string,
  analysis: { speech: SpeechSegment[]; scene: SceneMap },
): Promise<void> {
  await writeFile(join(projectDir(id), "analysis.json"), JSON.stringify(analysis, null, 2));
}

/**
 * Finished runs this viewer may see (runVisibleTo), newest first. Both the script and its final
 * event must be available. Pages everyone sees pass no viewer and get the public runs only.
 */
export async function listRuns(
  project: Pick<Project, "id" | "kind">,
  viewerHash: string | undefined,
): Promise<RunListing[]> {
  const runIds = await unlessMissing(readdir(join(projectDir(project.id), "runs")), []);
  const listings = await mapLimit(
    runIds.filter((runId) => ID_PATTERN.test(runId)),
    READS_IN_FLIGHT,
    (runId) => listedRun(project, runId, viewerHash),
  );
  return listings
    .filter((r): r is RunListing => r !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** One run for listRuns, or null when it is unfinished or not this viewer's to see. */
async function listedRun(
  project: Pick<Project, "id" | "kind">,
  runId: string,
  viewerHash: string | undefined,
): Promise<RunListing | null> {
  const dir = runDir(project.id, runId);
  const script = join(dir, "script.json");
  // One call both finds the script and dates the listing.
  const written = await unlessMissing(stat(script), null);
  if (!written) return null;
  if (!(await canSeeRun(project, runId, viewerHash))) return null;
  // A reload must not put a run in finishedRunIds before its final event can be displayed.
  const [snapshot, raw] = await Promise.all([
    readSnapshot(dir, Date.now(), true),
    readFile(script, "utf8"),
  ]);
  if (snapshot.status !== "done") return null;
  const parsed = JSON.parse(raw);
  const edit = parsed.humanEdits?.at(-1);
  const started = snapshot.events.find((event) => event.type === "run_started");
  if (!started) return null;
  return {
    runId,
    language: started.language,
    density: started.density,
    summary: parsed.summary ?? null,
    createdAt: written.mtime.toISOString(),
    ...(edit
      ? {
          lastEdit: {
            cueId: edit.cueId,
            action: edit.action === "remove" ? ("remove" as const) : ("rewrite" as const),
          },
        }
      : {}),
  };
}

/** Written when a live run starts, so its starter can find it again after a reload. */
export const RUN_OWNER_FILE = "owner.json";
export interface RunOwner {
  ownerHash: string;
  startedAt: string;
  language: ActiveRun["language"];
  density: ActiveRun["density"];
}

/**
 * Written when an edit made from the web starts, before any of its result files, so that on a
 * sample the edit is never visible to anyone but its maker.
 */
export const RUN_EDITOR_FILE = "editor.json";
export interface RunEditor {
  ownerHash: string;
}

const OwnerMarkerSchema = z.object({ ownerHash: z.string().min(1) });

async function readOwnerMarker(file: string): Promise<string | null> {
  try {
    return OwnerMarkerSchema.parse(JSON.parse(await readFile(file, "utf8"))).ownerHash;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** The owner hash of the viewer who made a run from the web; null for a run made by a script. */
export async function runOwnerHash(projectId: string, runId: string): Promise<string | null> {
  const dir = runDir(projectId, runId);
  return (
    (await readOwnerMarker(join(dir, RUN_OWNER_FILE))) ??
    (await readOwnerMarker(join(dir, RUN_EDITOR_FILE)))
  );
}

/**
 * Whether a viewer may see a run. A sample is open to everyone, so what one viewer makes on it
 * stays theirs: there only runs without an owner are public. An upload is reachable only by its
 * owner (canAccess), so every run of it is theirs.
 */
export function runVisibleTo(
  project: Pick<Project, "kind">,
  runOwner: string | null,
  viewerHash: string | undefined,
): boolean {
  return project.kind !== "sample" || runOwner === null || runOwner === viewerHash;
}

/**
 * runVisibleTo for a run on disk. A run that does not exist has no owner; reading it then fails as
 * not found, exactly like another viewer's run.
 */
export async function canSeeRun(
  project: Pick<Project, "id" | "kind">,
  runId: string,
  viewerHash: string | undefined,
): Promise<boolean> {
  // Only a sample's runs can belong to someone other than the viewer; uploads skip the reads.
  const owner = project.kind === "sample" ? await runOwnerHash(project.id, runId) : null;
  return runVisibleTo(project, owner, viewerHash);
}

async function readEvents(file: string): Promise<TimedRunEvent[]> {
  const lines = (await readFile(file, "utf8")).split("\n");
  const events: TimedRunEvent[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line) as TimedRunEvent);
    } catch (error) {
      // A reader can catch appendFile halfway through the last record. Keep all completed
      // events and pick up the rest on the next poll; corruption in a completed line still fails.
      if (index !== lines.length - 1) throw error;
    }
  }
  return events;
}

function withinTimeLimit(since: Date | string, now: number): boolean {
  return now - new Date(since).getTime() < RUN_TIME_LIMIT_SECONDS * 1000;
}

/**
 * Events and status from the same read. A result is done only once that snapshot includes its
 * final event and script.json exists, so polling cannot stop before it receives the result.
 */
export async function readRunSnapshot(
  projectId: string,
  runId: string,
  now = Date.now(),
): Promise<{ events: TimedRunEvent[]; status: RunStatus }> {
  return readSnapshot(runDir(projectId, runId), now);
}

/** readRunSnapshot of a run directory; `scriptWritten` when the caller has just found script.json. */
async function readSnapshot(
  dir: string,
  now: number,
  scriptWritten?: true,
): Promise<{ events: TimedRunEvent[]; status: RunStatus }> {
  const eventsFile = join(dir, "events.jsonl");
  const ownerFile = join(dir, RUN_OWNER_FILE);
  // The owner file is read at most once, and only when the status depends on it.
  let owner: Promise<RunOwner | null> | undefined;
  const readOwner = () =>
    (owner ??= unlessMissing(readFile(ownerFile, "utf8"), null).then((raw) =>
      raw === null ? null : (JSON.parse(raw) as RunOwner),
    ));
  let events: TimedRunEvent[];
  try {
    events = await readEvents(eventsFile);
  } catch (error) {
    // executeRun writes the owner before starting the event log. This is a real run, even
    // when a reload reaches it before run_started has been written.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !(await readOwner())) throw error;
    events = [];
  }
  if (
    events.some((e) => e.type === "run_done") &&
    (scriptWritten ?? (await exists(join(dir, "script.json"))))
  )
    return { events, status: "done" };
  if (events.some((e) => e.type === "run_failed")) return { events, status: "failed" };
  // Runs started without an owner (scripts, older runs): no run lasts past the limit after its last event.
  const started = await readOwner();
  const since = started ? started.startedAt : (await stat(eventsFile)).mtime;
  return { events, status: withinTimeLimit(since, now) ? "running" : "interrupted" };
}

export async function runStatus(
  projectId: string,
  runId: string,
  now = Date.now(),
): Promise<RunStatus> {
  return (await readRunSnapshot(projectId, runId, now)).status;
}

/** Unfinished runs this viewer started, still within the time limit, newest first. */
export async function listActiveRuns(
  projectId: string,
  viewerHash: string | undefined,
  now = Date.now(),
): Promise<ActiveRun[]> {
  const root = join(projectDir(projectId), "runs");
  if (!viewerHash) return [];
  const runIds = await unlessMissing(readdir(root), []);
  const active = await mapLimit(
    runIds.filter((runId) => ID_PATTERN.test(runId)),
    READS_IN_FLIGHT,
    async (runId): Promise<ActiveRun | null> => {
      const dir = join(root, runId);
      const raw = await unlessMissing(readFile(join(dir, RUN_OWNER_FILE), "utf8"), null);
      if (raw === null) return null;
      const owner = JSON.parse(raw) as RunOwner;
      if (owner.ownerHash !== viewerHash || !withinTimeLimit(owner.startedAt, now)) return null;
      // The owner file is written just before the first event, so a very young run has none yet.
      const eventsFile = join(dir, "events.jsonl");
      const written = await exists(eventsFile);
      if ((await runStatus(projectId, runId, now)) !== "running") return null;
      return {
        runId,
        language: owner.language,
        density: owner.density,
        startedAt: owner.startedAt,
        lastEventAt: written ? (await stat(eventsFile)).mtime.toISOString() : owner.startedAt,
      };
    },
  );
  return active
    .filter((r): r is ActiveRun => r !== null)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export async function importFile(source: string, projectId: string, name: string): Promise<void> {
  await copyFile(source, join(projectDir(projectId), name));
}
