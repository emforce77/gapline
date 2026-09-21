import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { Workspace } from "@/components/workspace/Workspace";
import { asUiLang, dictionary, UI_LANG_COOKIE } from "@/i18n";
import { I18nProvider } from "@/i18n/client";
import { listRuns, readAnalysis, readProject, type Project } from "@/lib/store/projects";
import { loadShowcase } from "@/lib/store/showcase";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  let project: Project;
  try {
    project = await readProject(id);
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
        initialRuns={runs}
        analysis={analysis}
        measured={showcase?.preview?.summary ?? null}
      />
    </I18nProvider>
  );
}
