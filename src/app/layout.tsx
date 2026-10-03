import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { asUiLang, dictionary, UI_LANG_COOKIE } from "@/i18n";
// Self-hosted unicode-range subsets (font-display: swap): a page fetches only the subsets its
// text uses instead of the 2 MB full variable font.
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "@/styles/fonts/symbols.css";
import "@/styles/tokens.css";
import "@/styles/landing-story.css";
import "@/styles/landing.css";
import "@/styles/workspace.css";
import "@/styles/player.css";
import "@/styles/inspector.css";
import "@/styles/timeline.css";

const LOAD_FAILURE_ID = "load-failure";

/**
 * Runs before the app's own scripts: when one of the page's files under /_next/static/ fails (Cloud
 * Run answers 429 when it is busy), React never wakes up and every button is dead. The page then
 * says so and offers a reload instead of looking ready. Resource errors do not bubble, so the
 * listener captures them on window.
 */
const WATCH_LOAD_FAILURES = `addEventListener("error", function (event) {
  var el = event.target;
  var url = el && (el.src || el.href);
  if (!url || String(url).indexOf("/_next/static/") < 0) return;
  console.error("Gapline: a page file did not load", url);
  function show() {
    var box = document.getElementById("${LOAD_FAILURE_ID}");
    if (!box || !box.hidden) return;
    box.hidden = false;
    box.querySelector("button").addEventListener("click", function () { location.reload(); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show);
  else show();
}, true);`;

/**
 * The public origin, so og:image is absolute. Cloud Run routes by Host and sets the proto itself;
 * a client's X-Forwarded-Host reaches the app unchanged, so it is never used (store/access.ts).
 */
async function requestOrigin(): Promise<URL> {
  const request = await headers();
  const host = request.get("host");
  if (!host) throw new Error("The request has no Host header, so the page cannot name its origin");
  const protocol = request.get("x-forwarded-proto")?.split(",")[0].trim() ?? "http";
  return new URL(`${protocol}://${host}`);
}

export async function generateMetadata(): Promise<Metadata> {
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  const t = dictionary(lang);
  return {
    metadataBase: await requestOrigin(),
    title: t.meta.title,
    description: t.meta.description,
    // No title or description here: Next fills each page's own into the card. The image is
    // app/opengraph-image.png, the same for every page, so a card never shows a private upload.
    // url "./" is resolved against each request's path (Next 16 resolveRelativeUrl), so every page
    // names itself as og:url, without its query string.
    openGraph: {
      type: "website",
      url: "./",
      siteName: t.nav.home,
      locale: lang === "ko" ? "ko_KR" : "en_US",
    },
    twitter: { card: "summary_large_image" },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  const t = dictionary(lang);
  return (
    <html lang={lang}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: WATCH_LOAD_FAILURES }} />
      </head>
      <body>
        <a className="skip-link" href="#main">
          {t.nav.skip}
        </a>
        {/* Revealed by WATCH_LOAD_FAILURES, which also wires the button: React may never run. */}
        <div
          id={LOAD_FAILURE_ID}
          className="load-failure"
          role="alert"
          hidden
          suppressHydrationWarning
        >
          <p>{t.failure.partial}</p>
          <button type="button" className="button">
            {t.failure.reload}
          </button>
        </div>
        {children}
      </body>
    </html>
  );
}
