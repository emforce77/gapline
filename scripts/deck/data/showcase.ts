/**
 * The sample track the app shows: the Korean run pinned in runtime/showcase.json, walked back through
 * its parents to the automatic run. Each run in between is one editor session. Helpers shared by the
 * data modules that read these runs live here too.
 */
import { join } from "node:path";
import { PROJECTS, SHOWCASE_PIN } from "../paths";
import {
  readJsonFile,
  ScriptSchema,
  ShowcasePinSchema,
  type HumanEditRecord,
  type RunCue,
  type Script,
} from "./schema";

/** Timings in the run records are rounded to 0.01 s; sums may drift by one step. */
export const TOLERANCE_S = 0.011;
export const round2 = (x: number): number => Math.round(x * 100) / 100;
export const lastVersion = (c: RunCue) => c.versions[c.versions.length - 1];
export const span = (s: { start: number; end: number }) => s.end - s.start;

export function cueOf(run: Script, id: string): RunCue {
  const found = run.cues.find((c) => c.id === id);
  if (!found) throw new Error(`cue ${id} missing in ${run.runId}`);
  return found;
}

/** Stops the build when a number the deck computes disagrees with what the run recorded. */
export function agree(label: string, computed: number, recorded: number): void {
  if (Math.abs(computed - recorded) > TOLERANCE_S)
    throw new Error(`${label}: computed ${computed} but the run records ${recorded}`);
}

export const pin = readJsonFile(SHOWCASE_PIN, ShowcasePinSchema);
const runFile = (runId: string) => join(PROJECTS, pin.projectId, "runs", runId, "script.json");
export const runDir = (runId: string) => join(PROJECTS, pin.projectId, "runs", runId);

/** Automatic run first, then each editor session in order; the last is the pinned track. */
const chain: Script[] = [];
for (let id: string | null = pin.runs.ko; id !== null;) {
  const run: Script = readJsonFile(runFile(id), ScriptSchema);
  if (chain.some((r) => r.runId === run.runId)) throw new Error(`run ${id} is its own ancestor`);
  chain.unshift(run);
  id = run.parentRunId ?? null;
}

export const originalRun: Script = chain[0];
export const finalRun: Script = chain[chain.length - 1];
/** The editor sessions, oldest first: each run made from its parent by an editor's changes. */
export const sessions: Script[] = chain.slice(1);
if (originalRun.humanEdits?.length) throw new Error("the first run of the chain has human edits");
if (sessions.length === 0) throw new Error("the pinned track has no editor session");
for (const s of sessions)
  if (!s.humanEdits?.length) throw new Error(`editor session ${s.runId} records no edit`);

/** Every change an editor made to the track, in order, with the session it was made in. */
export const humanEdits: (HumanEditRecord & { runId: string })[] = sessions.flatMap((s) =>
  (s.humanEdits ?? []).map((e) => ({ ...e, runId: s.runId })),
);
