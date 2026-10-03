import type { Density, Language } from "../pipeline/schemas";
import { readRunSnapshot } from "../store/projects";

/** Generate run ids start with their UTC start time (newRunId): 20260928t064307205-… */
const STAMP = /^(\d{8})t(\d{6})/;
/** Case-insensitive: a run's per-line voice files are L<n>.wav. */
const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * The name a downloaded result file is saved under, ASCII only and different for every run, so an
 * English and a Korean track, or two versions of one, never land on the same name:
 *   gapline-<project>-<language>-<density>-<version>-<file>
 * <version> is the run's start (20260928-064307) for a generated run, "edit-<6 hex>" for an edit.
 * Any other run id is used whole. The project id stands in for its title, which may not be ASCII.
 */
export function downloadName(
  projectId: string,
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
  const name = `gapline-${projectId}-${started.language}-${started.density}-${version}-${file}`;
  // It goes into a Content-Disposition header as is.
  if (!SAFE_NAME.test(name)) throw new Error(`Unsafe download name: ${name}`);
  return name;
}

/** downloadName for a run on disk, from its run_started event. */
export async function runDownloadName(
  projectId: string,
  runId: string,
  file: string,
): Promise<string> {
  const { events } = await readRunSnapshot(projectId, runId);
  const started = events.find((e) => e.type === "run_started");
  if (!started) throw new Error(`Run ${runId} has no run_started event`);
  return downloadName(projectId, runId, started, file);
}
