import type { Metadata } from "next";
import { cookies } from "next/headers";
import { asUiLang, dictionary, UI_LANG_COOKIE } from "@/i18n";
// Self-hosted unicode-range subsets (font-display: swap): a page fetches only the subsets its
// text uses instead of the 2 MB full variable font.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@/styles/tokens.css";
import "@/styles/landing-story.css";
import "@/styles/landing.css";
import "@/styles/workspace.css";
import "@/styles/player.css";
import "@/styles/inspector.css";
import "@/styles/timeline.css";

export async function generateMetadata(): Promise<Metadata> {
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  const t = dictionary(lang);
  return { title: t.meta.title, description: t.meta.description };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  const t = dictionary(lang);
  return (
    <html lang={lang}>
      <body>
        <a className="skip-link" href="#main">
          {t.nav.skip}
        </a>
        {children}
      </body>
    </html>
  );
}
