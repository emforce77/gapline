"use client";

import { useI18n } from "@/i18n/client";
import { fill } from "@/i18n";
import { formatSeconds } from "@/lib/format";
import { GUIDELINE_RULES } from "@/lib/pipeline/guidelines";
import type { Cue, CueVersion, Language } from "@/lib/pipeline/schemas";
import { diffWords } from "./diff";
import { Gloss } from "./glosses";

const RULES = new Map(GUIDELINE_RULES.map((r) => [r.id, r]));

/** The words of one version, with what changed since the previous one marked. */
function VersionText({
  version,
  previous,
  language,
}: {
  version: CueVersion;
  previous: CueVersion | undefined;
  language: Language | null;
}) {
  // A removal keeps the words that were taken out; they are struck, not diffed.
  if (version.by === "remove") {
    return (
      <p className="version-text" lang={language ?? undefined}>
        <del>{version.text}</del>
      </p>
    );
  }
  if (!previous || previous.text === version.text) {
    return (
      <p className="version-text" lang={language ?? undefined}>
        {version.text}
      </p>
    );
  }
  return (
    <p className="version-text" lang={language ?? undefined}>
      {diffWords(previous.text, version.text).map((part, i) =>
        part.kind === "same" ? (
          <span key={i}>{part.text}</span>
        ) : part.kind === "added" ? (
          <ins key={i}>{part.text}</ins>
        ) : (
          <del key={i}>{part.text}</del>
        ),
      )}
    </p>
  );
}

/** Every version of a line: who wrote it, what changed, how long it sounded, what the reviewer said. */
export function VersionHistory({ cue, language }: { cue: Cue; language: Language | null }) {
  const { t, lang } = useI18n();
  const room = cue.windowEnd - cue.start;
  return (
    <ol className="versions">
      {cue.versions.map((version, i) => {
        const previous = cue.versions[i - 1];
        const moved =
          previous?.start !== undefined &&
          version.start !== undefined &&
          previous.start !== version.start;
        return (
          <li key={i} className={`version by-${version.by}`}>
            <div className="version-head label">
              <span className="mono">v{i + 1}</span> {t.line.by[version.by]}
              {previous && previous.text === version.text && version.by !== "remove" ? (
                <span className="version-same"> · {fill(t.line.sameWords, { n: i })}</span>
              ) : null}
            </div>
            <VersionText version={version} previous={previous} language={language} />
            <Gloss text={version.text} pageLang={lang} textLang={language} />
            {moved ? (
              <p className="label">
                {fill(t.line.moved, {
                  from: formatSeconds(previous.start!, lang),
                  to: formatSeconds(version.start!, lang),
                })}
              </p>
            ) : null}
            {version.voice ? (
              <p className={`voiced label${version.voice.seconds > room ? " over" : ""}`}>
                {version.voice.seconds > room ? <span aria-hidden="true">⚠ </span> : null}
                {fill(t.line.voiced, {
                  seconds: formatSeconds(version.voice.seconds, lang),
                  rate: version.voice.rate.toFixed(2),
                })}{" "}
                ·{" "}
                {version.voice.seconds > room
                  ? fill(t.line.tooLong, { room: formatSeconds(room, lang) })
                  : t.line.fits}
              </p>
            ) : null}
            {version.review ? (
              version.review.pass ? (
                <p className="verdict pass">
                  <span aria-hidden="true">✓ </span>
                  {t.line.passed}
                </p>
              ) : (
                <div className="verdict fail">
                  <p className="verdict-title">
                    <span aria-hidden="true">✗ </span>
                    {t.line.rejected}
                  </p>
                  <ul>
                    {version.review.violations.map((v, j) => {
                      const rule = RULES.get(v.rule);
                      return (
                        <li key={j}>
                          <strong>{rule?.title[lang] ?? v.rule}</strong>
                          <span className="quote" lang={language ?? undefined}>
                            “{v.quote}”
                          </span>
                          <span lang={language ?? undefined}>{v.reason}</span>
                          <Gloss text={v.reason} pageLang={lang} textLang={language} />
                          <span className="label">{rule?.source[lang]}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {version.review.fix ? (
                    <p className="fix">
                      {t.line.fix}: <span lang={language ?? undefined}>{version.review.fix}</span>
                      <Gloss text={version.review.fix} pageLang={lang} textLang={language} />
                    </p>
                  ) : null}
                </div>
              )
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
