"use client";

import Link from "next/link";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useI18n } from "@/i18n/client";
import type { Project } from "@/lib/store/projects";

/** Wordmark, the clip's title with its credit, and the interface language switch. */
export function WorkspaceHeader({ project }: { project: Project }) {
  const { t, lang } = useI18n();
  return (
    <header className="ws-header">
      <Link href="/" className="wordmark">
        {t.nav.home}
      </Link>
      <div className="ws-title">
        <h1>{project.title}</h1>
        {project.attribution ? (
          <span className="label">
            {project.attribution} · {project.license}
          </span>
        ) : null}
      </div>
      <LanguageToggle lang={lang} label={t.nav.language} />
    </header>
  );
}
