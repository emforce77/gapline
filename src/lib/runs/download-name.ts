import type { Density, Language } from "../pipeline/schemas";
import { readRunSnapshot } from "../store/projects";

/** Generate run ids start with their UTC start time (newRunId): 20260928t064307205-… */
const STAMP = /^(\d{8})t(\d{6})/;
/** Case-insensitive: a run's per-line voice files are L<n>.wav. */
const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

/** Letters of a title kept in a download name; long enough to tell clips apart. */
const MAX_TITLE_SLUG = 40;

/**
 * The clip's title as ASCII for a file name: accents dropped (Café → cafe), every other run of
 * characters a single hyphen. Empty when no ASCII letter is left, as in an all-Korean title: the
 * digits of "영상 2" or "회의_2026" alone would not tell clips apart.
 */
export function titleSlug(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_TITLE_SLUG)
    .replace(/-+$/, "");
  return /[a-z]/.test(slug) ? slug : "";
}

/**
 * The name a downloaded result file is saved under, ASCII only and different for every run, so an
 * English and a Korean track, or two versions of one, never land on the same name:
 *   gapline-<clip>-<language>-<density>-<version>-<file>
 * <clip> is the title's ASCII slug (titleSlug), or the project id when it has no ASCII letter.
 * <version> is the run's start (20260928-064307) for a generated run, "edit-<6 hex>" for an edit.
 * Any other run id is used whole.
 */
export function downloadName(
  project: { id: string; title: string },
  runId: string,
  started: { language: Language; density: Density },
  file: string,
): string {
  const stamp = STAMP.exec(runId);
  const version = runId.startsWith("edit-")
    ? runId.slice(0, "edit-".length + 6)
    : stamp
      ? `${stamp[1]}-${stamp[2]}`
      : runId;
  const clip = titleSlug(project.title) || project.id;
  const name = `gapline-${clip}-${started.language}-${started.density}-${version}-${file}`;
  // It goes into a Content-Disposition header as is.
  if (!SAFE_NAME.test(name)) throw new Error(`Unsafe download name: ${name}`);
  return name;
}

/** downloadName for a run on disk, from its run_started event. */
export async function runDownloadName(
  project: { id: string; title: string },
  runId: string,
  file: string,
): Promise<string> {
  const { events } = await readRunSnapshot(project.id, runId);
  const started = events.find((e) => e.type === "run_started");
  if (!started) throw new Error(`Run ${runId} has no run_started event`);
  return downloadName(project, runId, started, file);
}
