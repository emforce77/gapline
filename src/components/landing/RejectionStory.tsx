import { Fragment } from "react";
import { fill, type UiLang } from "@/i18n";
import type { Dictionary } from "@/i18n/en";
import { formatSeconds } from "@/lib/format";
import { GUIDELINE_RULES } from "@/lib/pipeline/guidelines";
import type { Cue, CueVersion, Language, Violation } from "@/lib/pipeline/schemas";
import { glossFor } from "@/components/workspace/glosses";

const RULES = new Map(GUIDELINE_RULES.map((r) => [r.id, r]));

/**
 * A version the final check sent back. Only a version that passed review is ever voiced, and the
 * final check's verdict replaces the review of the version it fails (run.ts, fix stage), so a voiced
 * version with a failing review is one the final check rejected.
 */
export function sentBackByFinalCheck(version: CueVersion): boolean {
  return version.voice !== undefined && version.review?.pass === false;
}

/**
 * The line the landing walks through: the earliest shipped line the final check sent back, else the
 * earliest shipped line rejected at least once (rewritten by Gapline, or on an edited track by hand),
 * else the earliest line rejected at all.
 */
export function featuredLine(cues: Cue[]): Cue | null {
  const byTime = [...cues].sort((a, b) => a.start - b.start);
  const shipped = byTime.filter((c) => c.status === "fits");
  const rejected = (c: Cue) => c.versions.some((v) => v.review?.pass === false);
  return (
    shipped.find((c) => c.versions.some(sentBackByFinalCheck)) ??
    shipped.find(rejected) ??
    byTime.find(rejected) ??
    null
  );
}

/**
 * A version's violations, one group per quoted words. The reviewer lists every rule a phrase breaks,
 * so one problem (a skyline named before it is on screen) can come back under two rules; the story
 * tells it once, with every rule and clause it breaks.
 */
export function problems(violations: Violation[]): Violation[][] {
  const byQuote = new Map<string, Violation[]>();
  for (const v of violations) {
    const quote = v.quote.trim();
    byQuote.set(quote, [...(byQuote.get(quote) ?? []), v]);
  }
  return [...byQuote.values()];
}

/** What became of a rejected version, told by who made the next one; null when nothing follows. */
export function nextStep(
  version: CueVersion,
  next: CueVersion | undefined,
): keyof Dictionary["landing"]["rejection"]["next"] | null {
  if (version.review?.pass !== false) return null;
  if (next?.by === "human") return "human";
  if (next?.by === "revise") return sentBackByFinalCheck(version) ? "final" : "revise";
  return null;
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
  const last = cue.versions.length - 1;
  return (
    <ol className="story">
      {cue.versions.map((version, i) => {
        const failed = version.review && !version.review.pass;
        const groups = failed ? problems(version.review!.violations) : [];
        const step = nextStep(version, cue.versions[i + 1]);
        // The measured ending belongs to the version that shipped, whoever wrote it.
        const shipped = i === last && cue.status === "fits" ? version.voice : undefined;
        return (
          <li key={i} className={`story-step${failed ? " failed" : ""}`}>
            <p className="story-by label">
              <span className="mono">v{i + 1}</span> {r.step[version.by]}
            </p>
            <p className="story-text">
              <Text text={version.text} lang={lang} textLang={language} />
            </p>
            {groups.map((group, j) => (
              <div key={j} className="story-verdict">
                <p className="story-rule">
                  <span aria-hidden="true">✗ </span>
                  {sentBackByFinalCheck(version) ? r.sentBack : r.rejected}:{" "}
                  {group.map((v, k) => (
                    <Fragment key={k}>
                      {k > 0 ? " / " : null}
                      <strong>{RULES.get(v.rule)?.title[lang] ?? v.rule}</strong>
                    </Fragment>
                  ))}
                </p>
                {group.map((v, k) => (
                  <p key={k} className="story-source label">
                    {RULES.get(v.rule)?.source[lang]}
                  </p>
                ))}
                {/* One reason: two rules on the same words word one problem twice (on the pinned
                    sample, "not shown until the cut at 17.5 s" and "not visible at 15.0 s"); the
                    titles and clauses above name every rule it breaks. */}
                <p className="story-reason">
                  <Text text={group[0].reason} lang={lang} textLang={language} />
                </p>
                {/* A review has one fix, however many problems it lists: told once, last. */}
                {j === groups.length - 1 && version.review!.fix ? (
                  <p className="story-fix">
                    <span className="label">{r.suggestion}: </span>
                    <Text text={version.review!.fix} lang={lang} textLang={language} />
                  </p>
                ) : null}
              </div>
            ))}
            {version.review?.pass ? (
              <p className="story-pass">
                <span aria-hidden="true">✓ </span>
                {r.passed}
              </p>
            ) : null}
            {shipped ? (
              <div className="story-fit">
                <div className="fit-bar" aria-hidden="true">
                  <span
                    className="fit-fill"
                    style={{ width: `${Math.min(1, shipped.seconds / room) * 100}%` }}
                  />
                </div>
                <p className="label">
                  {fill(r.fitted, {
                    spoken: formatSeconds(shipped.seconds, lang),
                    room: formatSeconds(room, lang),
                  })}
                </p>
                {version.by === "human" ? <p className="label">{r.human}</p> : null}
              </div>
            ) : null}
            {step ? <p className="story-dropped">{r.next[step]}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
