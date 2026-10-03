import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { ActiveEdit, ActiveRun } from "../api-contract";
import { mapLimit } from "../pipeline/map-limit";
import { readJson, updateJson } from "./atomic";
import {
  assertSafeId,
  inspectRun,
  isRunId,
  projectDir,
  READS_IN_FLIGHT,
  runDir,
  runVisibleTo,
  unlessMissing,
  withinTimeLimit,
  type Project,
  type RunInspection,
  type RunListing,
} from "./projects";

/**
 * projects/<id>/runs-index.json: what the listings need of each run, so that a listing reads the
 * runs folder's names and this one file however many runs the project holds. On Cloud Run each file
 * call is a Cloud Storage round trip; reading several files of every run made each page wait on
 * hundreds of them (TTFB ~4.5 s with 75 runs on the sample, 2026-10-03).
 *
 * A run's own code adds it when it starts (`active`) and records how it ended (`finished` with its
 * listing, or `ended`). A listing reads the run itself only when the index cannot answer for it:
 * a folder the index does not know yet (runs from before the index, or whose start or end was not
 * recorded), a run past the time limit still marked as going, and the viewer's own runs still
 * marked as going, whose result can be written a moment before the index hears of it. A run it
 * finds finished or ended is written back, so it is read once; one still going is read again next
 * time. A run that only lacks files (inspectRun's `stalled`: a run that died before writing them,
 * or one being copied in) is noted with when it was first seen so, read again on every listing,
 * and recorded as ended only when it still lacks them a whole run time limit later: a copy that
 * completes in that time is listed. The media route never serves the file.
 */
const RUN_INDEX_VERSION = 1;

export interface IndexedRun extends RunListing {
  /** Who made it from the web; null for a run made by a script (public on a sample). */
  owner: string | null;
}

export interface ActiveEntry {
  owner: string;
  startedAt: string;
  work:
    | { kind: "run"; language: ActiveRun["language"]; density: ActiveRun["density"] }
    | ({ kind: "edit" } & Pick<
        ActiveEdit,
        "baseRunId" | "cueId" | "action" | "language" | "density"
      >);
}

export interface RunIndex {
  version: typeof RUN_INDEX_VERSION;
  finished: Record<string, IndexedRun>;
  /** Started from the web and not yet recorded as ended. */
  active: Record<string, ActiveEntry>;
  /** Ended without a result to list: failed, ran out of time, or nothing to list. */
  ended: string[];
  /** Runs seen `stalled` (inspectRun), with when a listing first saw them so. */
  stalled: Record<string, string>;
}

const LanguageSchema = z.enum(["ko", "en"]);
const DensitySchema = z.enum(["brief", "standard"]);
const RunIndexSchema = z.object({
  version: z.literal(RUN_INDEX_VERSION),
  // Only what this code relies on. The rest of a listing is what inspectRun read from the run's
  // own files, passed on as a scan would; checking more could reject an index it wrote itself
  // (an old run's odd summary) and rebuild it on every listing.
  finished: z.record(
    z.string(),
    z.object({ runId: z.string(), createdAt: z.string(), owner: z.string().nullable() }),
  ),
  active: z.record(
    z.string(),
    z.object({
      owner: z.string(),
      startedAt: z.string(),
      work: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("run"), language: LanguageSchema, density: DensitySchema }),
        z.object({
          kind: z.literal("edit"),
          baseRunId: z.string(),
          cueId: z.string(),
          action: z.enum(["rewrite", "remove"]),
          language: LanguageSchema,
          density: DensitySchema,
        }),
      ]),
    }),
  ),
  ended: z.array(z.string()),
  stalled: z.record(z.string(), z.string()),
});

/** The index's key under DATA_DIR, as readJson and updateJson take it. */
export function runIndexKey(projectId: string): string {
  return `projects/${assertSafeId(projectId)}/runs-index.json`;
}

function emptyIndex(): RunIndex {
  return { version: RUN_INDEX_VERSION, finished: {}, active: {}, ended: [], stalled: {} };
}

/**
 * `state` as a run index, the same object so that updateJson saves what is changed on it. One from
 * another version, or one that does not parse, is emptied: the listings then read every run again
 * and write a new one.
 */
function asRunIndex(state: object, projectId: string): RunIndex {
  if (RunIndexSchema.safeParse(state).success) return state as RunIndex;
  console.error(
    `RUN INDEX REBUILT: ${runIndexKey(projectId)} is not a version ${RUN_INDEX_VERSION} index`,
  );
  for (const key of Object.keys(state)) delete (state as Record<string, unknown>)[key];
  return Object.assign(state, emptyIndex());
}

/** The stored index; an empty one when there is none yet. */
export async function readRunIndex(projectId: string): Promise<RunIndex> {
  const stored = await readJson<object | null>(runIndexKey(projectId), () => null);
  return stored === null ? emptyIndex() : asRunIndex(stored, projectId);
}

/**
 * What a run's own files told the index: how it ended, or since when it is stalled (null: it is
 * no longer).
 */
type IndexChange = { runId: string } & (
  { finished: IndexedRun } | { ended: true } | { stalledSince: string | null }
);

/** Finished and ended runs are settled; a run still going, stalled or not yet set up is not. */
function settlementOf(runId: string, seen: RunInspection): IndexChange | null {
  if (seen.state === "finished") return { runId, finished: { ...seen.listing, owner: seen.owner } };
  if (seen.state === "ended") return { runId, ended: true };
  return null;
}

/**
 * For a listing: a run first seen stalled is noted; one stalled for a whole run time limit since
 * is ended; one no longer stalled is unmarked.
 */
function changeOf(
  runId: string,
  seen: RunInspection,
  stalledSince: string | undefined,
  now: number,
): IndexChange | null {
  const settled = settlementOf(runId, seen);
  if (settled) return settled;
  if (seen.state !== "stalled")
    return stalledSince === undefined ? null : { runId, stalledSince: null };
  if (stalledSince === undefined) return { runId, stalledSince: new Date(now).toISOString() };
  return withinTimeLimit(stalledSince, now) ? null : { runId, ended: true };
}

/**
 * A result always wins: a run recorded as ended that later finishes (a run that outlived the time
 * limit) is listed, and an ending learned late never hides a result recorded meanwhile.
 */
function applyChanges(index: RunIndex, changes: IndexChange[]): void {
  const ended = new Set(index.ended);
  for (const c of changes) {
    if ("stalledSince" in c) {
      if (c.stalledSince === null) delete index.stalled[c.runId];
      else if (!index.finished[c.runId] && !ended.has(c.runId))
        index.stalled[c.runId] ??= c.stalledSince;
      continue;
    }
    delete index.stalled[c.runId];
    delete index.active[c.runId];
    if ("finished" in c) {
      index.finished[c.runId] = c.finished;
      ended.delete(c.runId);
    } else if (!index.finished[c.runId]) ended.add(c.runId);
  }
  index.ended = [...ended];
}

function saveChanges(projectId: string, changes: IndexChange[]): Promise<void> {
  return updateJson<RunIndex, void>(runIndexKey(projectId), emptyIndex, (state) =>
    applyChanges(asRunIndex(state, projectId), changes),
  );
}

/** For a run's own code: a failed index write is logged, never a failed run (see loadRunView). */
export function logIndexFailure(projectId: string, runId: string): (error: unknown) => void {
  return (error) =>
    console.error(`RUN INDEX NOT UPDATED: project=${projectId} run=${runId}`, error);
}

/** Records a run started from the web, so its maker's listings find it without a scan. */
export async function indexRunStarted(
  projectId: string,
  runId: string,
  entry: ActiveEntry,
): Promise<void> {
  await updateJson<RunIndex, void>(runIndexKey(projectId), emptyIndex, (state) => {
    const index = asRunIndex(state, projectId);
    index.active[runId] = entry;
    // A listing that caught the new folder before its marker found nothing to date it by.
    delete index.stalled[runId];
  });
}

/**
 * Records how a run ended, from its own files (inspectRun), so its listing is the one a listing
 * that read the run would make. A run that is not finished is recorded as ended only when its code
 * says it `failed`; otherwise it stays as it is for the listings to read again.
 */
export async function indexRunEnded(
  projectId: string,
  runId: string,
  failed: boolean,
): Promise<void> {
  const seen = await inspectRun(projectId, runId, Date.now());
  const settlement = settlementOf(runId, seen) ?? (failed ? { runId, ended: true as const } : null);
  if (!settlement) {
    console.warn(`run index: ${projectId}/${runId} ended as ${seen.state}; listings will read it`);
    return;
  }
  await saveChanges(projectId, [settlement]);
}

/** What the listings read for one viewer. */
interface RunView {
  /** Finished runs whose folder is there, in the order the runs folder lists them. */
  finished: IndexedRun[];
  /** The viewer's runs and edits still being made, within the time limit. */
  making: ({ runId: string } & ActiveEntry)[];
}

/** An unindexed run's markers as an index entry; edits from before 2026-10-03 have none. */
function entryFromMarkers(seen: Extract<RunInspection, { state: "running" }>): ActiveEntry | null {
  const { owner, editor } = seen.markers;
  if (owner) {
    const { language, density } = owner;
    return {
      owner: owner.ownerHash,
      startedAt: owner.startedAt,
      work: { kind: "run", language, density },
    };
  }
  if (!editor) return null;
  const { ownerHash, startedAt, baseRunId, cueId, action, language, density } = editor;
  if (!startedAt || !baseRunId || !cueId || !action || !language || !density) return null;
  return {
    owner: ownerHash,
    startedAt,
    work: { kind: "edit", baseRunId, cueId, action, language, density },
  };
}

/**
 * The runs folder's names and the index, read together; then the runs the index cannot answer for
 * (see the top of this file), at most READS_IN_FLIGHT at a time. What they settle is written back.
 */
async function loadRunView(
  projectId: string,
  viewerHash: string | undefined,
  now: number,
): Promise<RunView> {
  const [names, index] = await Promise.all([
    unlessMissing(readdir(join(projectDir(projectId), "runs")), [] as string[]),
    readRunIndex(projectId),
  ]);
  const onDisk = names.filter(isRunId);
  const ended = new Set(index.ended);
  const toRead: { runId: string; entry?: ActiveEntry }[] = [
    ...onDisk
      .filter((runId) => !index.finished[runId] && !index.active[runId] && !ended.has(runId))
      .map((runId) => ({ runId })),
    ...Object.entries(index.active)
      .filter(
        ([, entry]) =>
          (viewerHash !== undefined && entry.owner === viewerHash) ||
          !withinTimeLimit(entry.startedAt, now),
      )
      .map(([runId, entry]) => ({ runId, entry })),
  ];
  const read = await mapLimit(toRead, READS_IN_FLIGHT, async ({ runId, entry }) => ({
    runId,
    entry,
    seen: await inspectRun(projectId, runId, now, entry),
  }));
  const changes: IndexChange[] = [];
  const making: RunView["making"] = [];
  for (const { runId, entry, seen } of read) {
    const change = changeOf(runId, seen, index.stalled[runId], now);
    if (change) changes.push(change);
    if (seen.state !== "running" || seen.finishing) continue;
    const going = entry ?? entryFromMarkers(seen);
    if (going && going.owner === viewerHash && withinTimeLimit(going.startedAt, now))
      making.push({ runId, ...going });
  }
  if (changes.length > 0) {
    // The listing is right without the write; a failed one only means the next listing reads
    // these runs again (and a stalled run's clock starts later).
    await saveChanges(projectId, changes).catch((error: unknown) =>
      console.error(`RUN INDEX NOT UPDATED: project=${projectId} listing`, error),
    );
    applyChanges(index, changes);
  }
  return {
    finished: onDisk.flatMap((runId) => index.finished[runId] ?? []),
    making,
  };
}

function visibleRuns(
  project: Pick<Project, "kind">,
  viewerHash: string | undefined,
  view: RunView,
): RunListing[] {
  return view.finished
    .filter((run) => runVisibleTo(project, run.owner, viewerHash))
    .map(({ owner: _owner, ...listing }) => listing)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Unfinished generate runs and edits this viewer started, within the time limit, newest first. */
export interface ActiveWork {
  active: ActiveRun[];
  edits: ActiveEdit[];
}

async function activeWork(projectId: string, view: RunView): Promise<ActiveWork> {
  const newestFirst = (a: { startedAt: string }, b: { startedAt: string }) =>
    b.startedAt.localeCompare(a.startedAt);
  const active = await Promise.all(
    view.making.flatMap(({ runId, startedAt, work }) =>
      work.kind === "run"
        ? [
            (async (): Promise<ActiveRun> => {
              // The owner file is written just before the first event: a very young run has none.
              const events = join(runDir(projectId, runId), "events.jsonl");
              const written = await unlessMissing(stat(events), null);
              const { language, density } = work;
              return {
                runId,
                language,
                density,
                startedAt,
                lastEventAt: written ? written.mtime.toISOString() : startedAt,
              };
            })(),
          ]
        : [],
    ),
  );
  const edits = view.making.flatMap(({ runId, startedAt, work }): ActiveEdit[] => {
    if (work.kind !== "edit") return [];
    const { baseRunId, cueId, action, language, density } = work;
    return [{ runId, baseRunId, cueId, action, language, density, startedAt }];
  });
  return { active: active.sort(newestFirst), edits: edits.sort(newestFirst) };
}

/**
 * Finished runs this viewer may see (runVisibleTo), newest first. Both the script and its final
 * event must be available. Pages everyone sees pass no viewer and get the public runs only.
 */
export async function listRuns(
  project: Pick<Project, "id" | "kind">,
  viewerHash: string | undefined,
): Promise<RunListing[]> {
  return visibleRuns(project, viewerHash, await loadRunView(project.id, viewerHash, Date.now()));
}

/**
 * The viewer's runs and edits that are still going. A run whose events already end in run_done is
 * finished, even where its script.json is not yet visible.
 */
export async function listActiveWork(
  projectId: string,
  viewerHash: string | undefined,
  now = Date.now(),
): Promise<ActiveWork> {
  if (!viewerHash) return { active: [], edits: [] };
  return activeWork(projectId, await loadRunView(projectId, viewerHash, now));
}

/** Unfinished generate runs this viewer started, still within the time limit, newest first. */
export async function listActiveRuns(
  projectId: string,
  viewerHash: string | undefined,
  now = Date.now(),
): Promise<ActiveRun[]> {
  return (await listActiveWork(projectId, viewerHash, now)).active;
}

/** listRuns and listActiveWork from one read of the index (GET /api/projects/[id]/runs). */
export async function listRunsAndWork(
  project: Pick<Project, "id" | "kind">,
  viewerHash: string,
  now = Date.now(),
): Promise<{ runs: RunListing[] } & ActiveWork> {
  const view = await loadRunView(project.id, viewerHash, now);
  return { runs: visibleRuns(project, viewerHash, view), ...(await activeWork(project.id, view)) };
}
