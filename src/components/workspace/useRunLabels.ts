"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { RunListing } from "@/lib/store/projects";
import { noteFromScript, runLabel, type RunNote } from "./labels";

/**
 * Human labels for result versions. An edited result's label names the line the editor changed,
 * which only its script.json records, so those scripts are fetched once per edited run.
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
    Promise.all(
      missing.map(async (runId) => {
        const response = await fetch(`/api/projects/${projectId}/media/runs/${runId}/script.json`);
        if (!response.ok) throw new Error(`script.json for ${runId}: HTTP ${response.status}`);
        return [runId, noteFromScript(await response.json())] as const;
      }),
    )
      .then((loaded) => {
        if (!cancelled) setNotes((current) => ({ ...current, ...Object.fromEntries(loaded) }));
      })
      .catch((e: unknown) => console.error("Could not label edited results", e));
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
          runLabel(r, runs, notes[r.runId] ?? undefined, t, lang, localTime),
        ]),
      ),
    [runs, notes, t, lang, localTime],
  );
  return { labels, notes };
}
