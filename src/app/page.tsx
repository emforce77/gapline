import Link from "next/link";
import { cookies } from "next/headers";
import { LanguageToggle } from "@/components/LanguageToggle";
import { TimelinePreview } from "@/components/TimelinePreview";
import { UploadCard } from "@/components/UploadCard";
import { glossFor } from "@/components/workspace/glosses";
import { lineage, originalRun, sampleRunFigures } from "@/components/workspace/labels";
import { featuredLine, RejectionStory } from "@/components/landing/RejectionStory";
import { SevenSeconds, type NarrationTrack } from "@/components/landing/SevenSeconds";
import { asUiLang, dictionary, fill, UI_LANG_COOKIE, type UiLang } from "@/i18n";
import { formatClock, formatDuration, formatSeconds, formatUsd } from "@/lib/format";
import { findGaps } from "@/lib/pipeline/gaps";
import { GUIDELINE_RULES } from "@/lib/pipeline/guidelines";
import type { Language } from "@/lib/pipeline/schemas";
import { readAnalysis } from "@/lib/store/projects";
import { loadShowcase, type Showcase } from "@/lib/store/showcase";

export const dynamic = "force-dynamic";

/** The seven seconds of the story: after "…locked." (53.7 s) until "This is pretty freaky." (60.9 s). */
const SEVEN_START_SECONDS = 54.0;
const SEVEN_END_SECONDS = 60.4;

type Preview = NonNullable<Showcase["preview"]>;

/** Like fill(), but each measured value is set in bold so the sentence can be scanned. */
function emphasize(template: string, values: Record<string, string | number>): React.ReactNode[] {
  return template
    .split(/\{(\w+)\}/)
    .map((part, i) => (i % 2 === 1 ? <strong key={i}>{String(values[part])}</strong> : part));
}

function narrationTrack(projectId: string, preview: Preview, lang: UiLang): NarrationTrack {
  const language = preview.language as Language;
  return {
    language,
    name: new Intl.DisplayNames([language], { type: "language" }).of(language) ?? language,
    describedUrl: `/api/projects/${projectId}/media/runs/${preview.runId}/described.mp4`,
    lines: preview.cues
      .filter((c) => c.start >= SEVEN_START_SECONDS && c.start < SEVEN_END_SECONDS)
      .map((c) => {
        const text = c.versions.at(-1)!.text;
        return {
          start: c.start,
          end: c.start + (c.seconds ?? 0),
          text,
          gloss: glossFor(text, lang, language),
        };
      }),
  };
}

export default async function LandingPage() {
  const lang = asUiLang((await cookies()).get(UI_LANG_COOKIE)?.value);
  const t = dictionary(lang);
  const [english, korean] = await Promise.all([loadShowcase("en"), loadShowcase("ko")]);
  const showcase = lang === "ko" ? korean : english;
  // The story follows the pinned Korean result: the line the reviewer rejected and an editor fixed.
  const featured = korean?.preview ?? showcase?.preview ?? null;
  const project = showcase?.project ?? null;
  const analysis = project ? await readAnalysis(project.id) : null;
  const gaps =
    project && analysis
      ? findGaps({ speech: analysis.speech, sounds: analysis.scene.sounds }, project.clipSeconds)
      : [];
  const previews = [showcase?.preview, lang === "ko" ? english?.preview : korean?.preview].filter(
    (p): p is Preview => !!p,
  );
  const tracks = project
    ? previews
        .filter((p, i) => previews.findIndex((q) => q.runId === p.runId) === i)
        .map((p) => narrationTrack(project.id, p, lang))
    : [];
  const story = featured ? featuredLine(featured.cues) : null;
  // The featured result may be an editor's fix; the measured run is the original it came from.
  const runs = korean?.runs ?? [];
  const original = originalRun(runs, featured?.runId);
  const measured = original?.summary ?? null;
  // The pinned result may carry later edits (a removal); the fix shown is the rewrite of this line.
  const fix = lineage(runs, featured?.runId).find(
    (r) => r.lastEdit?.cueId === story?.id && r.lastEdit?.action === "rewrite",
  );
  const edit = fix?.summary ?? null;
  const sevenSpeech = analysis?.speech ?? [];
  const before = sevenSpeech.filter((s) => s.end <= SEVEN_START_SECONDS).at(-1);
  const after = sevenSpeech.find((s) => s.start >= SEVEN_END_SECONDS);
  const sum = (spans: { start: number; end: number }[]) =>
    spans.reduce((total, s) => total + s.end - s.start, 0);
  const shortest = Math.min(...gaps.map((g) => g.end - g.start));

  return (
    <div className="landing">
      <header className="site-header">
        <Link href="/" className="wordmark">
          {t.nav.home}
        </Link>
        <LanguageToggle lang={lang} label={t.nav.language} />
      </header>

      <main id="main" tabIndex={-1}>
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">{t.landing.eyebrow}</p>
            <h1>{t.landing.title}</h1>
            <p className="lede">{t.landing.lede}</p>
            <div className="hero-actions">
              {project ? (
                <Link className="button primary" href={`/p/${project.id}`}>
                  {t.landing.ctaSample}
                </Link>
              ) : null}
              <a className="button" href="#try-your-clip">
                {t.landing.ctaUpload}
              </a>
            </div>
          </div>
          {project && tracks.length ? (
            <div className="hero-demo" id="seven">
              <p className="label">{t.landing.seven.label}</p>
              <h2>{t.landing.seven.title}</h2>
              <p className="hero-demo-body">{t.landing.seven.body}</p>
              <SevenSeconds
                originalUrl={`/api/projects/${project.id}/media/clip.mp4`}
                tracks={tracks}
                windowStart={SEVEN_START_SECONDS}
                windowEnd={SEVEN_END_SECONDS}
                labels={t.landing.seven}
              />
            </div>
          ) : null}
        </section>

        {project && featured && analysis ? (
          <section className="constraint">
            <h2>{t.landing.timelineTitle}</h2>
            <p className="section-lede">{t.landing.timelineLede}</p>
            <TimelinePreview
              clipSeconds={project.clipSeconds}
              stripUrl={`/api/projects/${project.id}/media/strip.jpg`}
              speech={analysis.speech}
              gaps={gaps}
              cues={featured.cues}
              highlight={
                before && after ? { start: before.end, end: after.start, href: "#seven" } : null
              }
              labels={{
                picture: t.landing.timelineRows.picture,
                dialogue: t.landing.timelineRows.dialogue,
                dialogueStat: fill(t.landing.timelineRows.dialogueStat, {
                  n: analysis.speech.length,
                  s: formatSeconds(sum(analysis.speech), lang),
                }),
                room: t.landing.timelineRows.room,
                roomStat: fill(t.landing.timelineRows.roomStat, {
                  n: gaps.length,
                  s: formatSeconds(sum(gaps), lang),
                }),
                narration: t.landing.timelineRows.narration,
                narrationStat: fill(t.landing.timelineRows.narrationStat, {
                  n: featured.cues.length,
                }),
                shortest: fill(t.landing.shortest, { s: formatSeconds(shortest, lang) }),
                seven: t.landing.sevenMark,
                caption: t.landing.timelineNote,
              }}
            />
            <h3 className="flow-title">{t.landing.flowTitle}</h3>
            <ol className="flow">
              {t.landing.flow.map((step) => (
                <li key={step.name}>
                  <strong>{step.name}</strong>
                  <span>{step.detail}</span>
                  {"loop" in step ? <span className="flow-loop">{step.loop}</span> : null}
                  <span className="label">{step.service}</span>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {story && featured ? (
          <section className="rejection">
            <div className="rejection-copy">
              <h2>{t.landing.rejectionTitle}</h2>
              <p className="section-lede">
                {fill(t.landing.rejectionLede, { time: formatClock(story.start) })}
              </p>
              <details className="rules">
                <summary>{fill(t.landing.rulesSummary, { n: GUIDELINE_RULES.length })}</summary>
                <ul>
                  {GUIDELINE_RULES.map((rule) => (
                    <li key={rule.id}>
                      <strong>{rule.title[lang]}</strong>
                      <span className="label">{rule.source[lang]}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
            <RejectionStory
              cue={story}
              language={featured.language as Language}
              lang={lang}
              t={t}
            />
          </section>
        ) : null}

        {measured ? (
          <section className="measured">
            <h2>{t.landing.measuredTitle}</h2>
            <p className="measured-line">
              {emphasize(t.landing.measuredRun, {
                language: new Intl.DisplayNames([lang], { type: "language" }).of(
                  original!.language,
                )!,
                cost: formatUsd(measured.costUsd, lang),
                time: formatDuration(measured.wallSeconds, lang),
                fit: measured.cuesFitting,
                shipped: measured.cuesShipped,
                overlap: formatSeconds(measured.overlapWithSpeechSeconds, lang),
              })}{" "}
              {edit
                ? emphasize(t.landing.measuredEdit, {
                    cost: formatUsd(edit.costUsd, lang),
                    time: formatDuration(edit.wallSeconds, lang),
                  })
                : null}
            </p>
            <p className="label">{t.landing.measuredNote}</p>
          </section>
        ) : null}

        <section className="upload-section" id="try-your-clip">
          <div>
            <h2>{t.landing.ctaUpload}</h2>
            <p className="section-lede">{t.landing.uploadIntro}</p>
          </div>
          <UploadCard
            lang={lang}
            labels={{
              title: t.landing.uploadTitle,
              hint: measured
                ? fill(t.landing.uploadHint, sampleRunFigures(original!.language, measured, lang))
                : "",
              choose: t.landing.uploadChoose,
              working: t.landing.uploadWorking,
              tooLong: t.landing.uploadTooLong,
              failed: t.landing.uploadFailed,
            }}
          />
        </section>

        <section className="why">
          <h2>{t.landing.whyTitle}</h2>
          <ul>
            {t.landing.why.map((item) => (
              <li key={item.figure}>
                <strong>{item.figure}</strong>
                <span>{item.text}</span>
                <span className="label">{item.source}</span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="site-footer">
        <p>{t.landing.footerFilm}</p>
        <p>{t.landing.footerGuides}</p>
      </footer>
    </div>
  );
}
