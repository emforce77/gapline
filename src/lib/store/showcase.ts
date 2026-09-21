import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunSummary } from "../pipeline/events";
import type { Cue, SpeechSegment } from "../pipeline/schemas";
import { listProjects, listRuns, runDir, type Project, type RunListing } from "./projects";

export interface Showcase {
  project: Project;
  runs: RunListing[];
  /** The newest standard-density run in the viewer's language (or any language), for the preview. */
  preview: { language: string; speech: SpeechSegment[]; cues: Cue[]; summary: RunSummary } | null;
}

/** The first sample project with its finished runs, read from disk for the landing page. */
export async function loadShowcase(preferredLanguage: string): Promise<Showcase | null> {
  const project = (await listProjects()).find((p) => p.kind === "sample");
  if (!project) return null;
  const runs = await listRuns(project.id);
  const standard = runs.filter((r) => r.density === "standard" && r.summary);
  const pick = standard.find((r) => r.language === preferredLanguage) ?? standard[0];
  if (!pick) return { project, runs, preview: null };
  const script = JSON.parse(
    await readFile(join(runDir(project.id, pick.runId), "script.json"), "utf8"),
  );
  return {
    project,
    runs,
    preview: {
      language: pick.language,
      speech: script.speech,
      cues: (script.cues as Cue[]).filter((c) => c.status === "fits"),
      summary: script.summary,
    },
  };
}
