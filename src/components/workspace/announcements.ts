import { fill, type UiLang } from "@/i18n";
import type { Dictionary } from "@/i18n/en";
import { STAGES, type RunView } from "@/lib/pipeline/reduce";

/**
 * What the page's polite live region says about a live run's stages, as where the run is now, or
 * null when there is nothing new to say. Stages working at once are named together. `settle`: say
 * it only once updates stop for a moment (useAnnouncer), so a burst of stage changes is said once;
 * where a run stops is said at once. Its end is said with its result (runFinishedAnnouncement).
 */
export function stageAnnouncement(
  view: RunView,
  t: Dictionary,
  lang: UiLang,
): { text: string; settle: boolean } | null {
  // Checking again on a lost run: nothing new is known until a check answers.
  if (STAGES.some((s) => view.stages[s].state === "lost")) return null;
  const stopped = STAGES.find((s) => view.stages[s].state === "stopped");
  if (stopped) {
    return {
      text: fill(t.workspace.stageAnnounce, {
        stage: t.stages[stopped],
        state: t.stages.stoppedState,
      }),
      settle: false,
    };
  }
  if (view.error || view.summary) return null;
  const running = STAGES.filter((s) => view.stages[s].state === "running");
  const last = [...STAGES].reverse().find((s) => view.stages[s].state === "done");
  if (running.length) {
    const names = new Intl.ListFormat(lang, { type: "conjunction" });
    return {
      text: fill(t.workspace.stageAnnounce, {
        stage: names.format(running.map((s) => t.stages[s])),
        state: t.stages.runningState,
      }),
      settle: true,
    };
  }
  if (!last) return null;
  return {
    text: fill(t.workspace.stageAnnounce, { stage: t.stages[last], state: t.stages.doneState }),
    settle: true,
  };
}

/** One sentence for a run that finished on this page: how many lines its film carries. */
export function runFinishedAnnouncement(finished: RunView, t: Dictionary): string {
  const shipped = finished.summary?.cuesShipped ?? 0;
  return shipped === 0
    ? t.workspace.runFinishedEmpty
    : fill(t.workspace.runFinished, {
        lines: fill(t.editor.lines[shipped === 1 ? "one" : "other"], { n: shipped }),
      });
}

/**
 * The text to put in a live region so that saying the same words again is still said: a region
 * whose text does not change says nothing, so a repeat gets a trailing no-break space, which
 * screen readers do not speak.
 */
export function restated(previous: string, text: string): string {
  return previous === text ? `${text}\u00a0` : text;
}
