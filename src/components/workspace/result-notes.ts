import type { RunSummary } from "@/lib/pipeline/events";
import { assessRoom } from "@/lib/pipeline/gaps";
import type { Cue, Gap, Verdict } from "@/lib/pipeline/schemas";

/**
 * How much of the clip a finished result describes: no line at all, little (the clip leaves too
 * little room to speak, by the same rule as the little-room notice), or enough.
 */
export type ResultCoverage = "none" | "little" | "enough";

/**
 * Why a result has no line: no silence to speak in, none written, every voiced line removed by an
 * editor, or every line dropped by Gapline.
 */
export type NoLinesReason = "no_room" | "unwritten" | "removed" | "dropped";

export interface FinalCheckLine {
  verdict: Verdict;
  cue: Cue;
}

export interface ResultReading {
  coverage: ResultCoverage;
  /** Set only when coverage is "none". */
  noLines: NoLinesReason | null;
  /** Lines the final check still fails that are heard in the track. */
  flagged: FinalCheckLine[];
  /** Lines the final check failed that Gapline then took out of the track instead of fixing. */
  takenOut: FinalCheckLine[];
  /** Lines Gapline wrote but dropped before the final check (too long, or still breaking a rule). */
  unvoiced: Cue[];
  /** Something to note: a missing moment, a flagged, taken-out or unvoiced line. */
  notes: boolean;
}

/**
 * Reads a finished result for the panel under the player. Built from what every saved result has,
 * so older results read right without being made again. The final check's verdicts are split by
 * what became of their line: a verdict on a line that is no longer heard is not a flag on the track.
 * Lines dropped before the check are noted too, so a roomy clip that voiced 1 of 8 lines does not
 * read as a clean pass.
 */
export function readResult(summary: RunSummary, cues: Cue[], gaps: Gap[]): ResultReading {
  const byId = new Map(cues.map((c) => [c.id, c]));
  const failing = (summary.finalReview?.verdicts ?? [])
    .filter((v) => !v.pass)
    .flatMap((verdict) => {
      const cue = byId.get(verdict.cueId);
      return cue ? [{ verdict, cue }] : [];
    });
  const flagged = failing.filter((f) => f.cue.status === "fits");
  const takenOut = failing.filter((f) => f.cue.status === "dropped");
  const unvoiced = cues.filter(
    (c) => c.status === "dropped" && !takenOut.some((f) => f.cue.id === c.id),
  );
  const coverage: ResultCoverage =
    summary.cuesShipped === 0
      ? "none"
      : assessRoom(gaps, summary.clipSeconds).little
        ? "little"
        : "enough";
  return {
    coverage,
    noLines: coverage === "none" ? noLinesReason(summary, cues) : null,
    flagged,
    takenOut,
    unvoiced,
    notes:
      Boolean(summary.finalReview?.missing.length) ||
      flagged.length > 0 ||
      takenOut.length > 0 ||
      unvoiced.length > 0,
  };
}

function noLinesReason(summary: RunSummary, cues: Cue[]): NoLinesReason {
  if (summary.gapCount === 0) return "no_room";
  if (cues.length === 0) return "unwritten";
  // Only a voiced line can be removed (edit-run.ts), so with none voiced, any removed line means an
  // editor took out every line that was being spoken; the rest were dropped before.
  if (cues.some((c) => c.status === "removed")) return "removed";
  return "dropped";
}
