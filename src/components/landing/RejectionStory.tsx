import { fill, type UiLang } from "@/i18n";
import type { Dictionary } from "@/i18n/en";
import { formatSeconds } from "@/lib/format";
import { GUIDELINE_RULES } from "@/lib/pipeline/guidelines";
import type { Cue, Language } from "@/lib/pipeline/schemas";
import { glossFor } from "@/components/workspace/glosses";

const RULES = new Map(GUIDELINE_RULES.map((r) => [r.id, r]));

/**
 * The line the landing walks through: the earliest one an editor rescued after the reviewer rejected
 * it, else the earliest one the reviewer rejected at least once.
 */
export function featuredLine(cues: Cue[]): Cue | null {
  const byTime = [...cues].sort((a, b) => a.start - b.start);
  const rescued = byTime.find((c) =>
    c.versions.some((v, i) => v.by === "human" && c.versions[i - 1]?.review?.pass === false),
  );
  return rescued ?? byTime.find((c) => c.versions.some((v) => v.review?.pass === false)) ?? null;
}

function Text({ text, lang, textLang }: { text: string; lang: UiLang; textLang: Language }) {
  const gloss = glossFor(text, lang, textLang);
  return (
    <>
      <span lang={textLang}>{text}</span>
      {gloss ? <span className="gloss">{gloss}</span> : null}
    </>
  );
}

/** Every version of one real line, with the rule each rejection cites, down to the voiced length. */
export function RejectionStory({
  cue,
  language,
  lang,
  t,
}: {
  cue: Cue;
  language: Language;
  lang: UiLang;
  t: Dictionary;
}) {
  const r = t.landing.rejection;
  const room = cue.windowEnd - cue.start;
  return (
    <ol className="story">
      {cue.versions.map((version, i) => {
        const failed = version.review && !version.review.pass;
        const next = cue.versions[i + 1];
        return (
          <li key={i} className={`story-step${failed ? " failed" : ""}`}>
            <p className="story-by label">
              <span className="mono">v{i + 1}</span> {r.step[version.by]}
            </p>
            <p className="story-text">
              <Text text={version.text} lang={lang} textLang={language} />
            </p>
            {failed
              ? version.review!.violations.map((v, j) => {
                  const rule = RULES.get(v.rule);
                  return (
                    <div key={j} className="story-verdict">
                      <p className="story-rule">
                        <span aria-hidden="true">✗ </span>
                        {r.rejected}: <strong>{rule?.title[lang] ?? v.rule}</strong>
                      </p>
                      <p className="story-source label">{rule?.source[lang]}</p>
                      <p className="story-reason">
                        <Text text={v.reason} lang={lang} textLang={language} />
                      </p>
                      {version.review!.fix ? (
                        <p className="story-fix">
                          <span className="label">{r.suggestion}: </span>
                          <Text text={version.review!.fix} lang={lang} textLang={language} />
                        </p>
                      ) : null}
                    </div>
                  );
                })
              : null}
            {version.review?.pass ? (
              <p className="story-pass">
                <span aria-hidden="true">✓ </span>
                {r.passed}
              </p>
            ) : null}
            {version.by === "human" && version.voice ? (
              <div className="story-fit">
                <div className="fit-bar" aria-hidden="true">
                  <span
                    className="fit-fill"
                    style={{ width: `${Math.min(1, version.voice.seconds / room) * 100}%` }}
                  />
                </div>
                <p className="label">
                  {fill(r.fitted, {
                    spoken: formatSeconds(version.voice.seconds, lang),
                    room: formatSeconds(room, lang),
                  })}
                </p>
                <p className="label">{r.human}</p>
              </div>
            ) : null}
            {failed && next?.by === "human" ? <p className="story-dropped">{r.dropped}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
