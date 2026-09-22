import Link from "next/link";
import { cookies } from "next/headers";
import { LanguageToggle } from "@/components/LanguageToggle";
import { TimelinePreview } from "@/components/TimelinePreview";
import { UploadCard } from "@/components/UploadCard";
import { asUiLang, dictionary, fill, UI_LANG_COOKIE } from "@/i18n";
import { formatDuration, formatSeconds, formatUsd } from "@/lib/format";
import { GUIDELINE_RULES } from "@/lib/pipeline/guidelines";
import { loadShowcase } from "@/lib/store/showcase";

export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  const t = dictionary(lang);
  const showcase = await loadShowcase(lang);
  const summary = showcase?.preview?.summary ?? null;
  const measuredHint = summary
    ? fill(t.landing.uploadHint, {
        time: formatDuration(summary.wallSeconds, lang),
        cost: formatUsd(summary.costUsd, lang),
      })
    : "";

  return (
    <div className="landing">
      <header className="site-header">
        <Link href="/" className="wordmark">
          {t.nav.home}
        </Link>
        <LanguageToggle lang={lang} label={t.nav.language} />
      </header>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">{t.landing.eyebrow}</p>
          <h1>{t.landing.title}</h1>
          <p className="lede">{t.landing.lede}</p>
          <div className="hero-actions">
            {showcase ? (
              <Link className="button primary" href={`/p/${showcase.project.id}`}>
                ▶ {t.landing.ctaSample}
              </Link>
            ) : null}
            <a className="button" href="#upload">
              {t.landing.ctaUpload}
            </a>
          </div>
        </div>

        {showcase ? (
          <Link href={`/p/${showcase.project.id}`} className="sample-card">
            <div
              className="sample-strip"
              style={{
                backgroundImage: `url(/api/projects/${showcase.project.id}/media/strip.jpg)`,
              }}
            />
            <div className="sample-body">
              <p className="label">{t.landing.sampleLabel}</p>
              <h2>{showcase.project.title}</h2>
              {showcase.preview ? (
                <TimelinePreview
                  clipSeconds={showcase.project.clipSeconds}
                  speech={showcase.preview.speech}
                  cues={showcase.preview.cues}
                  labels={{ dialogue: t.timeline.dialogue, narration: t.timeline.narration }}
                />
              ) : null}
              <p className="label">
                {formatSeconds(showcase.project.clipSeconds, lang)} · {t.editor.ready}:{" "}
                {Array.from(
                  new Set(
                    showcase.runs.map(
                      (r) =>
                        `${r.language === "ko" ? "한국어" : "English"} / ${r.density === "standard" ? t.workspace.densityStandard : t.workspace.densityBrief}`,
                    ),
                  ),
                ).join(" · ") || "—"}
              </p>
            </div>
          </Link>
        ) : null}
      </section>

      {summary ? (
        <section className="measured">
          <h2>{t.landing.measuredTitle}</h2>
          <dl>
            <div>
              <dt>{t.landing.measured.cost}</dt>
              <dd>{formatUsd(summary.costUsd, lang)}</dd>
            </div>
            <div>
              <dt>{t.landing.measured.time}</dt>
              <dd>{formatDuration(summary.wallSeconds, lang)}</dd>
            </div>
            <div>
              <dt>{t.landing.measured.fit}</dt>
              <dd>
                {summary.cuesFitting}/{summary.cuesShipped}
              </dd>
            </div>
            <div>
              <dt>{t.landing.measured.overlap}</dt>
              <dd>{formatSeconds(summary.overlapWithSpeechSeconds, lang)}</dd>
            </div>
          </dl>
          <p className="label">
            {t.landing.measured.clip}: {showcase?.project.title} (
            {formatSeconds(summary.clipSeconds, lang)})
          </p>
        </section>
      ) : null}

      <section className="how">
        <h2>{t.landing.howTitle}</h2>
        <ol>
          {t.landing.how.map((step, i) => (
            <li key={step.name}>
              <span className="step-index mono">{String(i + 1).padStart(2, "0")}</span>
              <h3>{step.name}</h3>
              <p>{step.detail}</p>
              <p className="label">{step.service}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="why">
        <h2>{t.landing.whyTitle}</h2>
        <ul>
          {t.landing.why.map((item) => (
            <li key={item.figure}>
              <strong>{item.figure}</strong>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rules">
        <h2>{t.landing.rulesTitle}</h2>
        <p className="lede">{t.landing.rulesLede}</p>
        <ul>
          {GUIDELINE_RULES.map((rule) => (
            <li key={rule.id}>
              <strong>{rule.title[lang]}</strong>
              <span className="label">{rule.source[lang]}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="upload-section">
        <UploadCard
          labels={{
            title: t.landing.uploadTitle,
            hint: measuredHint,
            choose: t.landing.uploadChoose,
            working: t.landing.uploadWorking,
            tooLong: t.landing.uploadTooLong,
            failed: t.landing.uploadFailed,
          }}
        />
      </section>

      <footer className="site-footer">
        <p>{t.landing.footerFilm}</p>
        <p>{t.landing.footerGuides}</p>
      </footer>
    </div>
  );
}
