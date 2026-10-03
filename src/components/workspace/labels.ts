import { fill, type UiLang } from "@/i18n";
import type { Dictionary } from "@/i18n/en";
import { formatDuration, formatUsd } from "@/lib/format";
import type { RunSummary } from "@/lib/pipeline/events";
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

/** What an edited result changed, read from its script.json; `at` is when the edit was saved. */
export interface RunNote {
  line: number;
  kind: "changed" | "moved" | "restored" | "removed";
  at?: string;
}

/**
 * script.json's humanEdits, as edit-run.ts records them (HumanEdit in src/lib/runs/edit-track.ts).
 * Only cueId and the new words are required, so a minimal record still yields a label.
 */
interface EditedScript {
  cues: Cue[];
  humanEdits?: (
    | { cueId: string; after: string; before?: string; from?: number; to?: number; at?: string }
    | { cueId: string; action: "remove"; at?: string }
  )[];
}

/**
 * A line counts as restored when the version the editor replaced never made it into the track: it
 * failed review, was never voiced (a removal is never voiced), or was voiced longer than its room.
 * A line that keeps its words and only starts elsewhere was moved, not rewritten (the edit route
 * compares words the same way: trimmed). Lines keep their number after a removal, so "Line 1
 * removed" names the box the timeline still shows.
 */
export function noteFromScript(script: EditedScript): RunNote | null {
  const edit = script.humanEdits?.at(-1);
  if (!edit) return null;
  const cue = script.cues.find((c) => c.id === edit.cueId);
  if (!cue) throw new Error(`Edited line ${edit.cueId} is missing from its script`);
  const line = lineNumbers(script.cues).get(cue.id)!;
  const at = edit.at === undefined ? {} : { at: edit.at };
  if ("action" in edit) return { line, kind: "removed", ...at };
  const index = cue.versions.findLastIndex((v) => v.by === "human" && v.text === edit.after);
  const replaced = cue.versions[index - 1];
  const room = cue.windowEnd - cue.start;
  const restored =
    !replaced ||
    (replaced.review !== undefined && !replaced.review.pass) ||
    !replaced.voice ||
    replaced.voice.seconds > room;
  if (restored) return { line, kind: "restored", ...at };
  const moved =
    edit.before !== undefined &&
    edit.before.trim() === edit.after.trim() &&
    edit.from !== undefined &&
    edit.from !== edit.to;
  return { line, kind: moved ? "moved" : "changed", ...at };
}

/** Generated run ids start with their UTC start time (20260921t082401167-…); prefer it to file times. */
const RUN_ID_TIME = /^(\d{4})(\d{2})(\d{2})t(\d{2})(\d{2})(\d{2})/;

/**
 * When a run started: read from a generated run's id, since file times can all be the same after a
 * bucket copy; an edit's id has no time, so its listing's file time.
 */
export function startedAt(run: RunListing): string {
  const m = RUN_ID_TIME.exec(run.runId);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : run.createdAt;
}

/**
 * Results newest first, each original followed by the results edited from it, so the version list
 * reads the same however the files were copied: an edit of an edit is newer than what it was made
 * from, so deeper edits come first, and edits at one depth go by their file time.
 */
export function orderRuns(runs: RunListing[]): RunListing[] {
  const newestFirst = (a: RunListing, b: RunListing) => startedAt(b).localeCompare(startedAt(a));
  const deeperFirst = (a: RunListing, b: RunListing) =>
    editDepth(b, runs) - editDepth(a, runs) || newestFirst(a, b);
  const families = new Map<string, RunListing[]>();
  for (const run of runs) {
    const root = lineage(runs, run.runId).at(-1)!.runId;
    families.set(root, [...(families.get(root) ?? []), run]);
  }
  return [...families.entries()]
    .map(([root, family]) => ({ head: family.find((r) => r.runId === root), family }))
    .sort((a, b) => newestFirst(a.head ?? a.family[0], b.head ?? b.family[0]))
    .flatMap(({ head, family }) => [
      ...(head ? [head] : []),
      ...family.filter((r) => r !== head).sort(deeperFirst),
    ]);
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
 * "Generated · 22 Sep" / "Edit 2 · Line 5 restored" / "Edit 3 · Line 1 removed". Two versions that
 * would read the same also get their time: originals from one day, or edits at one depth that
 * changed the same line the same way (`notes` holds every edited run's note). Dates use UTC until
 * the component has mounted so the server and the first client render agree, then the viewer's
 * own time zone. A time of day waits for the mount too: its wording comes from the runtime's locale
 * data (Node's ICU wrote "AM 2:44" in Korean where browsers write "오전 2:44").
 */
export function runLabel(
  run: RunListing,
  runs: RunListing[],
  note: RunNote | undefined,
  t: Dictionary,
  lang: UiLang,
  localTime: boolean,
  notes: Record<string, RunNote | null> = {},
): string {
  const day = (iso: string, withTime: boolean) =>
    new Intl.DateTimeFormat(lang === "ko" ? "ko-KR" : "en-US", {
      day: "numeric",
      month: "short",
      ...(withTime && localTime ? { hour: "numeric", minute: "2-digit" } : {}),
      timeZone: localTime ? undefined : "UTC",
    }).format(new Date(iso));
  const peer = (r: RunListing) =>
    r.runId !== run.runId && r.language === run.language && r.density === run.density;
  const depth = editDepth(run, runs);
  if (depth > 0) {
    const head = fill(t.versions.edit, { n: depth });
    if (!note) return head;
    const line = fill(t.line.title, { n: note.line });
    const label = `${head} · ${fill(t.versions[note.kind], { line })}`;
    const twin = runs.some(
      (r) =>
        peer(r) &&
        editDepth(r, runs) === depth &&
        notes[r.runId]?.line === note.line &&
        notes[r.runId]?.kind === note.kind,
    );
    return twin && note.at ? `${label} · ${day(note.at, true)}` : label;
  }
  // Two originals from the same day need the time to tell them apart.
  const sameDay = runs.some(
    (r) =>
      peer(r) && !r.summary?.parentRunId && day(startedAt(r), false) === day(startedAt(run), false),
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

/**
 * The figures of every "generating the 65-second sample took … and cost …" line (upload card,
 * fresh-upload workspace). Both quote one run, the original automatic run behind the pinned Korean
 * result the story follows, and name its narration language so the figures are not read as the
 * viewer's language.
 */
export function sampleRunFigures(
  language: string,
  summary: RunSummary,
  lang: UiLang,
): { language: string; time: string; cost: string } {
  return {
    language: languageName(language, lang),
    time: formatDuration(summary.wallSeconds, lang),
    cost: formatUsd(summary.costUsd, lang),
  };
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
