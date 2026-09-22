import { mkdir, readdir, readFile, writeFile, copyFile, access, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { RunSummary } from "../pipeline/events";
import type { SceneMap, SpeechSegment } from "../pipeline/schemas";

/**
 * Everything lives under DATA_DIR: ./runtime locally, a Cloud Storage bucket mounted as a volume on
 * Cloud Run. Layout:
 *   projects/<id>/project.json   metadata
 *   projects/<id>/clip.mp4       the analysed clip (H.264/AAC)
 *   projects/<id>/strip.jpg      one thumbnail per second, for the timeline
 *   projects/<id>/analysis-{speech,scene}.json  separately validated keyed components
 *   projects/<id>/analysis.json  combined analysis for display and legacy results
 *   projects/<id>/runs/<runId>/  events, ledger, script and media of one run
 */
export function dataDir(): string {
  return resolve(process.env.DATA_DIR || "runtime");
}

export const ProjectSchema = z.object({
  id: z.string(),
  title: z.string(),
  kind: z.enum(["sample", "upload"]),
  clipSeconds: z.number(),
  filmLanguageCode: z.string(),
  attribution: z.string(),
  license: z.string(),
  createdAt: z.string(),
  ownerHash: z.string().optional(),
  /** Seconds covered by each thumbnail in strip.jpg. */
  stripStepSeconds: z.number(),
});
export type Project = z.infer<typeof ProjectSchema>;

export interface RunListing {
  runId: string;
  language: string;
  density: string;
  summary: RunSummary | null;
  createdAt: string;
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;

/** Project and run ids come from URLs; only this shape is ever joined into a path. */
export function assertSafeId(id: string): string {
  if (!ID_PATTERN.test(id)) throw new Error(`Invalid id: ${id}`);
  return id;
}

export function projectDir(id: string): string {
  return join(dataDir(), "projects", assertSafeId(id));
}

export function runDir(projectId: string, runId: string): string {
  return join(projectDir(projectId), "runs", assertSafeId(runId));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function readProject(id: string): Promise<Project> {
  const raw = await readFile(join(projectDir(id), "project.json"), "utf8");
  return ProjectSchema.parse(JSON.parse(raw));
}

export async function writeProject(project: Project): Promise<void> {
  await mkdir(projectDir(project.id), { recursive: true });
  await writeFile(join(projectDir(project.id), "project.json"), JSON.stringify(project, null, 2));
}

export async function listProjects(): Promise<Project[]> {
  const root = join(dataDir(), "projects");
  if (!(await exists(root))) return [];
  const ids = await readdir(root);
  const projects: Project[] = [];
  for (const id of ids) {
    if (!ID_PATTERN.test(id) || !(await exists(join(root, id, "project.json")))) continue;
    projects.push(await readProject(id));
  }
  return projects.sort((a, b) =>
    a.kind === b.kind ? b.createdAt.localeCompare(a.createdAt) : a.kind === "sample" ? -1 : 1,
  );
}

export async function readAnalysis(
  id: string,
): Promise<{ speech: SpeechSegment[]; scene: SceneMap } | null> {
  const file = join(projectDir(id), "analysis.json");
  if (!(await exists(file))) return null;
  return JSON.parse(await readFile(file, "utf8"));
}

export async function writeAnalysis(
  id: string,
  analysis: { speech: SpeechSegment[]; scene: SceneMap },
): Promise<void> {
  await writeFile(join(projectDir(id), "analysis.json"), JSON.stringify(analysis, null, 2));
}

/** Finished runs, newest first. A run without script.json failed or is still running. */
export async function listRuns(projectId: string): Promise<RunListing[]> {
  const root = join(projectDir(projectId), "runs");
  if (!(await exists(root))) return [];
  const listings: RunListing[] = [];
  for (const runId of await readdir(root)) {
    if (!ID_PATTERN.test(runId)) continue;
    const script = join(root, runId, "script.json");
    if (!(await exists(script))) continue;
    const parsed = JSON.parse(await readFile(script, "utf8"));
    const started = JSON.parse(
      (await readFile(join(root, runId, "events.jsonl"), "utf8")).split("\n")[0],
    );
    listings.push({
      runId,
      language: started.language,
      density: started.density,
      summary: parsed.summary ?? null,
      createdAt: (await stat(script)).mtime.toISOString(),
    });
  }
  return listings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function importFile(source: string, projectId: string, name: string): Promise<void> {
  await copyFile(source, join(projectDir(projectId), name));
}
