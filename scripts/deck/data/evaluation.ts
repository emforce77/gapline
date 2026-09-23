/**
 * Ten runs over six openly licensed clips with two reviewer settings (22 Sep 2026), read from
 * runtime/evaluation/summary.json. The honesty slide draws this grid as recorded.
 */
import { join } from "node:path";
import { EVAL_CASES, EVAL_SUMMARY, REPO } from "../paths";
import {
  EvalCasesSchema,
  EvalSummarySchema,
  readJsonFile,
  ScriptSchema,
  type EvalRunRecord,
} from "./schema";

/** Clip names as docs/EVALUATION.md writes them. */
const CLIP_NAMES: Record<string, string> = {
  "tos-opening": "Tears of Steel, opening",
  "eval-tos-city": "Tears of Steel, city",
  "eval-tos-team": "Tears of Steel, lab (held out)",
  "eval-ko-intro": "Korean interview",
  "eval-ko-holdout": "Korean interview, later part (held out)",
  "eval-signal": "Synthetic squares and beeps",
};
export const SETTINGS = ["high", "medium"] as const;
export type Setting = (typeof SETTINGS)[number];

const summary = readJsonFile(EVAL_SUMMARY, EvalSummarySchema);
const cases = readJsonFile(EVAL_CASES, EvalCasesSchema);

export type CellKind = "review_needed" | "checked" | "stopped" | "not_run";
export interface Cell {
  kind: CellKind;
  listed: number;
  /** Fixed essential facts the finished track missed; null when not scored. */
  missedFacts: number | null;
}

function cellOf(run: EvalRunRecord | undefined): Cell {
  if (!run) return { kind: "not_run", listed: 0, missedFacts: null };
  if (run.status === "failed") {
    if (!run.error?.includes("end must follow start"))
      throw new Error(`unexpected failure in ${run.runId}`);
    return { kind: "stopped", listed: 0, missedFacts: null };
  }
  const listed = run.modelMissing?.length;
  if (listed === undefined) throw new Error(`${run.runId} has no missing list`);
  if (run.modelQuality === "review_needed")
    return { kind: "review_needed", listed, missedFacts: run.observedEssentialOmissions };
  if (run.modelQuality === "model_checked")
    return { kind: "checked", listed, missedFacts: run.observedEssentialOmissions };
  throw new Error(`unknown quality ${run.modelQuality} in ${run.runId}`);
}

export const evaluationGrid = cases.map((c) => {
  const name = CLIP_NAMES[c.id];
  if (!name) throw new Error(`no display name for clip ${c.id}`);
  const runs = summary.runs.filter((r) => r.projectId === c.id);
  return {
    id: c.id,
    name,
    language: c.language,
    seconds: c.seconds,
    /** Essential facts written down before the runs (0 = not scored). */
    facts: c.facts.length,
    cells: Object.fromEntries(
      SETTINGS.map((s) => [s, cellOf(runs.find((r) => r.setting === s))]),
    ) as Record<Setting, Cell>,
  };
});

const all = evaluationGrid.flatMap((row) =>
  SETTINGS.map((s) => ({ setting: s, cell: row.cells[s] })),
);
const count = (setting: Setting, kind: CellKind) =>
  all.filter((x) => x.setting === setting && x.cell.kind === kind).length;
const finished = (setting: Setting) => count(setting, "review_needed") + count(setting, "checked");

export const evaluationFacts = {
  runs: summary.runs.length,
  clips: cases.length,
  defaultFinished: finished("high"),
  defaultFlagged: count("high", "review_needed"),
  checkedButMissed: evaluationGrid.filter(
    (row) => row.cells.medium.kind === "checked" && (row.cells.medium.missedFacts ?? 0) > 0,
  ),
};
if (evaluationFacts.defaultFlagged !== evaluationFacts.defaultFinished)
  throw new Error("a default run was not flagged");
if (evaluationFacts.checkedButMissed.length !== 1)
  throw new Error("expected one 'checked' run with missed facts");

/** Usable silence Scene found in a clip, read from the default reviewer's run of it. */
export function defaultRunRoom(projectId: string): number {
  const run = summary.runs.find((r) => r.projectId === projectId && r.setting === "high");
  if (!run) throw new Error(`no default-reviewer run for ${projectId}`);
  const script = readJsonFile(
    join(REPO, "runtime/projects", projectId, "runs", run.runId, "script.json"),
    ScriptSchema,
  );
  return script.summary.gapSeconds;
}
