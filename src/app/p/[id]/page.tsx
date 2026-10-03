import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { originalRun } from "@/components/workspace/labels";
import { Workspace } from "@/components/workspace/Workspace";
import { asUiLang, dictionary, fill, UI_LANG_COOKIE } from "@/i18n";
import { I18nProvider } from "@/i18n/client";
import { listRuns, readAnalysis, type Project } from "@/lib/store/projects";
import { loadShowcase } from "@/lib/store/showcase";
import { accessibleProject, publicProject, viewerHash } from "@/lib/store/access";

export const dynamic = "force-dynamic";

/** The metadata and the page share one read of the project per request. */
const projectFor = cache(accessibleProject);

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

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string }>;
}) {
  const { id } = await params;
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  let project: Project;
  try {
    const accessible = await projectFor(id);
    if (!accessible) notFound();
    project = publicProject(accessible);
  } catch {
    notFound();
  }
  const viewer = await viewerHash();
  const loading = loadShowcase(lang);
  const [runs, analysis, showcase] = await Promise.all([
    // On the sample, the public results and this viewer's own; another viewer's ?run= is not found.
    // Without a session that is the public listing the showcase reads anyway, when this is its sample.
    viewer
      ? listRuns(project, viewer)
      : loading.then((s) => (s?.project.id === project.id ? s.runs : listRuns(project, undefined))),
    readAnalysis(project.id),
    loading,
  ]);
  // The sample's cost and time quote the same run as the landing page: the original automatic run
  // behind the pinned result in the viewer's language.
  const measured = (showcase && originalRun(showcase.runs, showcase.preview?.runId)) ?? null;
  // The sample opens on that same pinned result, so "Open the sample" shows the run the landing page
  // describes (in English, the run the film and the deck describe).
  return (
    <I18nProvider lang={lang} t={dictionary(lang)}>
      <Workspace
        project={project}
        initialRunId={
          (await searchParams).run ??
          (showcase?.project.id === project.id ? showcase.preview?.runId : undefined)
        }
        initialRuns={runs}
        analysis={analysis}
        measured={measured}
      />
    </I18nProvider>
  );
}
