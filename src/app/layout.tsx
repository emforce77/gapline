import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { asUiLang, dictionary, UI_LANG_COOKIE } from "@/i18n";
import "@/styles/tokens.css";
import "@/styles/landing-story.css";
import "@/styles/landing.css";
import "@/styles/workspace.css";
import "@/styles/player.css";
import "@/styles/inspector.css";
import "@/styles/timeline.css";

const pretendard = localFont({
  src: "../../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
  display: "swap",
  weight: "45 920",
  variable: "--font-pretendard",
});

export async function generateMetadata(): Promise<Metadata> {
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  const t = dictionary(lang);
  return { title: t.meta.title, description: t.meta.description };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  const t = dictionary(lang);
  return (
    <html lang={lang} className={pretendard.variable}>
      <body>
        <a className="skip-link" href="#main">
          {t.nav.skip}
        </a>
        {children}
      </body>
    </html>
  );
}
