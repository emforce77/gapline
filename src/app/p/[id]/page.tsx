import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { orderRuns, originalRun } from "@/components/workspace/labels";
import { settingKey, shownRun } from "@/components/workspace/run-choice";
import { Workspace } from "@/components/workspace/Workspace";
import { asUiLang, dictionary, fill, UI_LANG_COOKIE, type UiLang } from "@/i18n";
import { I18nProvider } from "@/i18n/client";
import { settingInParams } from "@/lib/client/run-url";
import type { TimedRunEvent } from "@/lib/pipeline/events";
import { readAnalysis, readRunSnapshot, type Project } from "@/lib/store/projects";
import { listRuns } from "@/lib/store/run-index";
import { loadShowcases } from "@/lib/store/showcase";
import { accessibleProject, accessibleRun, publicProject, viewerHash } from "@/lib/store/access";

export const dynamic = "force-dynamic";

/** The metadata and the page share one read of the project per request. */
const projectFor = cache(accessibleProject);

/** Both narration languages: the sample opens each on its own pinned result. */
const NARRATIONS: readonly UiLang[] = ["en", "ko"];

/** The tab names the clip, so a screen reader and a crowded tab bar both say what is open. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  const t = dictionary(lang);
  const project = await projectFor((await params).id);
  // An unknown or private clip renders the 404 page; its tab says so instead of the landing title.
  return { title: project ? fill(t.meta.project, { title: project.title }) : t.notFound.metaTitle };
}

/**
 * Whether ?run= names a run this viewer can open that has no finished result yet (still going,
 * or stopped: the workspace follows it and says which). Another viewer's run, a run that does not
 * exist, or a malformed id is not one, and the page opens on its default result instead.
 */
async function unfinishedRun(projectId: string, runId: string): Promise<boolean> {
  if (!(await accessibleRun(projectId, runId))) return false;
  try {
    await readRunSnapshot(projectId, runId);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * A finished result's saved events, read with the page so the workspace opens on it without a
 * fetch first (and the player starts on its described film, not the original). Null when the read
 * does not find it done: the browser then reads it itself, with its own retries and messages, as it
 * did before; why is logged here.
 */
async function finishedEvents(
  projectId: string,
  runId: string,
): Promise<{ runId: string; events: TimedRunEvent[] } | null> {
  try {
    const { events, status } = await readRunSnapshot(projectId, runId);
    if (status === "done") return { runId, events };
    console.warn(`run ${runId} read as ${status} with the page; the browser reads it again`);
  } catch (error) {
    console.error(`run ${runId} not read with the page; the browser reads it again`, error);
  }
  return null;
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  // The viewer's language first: its preview is the run the landing page describes. It does not
  // depend on this project, so it is read while the project is (each read is a bucket round trip).
  const loading = loadShowcases([lang, ...NARRATIONS.filter((l) => l !== lang)]);
  // A page that ends in notFound() never awaits it.
  loading.catch(() => {});
  let project: Project;
  try {
    const accessible = await projectFor(id);
    if (!accessible) notFound();
    project = publicProject(accessible);
  } catch {
    notFound();
  }
  // The sample opens on its pinned result in the viewer's language: its events are read while the
  // listing is, so the page arrives with the result.
  const previewRead = loading.then(
    (s) => {
      const preview = s?.[lang]?.project.id === project.id ? s[lang].preview : null;
      return preview ? finishedEvents(project.id, preview.runId) : null;
    },
    () => null,
  );
  const viewer = await viewerHash();
  const [runs, analysis, showcases] = await Promise.all([
    // On the sample, the public results and this viewer's own; another viewer's ?run= is not found.
    // Without a session that is the public listing the showcase reads anyway, when this is its sample.
    viewer
      ? listRuns(project, viewer)
      : loading.then((s) =>
          s?.[lang].project.id === project.id ? s[lang].runs : listRuns(project, undefined),
        ),
    readAnalysis(project.id),
    loading,
  ]);
  const showcase = showcases?.[lang]?.project.id === project.id ? showcases[lang] : null;
  // The sample opens each narration language on its pinned result, so "Open the sample" shows the
  // run the landing page describes (in English, the run the film and the deck describe).
  const pins: Record<string, string> = Object.fromEntries(
    showcase
      ? NARRATIONS.flatMap((l) => {
          const preview = showcases![l].preview;
          return preview ? [[preview.language, preview.runId]] : [];
        })
      : [],
  );
  // The empty panel's "… took … and cost …" line: this clip's own newest original run, or else
  // the sample's original run behind the pinned result in the viewer's language (as the landing).
  const own =
    project.kind === "sample"
      ? undefined
      : orderRuns(runs).find((r) => !r.summary?.parentRunId && r.summary);
  const sample = showcases?.[lang];
  const measured = own ?? (sample && originalRun(sample.runs, sample.preview?.runId)) ?? null;

  const search = await searchParams;
  const named = typeof search.run === "string" ? search.run : undefined;
  const finished = named ? runs.some((r) => r.runId === named) : false;
  const following = named && !finished ? await unfinishedRun(project.id, named) : false;
  // A narration language and density named without a run (a choice with no result yet).
  const initialSetting = settingInParams(search);
  // Otherwise the sample opens on its pinned result in the viewer's language.
  const namesSetting = Boolean(initialSetting.language || initialSetting.density);
  const initialRunId =
    named && (finished || following)
      ? named
      : namesSetting
        ? undefined
        : (showcase?.preview?.runId ?? undefined);
  // The result the workspace opens on (as its first render picks it), sent with the page.
  const pinned = runs.find((r) => r.runId === initialRunId);
  const opening = following
    ? null
    : shownRun(
        runs,
        {
          language: pinned?.language ?? initialSetting.language ?? lang,
          density: pinned?.density ?? initialSetting.density ?? "standard",
        },
        pinned ? { [settingKey(pinned)]: pinned.runId } : {},
        pins,
      );
  const preview = await previewRead;
  const initialResult = !opening
    ? null
    : preview?.runId === opening.runId
      ? preview
      : await finishedEvents(project.id, opening.runId);
  return (
    <I18nProvider lang={lang} t={dictionary(lang)}>
      <Workspace
        project={project}
        initialRunId={initialRunId}
        initialSetting={initialSetting}
        initialResult={initialResult ?? undefined}
        missingRunId={named && !finished && !following ? named : undefined}
        initialRuns={runs}
        analysis={analysis}
        measured={measured}
        measuredHere={Boolean(own)}
        pins={pins}
      />
    </I18nProvider>
  );
}
