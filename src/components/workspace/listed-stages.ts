import type { StageId } from "@/lib/pipeline/events";
import { STAGES, type RunView } from "@/lib/pipeline/reduce";

/**
 * The rows of the stage list. A live run lists every stage, since which ones it will go through is
 * not known yet. A finished run lists only the stages it went through, and a replay only those its
 * saved trace (`trace`, the whole run folded) goes through: older runs predate some stages (the
 * re-listen, the final check), and a row left at "Waiting" that vanishes at the end reads as a hang.
 * A run that stopped (failed or interrupted) lists the stages it reached: the rest will not run. So
 * does a run the page lost touch with: past the stage it lost, nothing is known.
 */
export function listedStages(view: RunView, trace: RunView | null): StageId[] {
  const over =
    view.summary !== null ||
    view.error !== null ||
    STAGES.some((stage) => view.stages[stage].state === "lost");
  const through = over ? view : trace;
  if (!through) return STAGES;
  return STAGES.filter((stage) => through.stages[stage].state !== "waiting");
}
