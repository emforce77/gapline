"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { asUiLang, dictionary, type UiLang } from "@/i18n";

/** A workspace that failed to render: say so, keep the error in the console, offer a retry. */
export default function WorkspaceError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  // The root layout sets <html lang> from the language cookie; read it once on the client.
  const [lang, setLang] = useState<UiLang>("en");
  useEffect(() => setLang(asUiLang(document.documentElement.lang)), []);
  useEffect(() => console.error("Workspace failed to render", error), [error]);
  const t = dictionary(lang);
  return (
    <main id="main" tabIndex={-1} className="landing not-found">
      <p className="eyebrow">{t.nav.home}</p>
      <h1>{t.failure.title}</h1>
      <p className="lede">{t.failure.body}</p>
      <div className="hero-actions">
        <button type="button" className="button primary" onClick={() => retry()}>
          {t.failure.retry}
        </button>
        <Link className="button" href="/">
          {t.notFound.home}
        </Link>
      </div>
    </main>
  );
}
