import { fill, type UiLang } from "@/i18n";
import type { Dictionary } from "@/i18n/en";
import type { Cue } from "@/lib/pipeline/schemas";
import type { RunListing } from "@/lib/store/projects";

/**
 * Lines are numbered by time for people (1, 2, 3 …). Cue ids (L1, L6 …) follow writing order, which
 * looks like a bug when shown on a time axis, so they stay internal.
 */
export function lineNumbers(cues: Cue[]): Map<string, number> {
  return new Map([...cues].sort((a, b) => a.start - b.start).map((c, i) => [c.id, i + 1]));
}

/** "Korean" / "한국어", for a language named inside a sentence. */
export function languageName(code: string, lang: UiLang): string {
  return new Intl.DisplayNames([lang], { type: "language" }).of(code) ?? code;
}

/** What an edited result changed, read from its script.json. */
export interface RunNote {
  line: number;
  kind: "changed" | "restored" | "removed";
}

interface EditedScript {
  cues: Cue[];
  humanEdits?: ({ cueId: string; after: string } | { cueId: string; action: "remove" })[];
}

/**
 * A line counts as restored when the version the editor replaced never made it into the track: it
 * failed review, was never voiced (a removal is never voiced), or was voiced longer than its room.
 * Lines keep their number after a removal, so "Line 1 removed" names the box the timeline still shows.
 */
export function noteFromScript(script: EditedScript): RunNote | null {
  const edit = script.humanEdits?.at(-1);
  if (!edit) return null;
  const cue = script.cues.find((c) => c.id === edit.cueId);
  if (!cue) throw new Error(`Edited line ${edit.cueId} is missing from its script`);
  const line = lineNumbers(script.cues).get(cue.id)!;
  if ("action" in edit) return { line, kind: "removed" };
  const index = cue.versions.findLastIndex((v) => v.by === "human" && v.text === edit.after);
  const replaced = cue.versions[index - 1];
  const room = cue.windowEnd - cue.start;
  const restored =
    !replaced ||
    (replaced.review !== undefined && !replaced.review.pass) ||
    !replaced.voice ||
    replaced.voice.seconds > room;
  return { line, kind: restored ? "restored" : "changed" };
}

/** Generated run ids start with their UTC start time (20260921t082401167-…); prefer it to file times. */
const RUN_ID_TIME = /^(\d{4})(\d{2})(\d{2})t(\d{2})(\d{2})(\d{2})/;

function startedAt(run: RunListing): string {
  const m = RUN_ID_TIME.exec(run.runId);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : run.createdAt;
}

/** Depth of an edited result: 1 for an edit of the original, 2 for an edit of that edit … */
function editDepth(run: RunListing, runs: RunListing[]): number {
  let depth = 0;
  let parent = run.summary?.parentRunId;
  while (parent) {
    depth++;
    parent = runs.find((r) => r.runId === parent)?.summary?.parentRunId;
  }
  return depth;
}

/**
 * "Original · 22 Sep" / "Edit 2 · Line 5 restored" / "Edit 3 · Line 1 removed". Dates use UTC until the component has mounted so
 * the server and the first client render agree, then the viewer's own time zone.
 */
export function runLabel(
  run: RunListing,
  runs: RunListing[],
  note: RunNote | undefined,
  t: Dictionary,
  lang: UiLang,
  localTime: boolean,
): string {
  const depth = editDepth(run, runs);
  if (depth > 0) {
    const head = fill(t.versions.edit, { n: depth });
    if (!note) return head;
    const line = fill(t.line.title, { n: note.line });
    return `${head} · ${fill(t.versions[note.kind], { line })}`;
  }
  const day = (iso: string, withTime: boolean) =>
    new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", {
      day: "numeric",
      month: "short",
      ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
      timeZone: localTime ? undefined : "UTC",
    }).format(new Date(iso));
  // Two originals from the same day need the time to tell them apart.
  const sameDay = runs.some(
    (r) =>
      r.runId !== run.runId &&
      !r.summary?.parentRunId &&
      r.language === run.language &&
      r.density === run.density &&
      day(startedAt(r), false) === day(startedAt(run), false),
  );
  return `${t.versions.original} · ${day(startedAt(run), sameDay)}`;
}

/**
 * The original run an edited result descends from (the run itself when it is an original). An
 * edit's summary measures only the edit, so "what a run costs" must be read from the original.
 */
export function originalRun(runs: RunListing[], runId: string | undefined): RunListing | undefined {
  return lineage(runs, runId).at(-1);
}

/** A result followed by the results it was edited from, back to the original run. */
export function lineage(runs: RunListing[], runId: string | undefined): RunListing[] {
  const chain: RunListing[] = [];
  let run = runs.find((r) => r.runId === runId);
  while (run) {
    chain.push(run);
    const parentId = run.summary?.parentRunId;
    run = parentId ? runs.find((r) => r.runId === parentId) : undefined;
  }
  return chain;
}
