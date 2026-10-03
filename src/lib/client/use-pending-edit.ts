"use client";

import { useEffect, useRef } from "react";
import type { ActiveEdit, RunErrorCode, RunStatus } from "@/lib/api-contract";
import type { TimedRunEvent } from "@/lib/pipeline/events";
import type { RunListing } from "@/lib/store/projects";
import { fetchRun, fetchRunList, READ_RETRY_DELAYS_MS, RunRequestError } from "./run-stream";

/** How often an edit found after a reload is checked on; an edit takes 30 s to a few minutes. */
const EDIT_POLL_MS = 5_000;
/** Consecutive failed checks (about a minute) before the page stops checking. */
const MAX_EDIT_POLL_FAILURES = 12;

export interface PendingEditHandlers {
  /** The edit was saved: its result is in `runs` (or not listed yet, when `runs` lacks it). */
  onSaved: (edit: ActiveEdit, runs: RunListing[]) => void;
  /**
   * The edit ended without a result (`code`: its run_failed code), or the page could not learn how
   * it ended (`code` null: no answer, or the server no longer knows it).
   */
  onEnded: (edit: ActiveEdit, code: RunErrorCode | null) => void;
}

/** What follows a check on a pending edit's run: check again later, open its result, or stop. */
export type PendingEditStep =
  | { next: "check"; failures: number }
  | { next: "saved" }
  | { next: "ended"; code: RunErrorCode | null };

/**
 * The step after one check on a pending edit's run: its saved events and status, or the error the
 * read threw. `failures`: checks in a row that failed before this one. A run the server no longer
 * knows (404), or one that cannot be reached for about a minute, ends it with no code.
 */
export function pendingEditStep(
  answer: { events: TimedRunEvent[]; status: RunStatus } | { error: unknown },
  failures: number,
): PendingEditStep {
  if ("error" in answer) {
    const gone = answer.error instanceof RunRequestError && answer.error.status === 404;
    if (gone || failures + 1 >= MAX_EDIT_POLL_FAILURES) return { next: "ended", code: null };
    return { next: "check", failures: failures + 1 };
  }
  if (answer.status === "running") return { next: "check", failures: 0 };
  if (answer.status === "done") return { next: "saved" };
  const failed = answer.events.findLast((e) => e.type === "run_failed");
  return { next: "ended", code: failed?.code ?? null };
}

/**
 * Follows an edit this viewer started before the page was reloaded (GET runs → `edits`): the edit
 * request itself belonged to the page that left, so only its run says how it ends. Its run answers
 * `running` until the edit is saved (`done`) or fails (`failed`).
 */
export function usePendingEdit(
  projectId: string,
  edit: ActiveEdit | null,
  handlers: PendingEditHandlers,
) {
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => {
    if (!edit) return;
    let stopped = false;
    let timer: number | null = null;
    let failures = 0;
    const check = async () => {
      let step: PendingEditStep;
      try {
        step = pendingEditStep(await fetchRun(projectId, edit.runId), failures);
      } catch (error) {
        console.warn(`edit ${edit.runId}: check ${failures + 1} failed`, error);
        step = pendingEditStep({ error }, failures);
      }
      if (stopped) return;
      if (step.next === "check") {
        failures = step.failures;
        timer = window.setTimeout(check, EDIT_POLL_MS);
        return;
      }
      if (step.next === "ended") {
        latest.current.onEnded(edit, step.code);
        return;
      }
      try {
        const list = await fetchRunList(projectId, READ_RETRY_DELAYS_MS);
        if (!stopped) latest.current.onSaved(edit, list.runs);
      } catch (error) {
        // The edit is saved; showSaved reads the list again before it says it cannot open it.
        console.warn(`edit ${edit.runId}: saved, but the run list did not load`, error);
        if (!stopped) latest.current.onSaved(edit, []);
      }
    };
    void check();
    return () => {
      stopped = true;
      if (timer !== null) window.clearTimeout(timer);
    };
    // One follow per edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, edit?.runId]);
}
