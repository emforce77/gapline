import { mkdir, readdir, readFile, writeFile, copyFile, access, stat } from "node:fs/promises";
import { constants } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import {
  RUN_TIME_LIMIT_SECONDS,
  type ActiveEdit,
  type ActiveRun,
  type RunStatus,
} from "../api-contract";
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

/** Uploads get ids with this prefix (POST /api/projects); samples and scripts' projects never do. */
export const UPLOAD_ID_PREFIX = "u-";

/** The ids of the projects that are not uploads, read from the directory names alone. */
export async function sampleProjectIds(): Promise<string[]> {
  const ids = await unlessMissing(readdir(join(dataDir(), "projects")), []);
  return ids.filter((id) => ID_PATTERN.test(id) && !id.startsWith(UPLOAD_ID_PREFIX));
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
 * sample the edit is never visible to anyone but its maker, and so that its maker can find it again
 * after a reload while it is still being made (listActiveWork).
 */
export const RUN_EDITOR_FILE = "editor.json";
export interface RunEditor {
  ownerHash: string;
  /** The rest is absent in edits made before 2026-10-03, which are never listed as unfinished. */
  startedAt?: string;
  baseRunId?: string;
  cueId?: string;
  action?: ActiveEdit["action"];
  language?: ActiveEdit["language"];
  density?: ActiveEdit["density"];
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

/**
 * On Cloud Run a file another instance replaced while this one held its old version fails with
 * ESTALE, which Node reports only by errno ("Unknown system error -116"). Read once more.
 */
const STALE_READ_RETRY_MS = 100;
export async function readFresh(
  file: string,
  read: (file: string) => Promise<string> = (f) => readFile(f, "utf8"),
): Promise<string> {
  try {
    return await read(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).errno !== -constants.errno.ESTALE) throw error;
    console.warn(`ESTALE reading ${file}; reading it again`);
    await delay(STALE_READ_RETRY_MS);
    return read(file);
  }
}

async function readEvents(file: string): Promise<TimedRunEvent[]> {
  const lines = (await readFresh(file)).split("\n");
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
  // When a run made from the web started: its owner file (a generate run) or its editor file (an
  // edit made since 2026-10-03). Read at most once, and only when the status depends on it.
  let start: Promise<string | null> | undefined;
  const readStart = () =>
    (start ??= (async () => {
      const owner = await unlessMissing(readFile(join(dir, RUN_OWNER_FILE), "utf8"), null);
      if (owner !== null) return (JSON.parse(owner) as RunOwner).startedAt;
      const editor = await unlessMissing(readFile(join(dir, RUN_EDITOR_FILE), "utf8"), null);
      return editor === null ? null : ((JSON.parse(editor) as RunEditor).startedAt ?? null);
    })());
  let events: TimedRunEvent[];
  try {
    events = await readEvents(eventsFile);
  } catch (error) {
    // executeRun writes the owner before starting the event log, and an edit writes its events
    // only when it ends. Either is a real run, even when a reload reaches it before any event.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" || !(await readStart())) throw error;
    events = [];
  }
  if (
    events.some((e) => e.type === "run_done") &&
    (scriptWritten ?? (await exists(join(dir, "script.json"))))
  )
    return { events, status: "done" };
  if (events.some((e) => e.type === "run_failed")) return { events, status: "failed" };
  // Runs started without an owner (scripts, older runs): no run lasts past the limit after its last event.
  const since = (await readStart()) ?? (await stat(eventsFile)).mtime;
  return { events, status: withinTimeLimit(since, now) ? "running" : "interrupted" };
}

export async function runStatus(
  projectId: string,
  runId: string,
  now = Date.now(),
): Promise<RunStatus> {
  return (await readRunSnapshot(projectId, runId, now)).status;
}

/** A generate run's id starts with its UTC start (newRunId): 20261003t064307205-en-standard-… */
const RUN_ID_STAMP = /^(\d{4})(\d{2})(\d{2})t(\d{2})(\d{2})(\d{2})(\d{3})-/;
/** Its owner file is written a moment after the id is made (analysis lookup, reservation). */
const RUN_ID_STAMP_SLACK_SECONDS = 60;

/** Whether a run id alone says the run started too long ago to be still going. */
function startedTooLongAgo(runId: string, now: number): boolean {
  const stamp = RUN_ID_STAMP.exec(runId);
  if (!stamp) return false;
  const [year, month, day, hour, minute, second, ms] = stamp.slice(1).map(Number);
  const started = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  return now - started > (RUN_TIME_LIMIT_SECONDS + RUN_ID_STAMP_SLACK_SECONDS) * 1000;
}

/** Unfinished generate runs and edits this viewer started, within the time limit, newest first. */
export interface ActiveWork {
  active: ActiveRun[];
  edits: ActiveEdit[];
}

/**
 * The viewer's runs and edits that are still going, from one pass over the project's runs. A run
 * whose events already end in run_done is finished, even where its script.json is not yet visible.
 * Generate runs whose id dates them past the time limit are skipped unread, so the pass costs the
 * same however many finished runs the sample collects.
 */
export async function listActiveWork(
  projectId: string,
  viewerHash: string | undefined,
  now = Date.now(),
): Promise<ActiveWork> {
  if (!viewerHash) return { active: [], edits: [] };
  const root = join(projectDir(projectId), "runs");
  const runIds = await unlessMissing(readdir(root), []);
  const unfinished = async (dir: string) => {
    const { events, status } = await readSnapshot(dir, now);
    return status === "running" && !events.some((e) => e.type === "run_done");
  };
  const found = await mapLimit(
    runIds.filter((runId) => ID_PATTERN.test(runId) && !startedTooLongAgo(runId, now)),
    READS_IN_FLIGHT,
    async (runId): Promise<ActiveRun | ActiveEdit | null> => {
      const dir = join(root, runId);
      const raw = await unlessMissing(readFile(join(dir, RUN_OWNER_FILE), "utf8"), null);
      if (raw !== null) {
        const owner = JSON.parse(raw) as RunOwner;
        if (owner.ownerHash !== viewerHash || !withinTimeLimit(owner.startedAt, now)) return null;
        // The owner file is written just before the first event, so a very young run has none yet.
        const eventsFile = join(dir, "events.jsonl");
        const written = await exists(eventsFile);
        if (!(await unfinished(dir))) return null;
        return {
          runId,
          language: owner.language,
          density: owner.density,
          startedAt: owner.startedAt,
          lastEventAt: written ? (await stat(eventsFile)).mtime.toISOString() : owner.startedAt,
        };
      }
      const marker = await unlessMissing(readFile(join(dir, RUN_EDITOR_FILE), "utf8"), null);
      if (marker === null) return null;
      const editor = JSON.parse(marker) as RunEditor;
      const { startedAt, baseRunId, cueId, action, language, density } = editor;
      if (editor.ownerHash !== viewerHash || !startedAt || !withinTimeLimit(startedAt, now))
        return null;
      if (!baseRunId || !cueId || !action || !language || !density) return null;
      if (!(await unfinished(dir))) return null;
      return { runId, baseRunId, cueId, action, language, density, startedAt };
    },
  );
  const newestFirst = (a: { startedAt: string }, b: { startedAt: string }) =>
    b.startedAt.localeCompare(a.startedAt);
  return {
    active: found
      .filter((r): r is ActiveRun => r !== null && !("baseRunId" in r))
      .sort(newestFirst),
    edits: found.filter((r): r is ActiveEdit => r !== null && "baseRunId" in r).sort(newestFirst),
  };
}

/** Unfinished generate runs this viewer started, still within the time limit, newest first. */
export async function listActiveRuns(
  projectId: string,
  viewerHash: string | undefined,
  now = Date.now(),
): Promise<ActiveRun[]> {
  return (await listActiveWork(projectId, viewerHash, now)).active;
}

export async function importFile(source: string, projectId: string, name: string): Promise<void> {
  await copyFile(source, join(projectDir(projectId), name));
}
