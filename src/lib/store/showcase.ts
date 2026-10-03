import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { RunSummary } from "../pipeline/events";
import type { Cue, SpeechSegment } from "../pipeline/schemas";
import {
  dataDir,
  listRuns,
  readProject,
  runDir,
  sampleProjectIds,
  type Project,
  type RunListing,
} from "./projects";

export interface Showcase {
  project: Project;
  runs: RunListing[];
  /** The newest standard-density run in the viewer's language (or any language), for the preview. */
  preview: {
    runId: string;
    language: string;
    speech: SpeechSegment[];
    cues: Cue[];
    summary: RunSummary;
  } | null;
}

/** showcase.json at the top of DATA_DIR: the sample and, per language, the run it shows. */
const ShowcasePinSchema = z.object({
  projectId: z.string(),
  runs: z.record(z.string(), z.string()),
});
type ShowcasePin = z.infer<typeof ShowcasePinSchema>;

/**
 * Every page reads the pin, so a wrong one fails them all; each way it can be wrong names
 * showcase.json instead of being skipped (docs/DEPLOY.md, "Add the sample").
 */
async function readPin(): Promise<ShowcasePin | null> {
  const file = join(dataDir(), "showcase.json");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    return null;
  }
  const pin = ShowcasePinSchema.safeParse(JSON.parse(raw));
  if (!pin.success) throw new Error(`${file} is malformed:\n${z.prettifyError(pin.error)}`);
  return pin.data;
}

/**
 * The pinned sample, read on its own, so the landing page costs the same however many clips
 * visitors upload. Without a pin, the newest sample; uploads are never read.
 */
async function showcaseProject(pin: ShowcasePin | null): Promise<Project | null> {
  if (!pin) {
    const samples: Project[] = [];
    for (const id of await sampleProjectIds()) {
      const project = await readProject(id).catch((e: NodeJS.ErrnoException) => {
        if (e.code === "ENOENT") return null;
        throw e;
      });
      if (project?.kind === "sample") samples.push(project);
    }
    return samples.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }
  let project: Project;
  try {
    project = await readProject(pin.projectId);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    throw new Error(`showcase.json pins ${pin.projectId}, which is not in ${dataDir()}/projects`, {
      cause: e,
    });
  }
  // Everyone sees the landing page; a visitor's upload must never be shown there.
  if (project.kind !== "sample")
    throw new Error(`showcase.json pins ${pin.projectId}, which is not a sample`);
  return project;
}

/**
 * The sample with its public finished runs and its preview in each of `languages`, read from disk
 * once for the landing page. Everyone sees the same page, so no visitor's own version can become
 * its preview or its figures.
 */
export async function loadShowcases<L extends string>(
  languages: readonly L[],
): Promise<Record<L, Showcase> | null> {
  const pin = await readPin();
  const project = await showcaseProject(pin);
  if (!project) return null;
  const runs = await listRuns(project, undefined);
  const standard = runs.filter((r) => r.density === "standard" && r.summary);
  // Two languages can fall back to the same run; its script is read once.
  const scripts = new Map<string, Promise<string>>();
  const readScript = (runId: string) => {
    if (!scripts.has(runId))
      scripts.set(runId, readFile(join(runDir(project.id, runId), "script.json"), "utf8"));
    return scripts.get(runId)!;
  };
  const showcases = await Promise.all(
    languages.map(async (language): Promise<[L, Showcase]> => {
      const pick =
        standard.find((r) => r.runId === pin?.runs[language]) ??
        standard.find((r) => r.language === language) ??
        standard[0];
      if (!pick) return [language, { project, runs, preview: null }];
      const script = JSON.parse(await readScript(pick.runId));
      return [
        language,
        {
          project,
          runs,
          preview: {
            runId: pick.runId,
            language: pick.language,
            speech: script.speech,
            cues: (script.cues as Cue[]).filter((c) => c.status === "fits"),
            summary: script.summary,
          },
        },
      ];
    }),
  );
  return Object.fromEntries(showcases) as Record<L, Showcase>;
}

/** loadShowcases for one language. */
export async function loadShowcase(preferredLanguage: string): Promise<Showcase | null> {
  return (await loadShowcases([preferredLanguage]))?.[preferredLanguage] ?? null;
}
