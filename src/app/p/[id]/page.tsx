import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace/Workspace";
import { asUiLang, dictionary, UI_LANG_COOKIE } from "@/i18n";
import { I18nProvider } from "@/i18n/client";
import { listRuns, readAnalysis, type Project } from "@/lib/store/projects";
import { loadShowcase } from "@/lib/store/showcase";
import { accessibleProject, publicProject } from "@/lib/store/access";

export const dynamic = "force-dynamic";

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
  const [runs, analysis, showcase] = await Promise.all([
    listRuns(project.id),
    readAnalysis(project.id),
    loadShowcase(lang),
  ]);
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
        measured={showcase?.preview?.summary ?? null}
      />
    </I18nProvider>
  );
}
