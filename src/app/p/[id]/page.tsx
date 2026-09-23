import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { originalRun } from "@/components/workspace/labels";
import { Workspace } from "@/components/workspace/Workspace";
import { asUiLang, dictionary, fill, UI_LANG_COOKIE } from "@/i18n";
import { I18nProvider } from "@/i18n/client";
import { listRuns, readAnalysis, type Project } from "@/lib/store/projects";
import { loadShowcase } from "@/lib/store/showcase";
import { accessibleProject, publicProject } from "@/lib/store/access";

export const dynamic = "force-dynamic";

/** The tab names the clip, so a screen reader and a crowded tab bar both say what is open. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  const t = dictionary(lang);
  const project = await accessibleProject((await params).id);
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
    const accessible = await accessibleProject(id);
    if (!accessible) notFound();
    project = publicProject(accessible);
  } catch {
    notFound();
  }
  const [runs, analysis, showcase, korean] = await Promise.all([
    listRuns(project.id),
    readAnalysis(project.id),
    loadShowcase(lang),
    loadShowcase("ko"),
  ]);
  // The sample's cost and time quote the same run as the landing page: the original automatic run
  // behind the pinned Korean result the story follows, whatever the viewer's language.
  const measured = (korean && originalRun(korean.runs, korean.preview?.runId)) ?? null;
  // The sample opens on that same pinned Korean result in either language, so "Open the sample"
  // shows the run the landing page, the film and the deck describe.
  return (
    <I18nProvider lang={lang} t={dictionary(lang)}>
      <Workspace
        project={project}
        initialRunId={
          (await searchParams).run ??
          (showcase?.project.id === project.id
            ? (korean?.preview?.runId ?? showcase.preview?.runId)
            : undefined)
        }
        initialRuns={runs}
        analysis={analysis}
        measured={measured}
      />
    </I18nProvider>
  );
}
