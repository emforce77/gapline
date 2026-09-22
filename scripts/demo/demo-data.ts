import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunSummary } from "../../src/lib/pipeline/events";
import type { Cue, Density, Language } from "../../src/lib/pipeline/schemas";
export const SERVICE_URL =
  process.env.DEMO_SERVICE_URL || "https://scene-ad-958994530029.asia-northeast3.run.app";
export const PROJECT_ID = "tos-opening";
export const DEMO_DIR = join(process.cwd(), "runtime", "demo-v2");
export const MEDIA_DIR = join(DEMO_DIR, "media");
export interface DemoRun {
  runId: string;
  language: Language;
  density: Density;
  summary: RunSummary;
  cues: Cue[];
  describedFile: string;
}
export interface DemoData {
  clipFile: string;
  standard: DemoRun;
  editBase: DemoRun;
  edited: DemoRun;
  edit: { cueId: string; text: string; start: number };
  evaluationRuns: number;
  evaluationDone: number;
  evaluationFailed: number;
}
interface Selection {
  projectId: string;
  generationRunId: string;
  editBaseRunId: string;
  editedRuns: Partial<Record<Language, string>>;
  edit: { cueId: string; text: string; start: number };
}
export async function download(path: string, file: string) {
  if (existsSync(file)) return;
  const response = await fetch(`${SERVICE_URL}/api/projects/${PROJECT_ID}/${path}`);
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
}
export async function loadRunById(runId: string): Promise<DemoRun> {
  const scriptFile = join(MEDIA_DIR, `${runId}.script.json`);
  const describedFile = join(MEDIA_DIR, `${runId}.described.mp4`);
  await download(`media/runs/${runId}/script.json`, scriptFile);
  await download(`media/runs/${runId}/described.mp4`, describedFile);
  const script = JSON.parse(await readFile(scriptFile, "utf8"));
  const response = await fetch(`${SERVICE_URL}/api/projects/${PROJECT_ID}/runs/${runId}`);
  if (!response.ok) throw Error(`Run events unavailable: ${runId}`);
  const { events } = await response.json();
  const first = events[0];
  return {
    runId,
    language: first.language,
    density: first.density,
    summary: script.summary,
    cues: script.cues,
    describedFile,
  };
}
export async function loadDemoData(language: Language): Promise<DemoData> {
  await mkdir(MEDIA_DIR, { recursive: true });
  const selection: Selection = JSON.parse(await readFile(join(DEMO_DIR, "selection.json"), "utf8"));
  if (selection.projectId !== PROJECT_ID) throw Error("Demo selection project mismatch");
  const standard = await loadRunById(selection.generationRunId);
  const editBase = await loadRunById(selection.editBaseRunId);
  const edited = selection.editedRuns[language]
    ? await loadRunById(selection.editedRuns[language]!)
    : editBase;
  const clipFile = join(MEDIA_DIR, "clip.mp4");
  await download("media/clip.mp4", clipFile);
  const rows = (await readFile("runtime/evaluation/runs.jsonl", "utf8"))
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  return {
    clipFile,
    standard,
    editBase,
    edited,
    edit: selection.edit,
    evaluationRuns: rows.length,
    evaluationDone: rows.filter((r) => r.status === "done").length,
    evaluationFailed: rows.filter((r) => r.status === "failed").length,
  };
}
export async function saveEditedRun(language: Language, runId: string) {
  const file = join(DEMO_DIR, "selection.json");
  const selection: Selection = JSON.parse(await readFile(file, "utf8"));
  selection.editedRuns[language] = runId;
  await writeFile(file, JSON.stringify(selection, null, 2));
}
