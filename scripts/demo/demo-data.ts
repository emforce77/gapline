/**
 * Everything the demo shows comes from the deployed service: the run list, each run's script.json
 * and its described film. Nothing is typed in by hand, so the numbers in the video are the numbers
 * the service measured.
 *
 * Output: runtime/demo/media/{clip.mp4, <runId>.described.mp4, <runId>.script.json, runs.json}
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunSummary } from "../../src/lib/pipeline/events";
import type { Cue, Density, Language } from "../../src/lib/pipeline/schemas";

export const SERVICE_URL = "https://scene-ad-958994530029.asia-northeast3.run.app";
export const PROJECT_ID = "tos-opening";
export const DEMO_DIR = join(process.cwd(), "runtime", "demo");
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
  /** The run the video shows, and the brief run the density switch lands on. */
  standard: DemoRun;
  brief: DemoRun;
}

interface RunListing {
  runId: string;
  language: Language;
  density: Density;
  summary: RunSummary | null;
}

async function download(path: string, file: string): Promise<void> {
  if (existsSync(file)) return;
  const response = await fetch(`${SERVICE_URL}/api/projects/${PROJECT_ID}/${path}`);
  if (!response.ok) throw new Error(`GET ${path}: HTTP ${response.status}`);
  await writeFile(file, Buffer.from(await response.arrayBuffer()));
}

async function loadRun(listing: RunListing): Promise<DemoRun> {
  const scriptFile = join(MEDIA_DIR, `${listing.runId}.script.json`);
  const describedFile = join(MEDIA_DIR, `${listing.runId}.described.mp4`);
  await download(`media/runs/${listing.runId}/script.json`, scriptFile);
  await download(`media/runs/${listing.runId}/described.mp4`, describedFile);
  const script = JSON.parse(await readFile(scriptFile, "utf8")) as {
    summary: RunSummary;
    cues: Cue[];
  };
  return {
    runId: listing.runId,
    language: listing.language,
    density: listing.density,
    summary: script.summary,
    cues: script.cues,
    describedFile,
  };
}

/** The newest finished run per language and density, as the workspace picks it. */
export async function loadDemoData(language: Language): Promise<DemoData> {
  await mkdir(MEDIA_DIR, { recursive: true });
  const response = await fetch(`${SERVICE_URL}/api/projects/${PROJECT_ID}/runs`);
  if (!response.ok) throw new Error(`GET runs: HTTP ${response.status}`);
  const { runs } = (await response.json()) as { runs: RunListing[] };
  await writeFile(join(MEDIA_DIR, "runs.json"), JSON.stringify(runs, null, 2));
  const pick = async (density: Density): Promise<DemoRun> => {
    const listing = runs.find((r) => r.language === language && r.density === density && r.summary);
    if (!listing) throw new Error(`No finished ${language} ${density} run on the service`);
    return loadRun(listing);
  };
  const clipFile = join(MEDIA_DIR, "clip.mp4");
  await download("media/clip.mp4", clipFile);
  return {
    clipFile,
    standard: await pick("standard"),
    brief: await pick("brief"),
  };
}
