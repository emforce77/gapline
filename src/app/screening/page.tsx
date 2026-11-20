import Link from "next/link";
import { cookies } from "next/headers";
import { LanguageToggle } from "@/components/LanguageToggle";
import { asUiLang, dictionary, UI_LANG_COOKIE } from "@/i18n";
import { screeningCopy } from "./copy";
import s from "./screening.module.css";

const media = "/screening-media";
const evalUrl = "https://github.com/emforce77/gapline/blob/main/docs/EVALUATION.md";

export async function generateMetadata() {
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  return { title: screeningCopy[lang].title + " · Gapline" };
}

export default async function Screening() {
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  const t = screeningCopy[lang];
  return (
    <div className="landing">
      <header className="site-header">
        <Link href="/" className="wordmark">
          Gapline
        </Link>
        <LanguageToggle lang={lang} label={dictionary(lang).nav.language} />
      </header>
      <main className={s.screening} id="main" tabIndex={-1}>
        <section className={s.lead}>
          <div>
            <p className="eyebrow">{t.label}</p>
            <h1>{t.title}</h1>
            <p>{t.intro}</p>
          </div>
          <div>
            <video
              className={s.film}
              controls
              playsInline
              preload="metadata"
              width="960"
              height="480"
              aria-label={t.player}
              src={media + "/launch-review.mp4"}
            >
              <track
                kind="captions"
                srcLang={lang}
                label={lang === "ko" ? "한국어" : "English"}
                src={media + "/launch-" + lang + ".vtt"}
              />
            </video>
            <details>
              <summary>{t.transcript}</summary>
              <p>{t.notes}</p>
            </details>
            <a className={s.link} download href={media + "/launch-review.mp4"}>
              {t.download}
            </a>
          </div>
        </section>
        <section className={s.case}>
          <h2>{t.why}</h2>
          <p>{t.whyBody}</p>
        </section>
        <section className={s.case}>
          <h2>{t.timing}</h2>
          <p>{t.timingBody}</p>
          <div className={s.frames}>
            {(["brain", "eye"] as const).map((frame, i) => (
              <figure key={frame}>
                <img
                  src={media + (i === 0 ? "/brain.jpg" : "/eyepiece.jpg")}
                  alt=""
                  width="640"
                  height="268"
                />
                <figcaption>
                  <b>{i === 0 ? "00:56.7" : "00:59.3"}</b> {t[frame]}
                </figcaption>
              </figure>
            ))}
          </div>
          <p>{t.room}</p>
          <audio
            controls
            preload="none"
            className={s.takes}
            aria-label={t.takes}
            src={media + "/english-line.m4a"}
          />
          <Link
            className="button"
            href="/p/tos-opening?run=edit-4dc2dfa9d338d9ffd6bafe0d2a8b445e4879b96f"
          >
            {t.edit}
          </Link>
          <p>
            <Link
              className={s.link}
              href="/p/tos-opening?run=20260928t064307205-en-standard-221ceb"
            >
              {t.original}
            </Link>
          </p>
        </section>
        <section className={s.case}>
          <h2>{t.interview}</h2>
          <p>{t.interviewBody}</p>
          <video
            className={s.interview}
            controls
            playsInline
            preload="metadata"
            width="640"
            height="360"
            aria-label={t.interviewClip}
            src={media + "/hanbid.mp4"}
          >
            <track
              kind="captions"
              srcLang={lang}
              label={lang === "ko" ? "한국어" : "English"}
              src={media + "/hanbid-" + lang + ".vtt"}
            />
          </video>
          <details>
            <summary>{t.transcript}</summary>
            <p>{t.interviewNotes}</p>
          </details>
        </section>
        <footer className="site-footer">
          <a href={evalUrl}>{t.evidence}</a>
          <p>{t.credits}</p>
          <p>
            <a href="https://mango.blender.org/">Tears of Steel · Blender Foundation</a> ·{" "}
            <a href="https://creativecommons.org/licenses/by/3.0/">CC BY 3.0</a>
          </p>
          <p>
            <a href="https://commons.wikimedia.org/wiki/File:WIKITONGUES-_Hanbid_speaking_Korean.webm">
              Hanbid speaking Korean · Wikitongues / Teddy Nee
            </a>{" "}
            · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a>
          </p>
        </footer>
      </main>
    </div>
  );
}
