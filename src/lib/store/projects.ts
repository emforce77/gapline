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
 *   projects/<id>/runs-index.json  what a listing needs of each run (run-index.ts; never served)
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

/** Whether a folder name under runs/ is a run id; other names there are never runs. */
export function isRunId(name: string): boolean {
  return ID_PATTERN.test(name);
}

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
export const READS_IN_FLIGHT = 8;

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
export async function unlessMissing<T, M>(read: Promise<T>, missing: M): Promise<T | M> {
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

export function withinTimeLimit(since: Date | string, now: number): boolean {
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

/** What the web wrote as a run started: owner.json (a generate run) or editor.json (an edit). */
export interface RunMarkers {
  owner?: RunOwner;
  editor?: RunEditor;
}

/** A run's start marker; a run with owner.json is a generate run, whatever else it holds. */
async function readRunMarkers(dir: string): Promise<RunMarkers> {
  const owner = await unlessMissing(readFile(join(dir, RUN_OWNER_FILE), "utf8"), null);
  if (owner !== null) return { owner: JSON.parse(owner) as RunOwner };
  const editor = await unlessMissing(readFile(join(dir, RUN_EDITOR_FILE), "utf8"), null);
  return editor === null ? {} : { editor: JSON.parse(editor) as RunEditor };
}

/** When a run made from the web started (edits made before 2026-10-03 do not say). */
function markerStart(markers: RunMarkers): string | null {
  return (markers.owner ?? markers.editor)?.startedAt ?? null;
}

/**
 * readRunSnapshot of a run directory. `scriptWritten`: the caller has just looked for script.json.
 * `start`: when the run started, if the caller already knows (null: it has no start marker);
 * otherwise its markers are read, at most once and only when the status depends on them.
 */
async function readSnapshot(
  dir: string,
  now: number,
  scriptWritten?: boolean,
  start?: string | null,
): Promise<{ events: TimedRunEvent[]; status: RunStatus }> {
  const eventsFile = join(dir, "events.jsonl");
  let started: Promise<string | null> | undefined =
    start === undefined ? undefined : Promise.resolve(start);
  const readStart = () => (started ??= readRunMarkers(dir).then(markerStart));
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

/** What a run's own files say about it, for the run index (run-index.ts). */
export type RunInspection =
  /** Listed: its script and its final event are both there. `owner`: who made it from the web. */
  | { state: "finished"; listing: RunListing; owner: string | null }
  /**
   * Never listed, from what its files say: it failed, it ran out of time with an event log that
   * has no final event, or its log has no start event.
   */
  | { state: "ended" }
  /**
   * Not listed for now, for want of a file: no event at all (an edit writes its events when it
   * ends), or a final event whose script is missing, past the time limit; or nothing dates it. A
   * copy still under way (`gcloud storage cp -r` puts a run's files there one by one, keeping or
   * not their old dates) looks the same, so the run index records it as ended only once it has
   * stayed this way for a whole run time limit (run-index.ts).
   */
  | { state: "stalled" }
  /**
   * Still being made, or `finishing`: its final event is written and its script is not there yet,
   * which no listing shows as either finished or still being made.
   */
  | { state: "running"; finishing: boolean; markers: RunMarkers }
  /** Nothing says yet when it started, and its id says it may be young: a run still setting up. */
  | { state: "unknown" };

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

/**
 * Reads one run the way a listing used to read every run: the same status as readRunSnapshot, and
 * for a finished run the same listing. `known`: whose the run is and when it started, from the run
 * index, so its markers need not be read.
 */
export async function inspectRun(
  projectId: string,
  runId: string,
  now: number,
  known?: { owner: string; startedAt: string },
): Promise<RunInspection> {
  const dir = runDir(projectId, runId);
  const script = join(dir, "script.json");
  const [written, markers] = known
    ? [undefined, undefined]
    : await Promise.all([unlessMissing(stat(script), null), readRunMarkers(dir)]);
  let snapshot: { events: TimedRunEvent[]; status: RunStatus };
  try {
    snapshot = await readSnapshot(
      dir,
      now,
      written === undefined ? undefined : written !== null,
      known ? known.startedAt : markerStart(markers!),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // No event and no start time. A generate run's id dates it; an edit from before 2026-10-03
    // that stopped early has only its marker, which dates it. A folder nothing dates (an older
    // edit with only its ledger) is stalled from the start; the index dates it by when it saw it.
    const marker = markers?.owner ? RUN_OWNER_FILE : markers?.editor ? RUN_EDITOR_FILE : null;
    const since = marker ? (await stat(join(dir, marker))).mtime : null;
    if (!since && !RUN_ID_STAMP.test(runId)) return { state: "stalled" };
    const over = since ? !withinTimeLimit(since, now) : startedTooLongAgo(runId, now);
    return over ? { state: "stalled" } : { state: "unknown" };
  }
  const { events, status } = snapshot;
  const finalEvent = events.some((e) => e.type === "run_done");
  if (status === "running")
    return { state: "running", finishing: finalEvent, markers: markers ?? {} };
  if (status === "failed") return { state: "ended" };
  // Out of time. With an event log that lacks the final event the run never finished; with no event
  // at all, or a final event without its script, its files may still be on their way.
  if (status === "interrupted")
    return events.length === 0 || finalEvent ? { state: "stalled" } : { state: "ended" };
  const started = events.find((event) => event.type === "run_started");
  if (!started) return { state: "ended" };
  const [stats, raw] = await Promise.all([written ?? stat(script), readFile(script, "utf8")]);
  const parsed = JSON.parse(raw);
  const edit = parsed.humanEdits?.at(-1);
  const markerOwner = markers?.owner ?? markers?.editor;
  return {
    state: "finished",
    owner: known
      ? known.owner
      : markerOwner
        ? OwnerMarkerSchema.parse(markerOwner).ownerHash
        : null,
    listing: {
      runId,
      language: started.language,
      density: started.density,
      summary: parsed.summary ?? null,
      createdAt: stats.mtime.toISOString(),
      ...(edit
        ? {
            lastEdit: {
              cueId: edit.cueId,
              action: edit.action === "remove" ? ("remove" as const) : ("rewrite" as const),
            },
          }
        : {}),
    },
  };
}

export async function runStatus(
  projectId: string,
  runId: string,
  now = Date.now(),
): Promise<RunStatus> {
  return (await readRunSnapshot(projectId, runId, now)).status;
}

export async function importFile(source: string, projectId: string, name: string): Promise<void> {
  await copyFile(source, join(projectDir(projectId), name));
}
