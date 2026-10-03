import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { readCallRecords, summarizeCosts } from "../llm/ledger";
import { trimSilence } from "../media/narration-track";
import { parseWav } from "../media/wav";
import type { TimedRunEvent } from "../pipeline/events";
import { sameWords } from "../pipeline/cues";
import type { Cue, Gap, Language } from "../pipeline/schemas";
import { synthesizeLine } from "../pipeline/voice";
import { updateJson } from "../store/atomic";
import { canSeeRun, readProject, RUN_EDITOR_FILE, runDir, type RunEditor } from "../store/projects";
import {
  newRunBudget,
  reserveRun,
  runChargeBound,
  settleRun,
  withRunBudget,
  type BudgetScope,
} from "./budget";
import { writeEditedRun, type EditBase, type HumanEdit } from "./edit-track";

const CUE_ID = z.string().regex(/^L\d+$/);
const REQUEST_ID = z.string().regex(/^[a-zA-Z0-9-]{8,64}$/);
/** New words (or a new start) for one line: reviewed, re-voiced, and mixed in its place. */
export const TextEditSchema = z
  .object({
    cueId: CUE_ID,
    text: z.string().trim().min(1).max(2000),
    start: z.number().nonnegative(),
    requestId: REQUEST_ID,
  })
  .strict();
/** Takes one line out of the track; every other line keeps its audio. */
export const RemoveEditSchema = z
  .object({ cueId: CUE_ID, action: z.literal("remove"), requestId: REQUEST_ID })
  .strict();
export const EditSchema = z.union([TextEditSchema, RemoveEditSchema]);
export type EditInput = z.infer<typeof EditSchema>;
type TextEdit = z.infer<typeof TextEditSchema>;

export class EditError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
interface RequestState {
  fingerprint: string;
  state: "new" | "running" | "done" | "failed";
  runId?: string;
  error?: string;
}

/** A line an editor can change: in the track, dropped by the pipeline, or removed by an editor. */
const EDITABLE: Cue["status"][] = ["fits", "dropped", "removed"];

/** Placement bounds are derived from real audio ends, never from estimated word counts. */
export function editBounds(cues: Cue[], gaps: Gap[], cueId: string): { min: number; max: number } {
  const cue = cues.find((c) => c.id === cueId && EDITABLE.includes(c.status));
  if (!cue) throw new EditError("cue_unavailable", "Only a finished line can be edited.");
  const gap = gaps.find((g) => g.id === cue.gapId);
  if (!gap) throw new EditError("invalid_gap", "The original line has no valid gap.");
  const ordered = cues
    .filter((c) => (c.status === "fits" || c.id === cueId) && c.gapId === gap.id)
    .sort((a, b) => a.start - b.start);
  const index = ordered.findIndex((c) => c.id === cueId);
  const previous = ordered[index - 1];
  const next = ordered[index + 1];
  return {
    min: Math.max(
      gap.start,
      previous ? previous.start + (previous.seconds ?? Infinity) : gap.start,
    ),
    max: Math.min(gap.end, next?.start ?? gap.end),
  };
}

/** A text edit must land in its line's gap, clear of its neighbours, and change something. */
function checkTextEdit(
  base: EditBase,
  cue: Cue,
  input: TextEdit,
  placement: (bounds: { min: number; max: number }) => string,
): void {
  const bounds = editBounds(base.cues, base.gaps, input.cueId);
  if (input.start < bounds.min || input.start >= bounds.max)
    throw new EditError("placement", placement(bounds));
  // Putting a removed line back with its own words is a change; for any other line it is not.
  if (
    cue.status !== "removed" &&
    sameWords(cue.versions.at(-1)!.text, input.text) &&
    cue.start === input.start
  )
    throw new EditError("unchanged", "Change the words or start time before submitting.");
}

/**
 * Reads every shipped line's exact WAV bytes and sets its measured length. Results from before
 * per-line audio cannot be re-mixed one line at a time.
 */
async function readLineAudio(baseDir: string, cues: Cue[]): Promise<Map<string, Buffer>> {
  const audio = new Map<string, Buffer>();
  for (const c of cues.filter((c) => c.status === "fits")) {
    if (c.audioFile !== `voice/${c.id}.wav`)
      throw new EditError(
        "legacy",
        "Generate a new result before editing: this run has no per-line audio.",
      );
    let bytes: Buffer;
    let info: ReturnType<typeof parseWav>;
    try {
      bytes = await readFile(join(baseDir, c.audioFile));
      info = parseWav(bytes);
    } catch {
      throw new EditError(
        "legacy",
        "Generate a new result before editing: per-line audio is missing.",
      );
    }
    if (info.channels !== 1 || info.bitsPerSample !== 16)
      throw new EditError("legacy", "Generate a new result with mono per-line audio.");
    audio.set(c.id, bytes);
    c.seconds = info.seconds;
  }
  return audio;
}

/** Puts the editor's words on the line and voices them once; they are never shortened for them. */
async function reviseLine(
  cues: Cue[],
  gaps: Gap[],
  input: TextEdit,
  language: Language,
  ledgerFile: string,
) {
  const bounds = editBounds(cues, gaps, input.cueId);
  const edited = cues.find((c) => c.id === input.cueId)!;
  edited.status = "fits";
  delete edited.droppedReason;
  edited.audioFile = `voice/${edited.id}.wav`;
  edited.start = input.start;
  edited.windowEnd = bounds.max;
  edited.versions.push({ text: input.text, start: input.start, by: "human", model: "human" });
  const voiced = await synthesizeLine({
    text: input.text,
    language,
    speakingRate: 1,
    ledgerFile,
    label: "voice:edit",
  });
  const line = trimSilence(voiced.wav);
  if (line.seconds > bounds.max - input.start)
    throw new EditError(
      "too_long",
      `The edited voice takes ${line.seconds.toFixed(2)} seconds; only ${(bounds.max - input.start).toFixed(2)} are available. Shorten it or move it earlier.`,
    );
  edited.seconds = line.seconds;
  edited.rate = 1;
  edited.versions.at(-1)!.voice = { seconds: line.seconds, rate: 1 };
  return { edited, line };
}

/**
 * Takes the line out of the track. Its history stays; a "remove" version records the words that
 * were taken out, and the line no longer has audio of its own in this result.
 */
function removeLine(cues: Cue[], cueId: string): void {
  const removed = cues.find((c) => c.id === cueId)!;
  removed.versions.push({
    text: removed.versions.at(-1)!.text,
    start: removed.start,
    by: "remove",
    model: "human",
  });
  removed.status = "removed";
  delete removed.audioFile;
  delete removed.seconds;
  delete removed.rate;
}

export async function editRun(
  projectId: string,
  baseRunId: string,
  raw: EditInput,
  owner: string,
  scope?: BudgetScope,
): Promise<{ runId: string }> {
  const input = EditSchema.parse(raw);
  const project = await readProject(projectId);
  // Another viewer's version of the sample is not there for this one, exactly like a missing run.
  const notFound = () => new EditError("not_found", "Original run not found.", 404);
  if (!(await canSeeRun(project, baseRunId, owner))) throw notFound();
  const baseDir = runDir(projectId, baseRunId);
  let base: EditBase;
  let first: Extract<TimedRunEvent, { type: "run_started" }>;
  try {
    base = JSON.parse(await readFile(join(baseDir, "script.json"), "utf8"));
    first = JSON.parse((await readFile(join(baseDir, "events.jsonl"), "utf8")).split("\n")[0]);
  } catch {
    throw notFound();
  }
  if (first.type !== "run_started")
    throw new EditError("legacy", "Generate a new result before editing this older run.");
  const cue = base.cues.find((c) => c.id === input.cueId);
  if (!cue) throw new EditError("cue_unavailable", "Only a finished line can be edited.");
  if (!("action" in input))
    checkTextEdit(
      base,
      cue,
      input,
      (b) =>
        `Start must stay between ${b.min.toFixed(3)} and ${b.max.toFixed(3)} seconds, in the same gap and order.`,
    );
  else if (cue.status !== "fits")
    throw new EditError("cue_unavailable", "Only a line in the track can be removed.");
  const audio = await readLineAudio(baseDir, base.cues);
  // Stored lengths can predate trimming; the measured WAV lengths decide the neighbours' room.
  if (!("action" in input))
    checkTextEdit(
      base,
      cue,
      input,
      () => "The start overlaps a neighboring line's measured audio.",
    );
  const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const requestKey = createHash("sha256")
    .update(`${owner}:${baseRunId}:${input.requestId}`)
    .digest("hex");
  const key = `projects/${projectId}/edits/${requestKey}.json`;
  const claim = await updateJson<RequestState, RequestState>(
    key,
    () => ({ fingerprint, state: "new" }),
    (state) => {
      if (state.fingerprint !== fingerprint)
        throw new EditError(
          "request_conflict",
          "requestId was already used with a different edit.",
          409,
        );
      const previous = { ...state };
      if (state.state === "new") state.state = "running";
      return previous;
    },
  );
  if (claim.state === "done") return { runId: claim.runId! };
  if (claim.state !== "new")
    throw new EditError(
      claim.state,
      claim.error ?? "This edit is already processing. Keep the original result open.",
      409,
    );
  const runId = `edit-${requestKey.slice(0, 40)}`;
  const dir = runDir(projectId, runId);
  const ledgerFile = join(dir, "ledger.jsonl");
  let reservation: Awaited<ReturnType<typeof reserveRun>> | undefined;
  let budget: ReturnType<typeof newRunBudget> | undefined;
  try {
    reservation = await reserveRun(scope);
    budget = newRunBudget(reservation);
    await withRunBudget(
      reservation,
      async () => {
        const started = Date.now();
        await mkdir(join(dir, "voice"), { recursive: true });
        // Before any result file: on the sample, the edit belongs to its editor from the start.
        const editor: RunEditor = { ownerHash: owner };
        await writeFile(join(dir, RUN_EDITOR_FILE), JSON.stringify(editor));
        const cues = structuredClone(base.cues);
        const at = new Date().toISOString();
        const run = { projectId, project, base, baseRunId, first, runId, dir, ledgerFile, started };
        if ("action" in input) {
          removeLine(cues, input.cueId);
          const humanEdit: HumanEdit = {
            cueId: input.cueId,
            action: "remove",
            before: cue.versions.at(-1)!.text,
            from: cue.start,
            at,
          };
          // Nothing to accept: the words that stay were already in the track. The audit is recorded.
          await writeEditedRun({ ...run, cues, audio, humanEdit }, () => {});
          return;
        }
        const { edited, line } = await reviseLine(
          cues,
          base.gaps,
          input,
          first.language,
          ledgerFile,
        );
        const humanEdit: HumanEdit = {
          cueId: input.cueId,
          before: cue.versions.at(-1)!.text,
          after: input.text,
          from: cue.start,
          to: input.start,
          at,
        };
        await writeEditedRun(
          { ...run, cues, audio, revoiced: { cueId: edited.id, line }, humanEdit },
          (finalReview) => {
            const verdict = finalReview.verdicts.find((v) => v.cueId === edited.id)!;
            if (!verdict.pass)
              throw new EditError(
                "review",
                verdict.violations.map((v) => v.reason).join(" ") + " " + verdict.fix,
              );
            edited.versions.at(-1)!.review = verdict;
          },
        );
      },
      budget,
    );
    await updateJson<RequestState, void>(
      key,
      () => claim,
      (state) => {
        state.state = "done";
        state.runId = runId;
      },
    );
    return { runId };
  } catch (error) {
    await updateJson<RequestState, void>(
      key,
      () => claim,
      (state) => {
        state.state = "failed";
        state.error = error instanceof Error ? error.message : String(error);
      },
    );
    throw error;
  } finally {
    if (reservation) {
      const cost = await readCallRecords(ledgerFile).then(summarizeCosts, () => null);
      await settleRun(
        reservation,
        cost?.costStatus === "known" ? cost.costUsd : runChargeBound(budget!),
      );
    }
  }
}
