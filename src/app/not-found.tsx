import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { LanguageToggle } from "@/components/LanguageToggle";
import { asUiLang, dictionary, UI_LANG_COOKIE } from "@/i18n";
import { SAMPLE_CLIPS } from "@/lib/samples";

/**
 * Its own tab title, so a 404 does not pass for the landing page. Next resolves this module's
 * metadata when it renders the not-found convention (unknown URLs and notFound() alike).
 */
export async function generateMetadata(): Promise<Metadata> {
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  return { title: dictionary(lang).notFound.metaTitle };
}

/** Unknown pages, and uploaded clips opened from a browser that did not upload them. */
export default async function NotFound() {
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  const t = dictionary(lang);
  return (
    <div className="landing">
      <header className="site-header">
        <Link href="/" className="wordmark">
          {t.nav.home}
        </Link>
        <LanguageToggle lang={lang} label={t.nav.language} />
      </header>
      <main id="main" tabIndex={-1} className="not-found">
        <p className="eyebrow">404</p>
        <h1>{t.notFound.title}</h1>
        <p className="lede">{t.notFound.body}</p>
        <div className="hero-actions">
          <Link className="button primary" href={`/p/${SAMPLE_CLIPS[0].id}`}>
            {t.notFound.sample}
          </Link>
          <Link className="button" href="/">
            {t.notFound.home}
          </Link>
        </div>
      </main>
    </div>
  );
}
