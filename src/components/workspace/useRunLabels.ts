"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n/client";
import { retryTransient, RunRequestError } from "@/lib/client/run-stream";
import type { RunListing } from "@/lib/store/projects";
import { noteFromScript, runLabel, type RunNote } from "./labels";

/**
 * Human labels for result versions. An edited result's label names the line the editor changed,
 * which only its script.json records, so those scripts are fetched once per edited run (retried
 * while the server is briefly busy; a label without its note still names the edit's depth).
 */
export function useRunLabels(
  projectId: string,
  runs: RunListing[],
): { labels: Map<string, string>; notes: Record<string, RunNote | null> } {
  const { t, lang } = useI18n();
  const [notes, setNotes] = useState<Record<string, RunNote | null>>({});
  const [localTime, setLocalTime] = useState(false);
  useEffect(() => setLocalTime(true), []);

  const missing = runs
    .filter((r) => r.summary?.parentRunId && !(r.runId in notes))
    .map((r) => r.runId);
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!missing.length) return;
    let cancelled = false;
    // One script that does not load leaves only its own label without a note.
    Promise.allSettled(
      missing.map((runId) =>
        retryTransient(async () => {
          const response = await fetch(
            `/api/projects/${projectId}/media/runs/${runId}/script.json`,
          );
          if (!response.ok)
            throw new RunRequestError(response.status, { error: `script.json for ${runId}` });
          return [runId, noteFromScript(await response.json())] as const;
        }),
      ),
    ).then((settled) => {
      const loaded = settled.flatMap((s) => {
        if (s.status === "fulfilled") return [s.value];
        console.error("Could not label an edited result", s.reason);
        return [];
      });
      if (!cancelled && loaded.length)
        setNotes((current) => ({ ...current, ...Object.fromEntries(loaded) }));
    });
    return () => {
      cancelled = true;
    };
    // `missing` is derived from runs and notes; its joined ids are the real dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, missingKey]);

  const labels = useMemo(
    () =>
      new Map(
        runs.map((r) => [
          r.runId,
          runLabel(r, runs, notes[r.runId] ?? undefined, t, lang, localTime, notes),
        ]),
      ),
    [runs, notes, t, lang, localTime],
  );
  return { labels, notes };
}
