import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { RunSummary } from "../pipeline/events";
import type { Cue, SpeechSegment } from "../pipeline/schemas";
import {
  dataDir,
  isRunId,
  readAnalysis,
  readProject,
  runDir,
  sampleProjectIds,
  type Project,
  type RunListing,
} from "./projects";
import { listRuns } from "./run-index";

export interface Showcase {
  project: Project;
  runs: RunListing[];
  /** The sample's analysis (null when it has none); read only when asked for (loadShowcases). */
  analysis?: Awaited<ReturnType<typeof readAnalysis>>;
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

/** What the landing page and the sample need besides the project, all read from its id alone. */
async function readShowcaseFiles(projectId: string, withAnalysis: boolean) {
  return Promise.all([
    listRuns({ id: projectId, kind: "sample" }, undefined),
    withAnalysis ? readAnalysis(projectId) : undefined,
  ]);
}

/**
 * The sample with its public finished runs and its preview in each of `languages`, read from disk
 * once for the landing page. Everyone sees the same page, so no visitor's own version can become
 * its preview or its figures. `analysis`: also read the sample's analysis (the landing page).
 *
 * On Cloud Run every file call is a round trip to the bucket (about 100 ms), so with a pin the
 * project, its run listing, its analysis and the pinned runs' scripts are all read at once: they
 * need only the pinned id. A pinned script is used only once the listing shows its run finished and
 * public; the project is checked to be a sample before anything is returned (5 waits in a row
 * before, 2 now; QA 2026-10-03).
 */
export async function loadShowcases<L extends string>(
  languages: readonly L[],
  { analysis: withAnalysis = false }: { analysis?: boolean } = {},
): Promise<Record<L, Showcase> | null> {
  const pin = await readPin();
  // Two languages can fall back to the same run; its script is read once.
  const scripts = new Map<string, Promise<string>>();
  const readScript = (projectId: string, runId: string) => {
    if (!scripts.has(runId)) {
      const read = readFile(join(runDir(projectId, runId), "script.json"), "utf8");
      // A script read ahead may go unused (its run is not finished or not public); its failure
      // then matters to no one. One that is used still throws where it is awaited.
      read.catch(() => {});
      scripts.set(runId, read);
    }
    return scripts.get(runId)!;
  };
  let project: Project | null;
  let runs: RunListing[];
  let analysis: Showcase["analysis"];
  if (pin) {
    for (const language of languages) {
      const runId = pin.runs[language];
      if (runId && isRunId(runId)) readScript(pin.projectId, runId);
    }
    // All settle before either answer is used: what is wrong with the pin is reported first.
    const [pinned, files] = await Promise.allSettled([
      showcaseProject(pin),
      readShowcaseFiles(pin.projectId, withAnalysis),
    ]);
    if (pinned.status === "rejected") throw pinned.reason;
    if (files.status === "rejected") throw files.reason;
    project = pinned.value;
    [runs, analysis] = files.value;
  } else {
    project = await showcaseProject(null);
    if (!project) return null;
    [runs, analysis] = await readShowcaseFiles(project.id, withAnalysis);
  }
  if (!project) return null;
  const sample = project;
  const standard = runs.filter((r) => r.density === "standard" && r.summary);
  const showcases = await Promise.all(
    languages.map(async (language): Promise<[L, Showcase]> => {
      const pick =
        standard.find((r) => r.runId === pin?.runs[language]) ??
        standard.find((r) => r.language === language) ??
        standard[0];
      const shown = { project: sample, runs, ...(withAnalysis ? { analysis } : {}) };
      if (!pick) return [language, { ...shown, preview: null }];
      const script = JSON.parse(await readScript(sample.id, pick.runId));
      return [
        language,
        {
          ...shown,
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
