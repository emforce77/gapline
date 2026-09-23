"use client";

import { useEffect, useState } from "react";
import { fill } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { formatClock, formatDuration, formatSeconds, formatUsd } from "@/lib/format";
import type { RunFiles, RunSummary } from "@/lib/pipeline/events";
import { freeRoom } from "@/lib/pipeline/cues";
import type { Cue, Gap, Language, MissingItem } from "@/lib/pipeline/schemas";
import { Gloss } from "./glosses";
import type { RunNote } from "./labels";

/** The measured outcome of a result; labels come first in the markup, values first on screen. */
export function Metrics({ summary }: { summary: RunSummary }) {
  const { t, lang } = useI18n();
  const items = [
    [String(summary.cuesShipped), t.metrics.lines],
    [`${summary.cuesFitting}/${summary.cuesShipped}`, t.metrics.fit],
    [formatSeconds(summary.overlapWithSpeechSeconds, lang), t.metrics.overlap],
    [String(summary.cuesRejected), t.metrics.caught],
    [formatUsd(summary.costUsd, lang), t.metrics.cost],
    [formatDuration(summary.wallSeconds, lang), t.metrics.time],
  ];
  return (
    <dl className="metrics">
      {items.map(([value, label]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The final check's outcome: what Scene fixed by itself after it, and what it still lists, for anyone
 * who wants to step in. A listed moment with no free silence left says so: Scene could not add a line
 * there without talking over dialogue. Older results have no final check; they get no badge rather
 * than a sentence that sounds like a failure.
 */
export function QualityNote({
  summary,
  gaps,
  cues,
  language,
  lineNumbers,
  onSelect,
}: {
  summary: RunSummary;
  gaps: Gap[];
  cues: Cue[];
  language: Language | null;
  lineNumbers: Map<string, number>;
  onSelect: (cueId: string) => void;
}) {
  const { t, lang } = useI18n();
  if (!summary.qualityStatus) return null;
  const failing = summary.finalReview?.verdicts.filter((v) => !v.pass) ?? [];
  const fixed = summary.finalFix ? summary.finalFix.rewritten + summary.finalFix.added : 0;
  const missing = summary.finalReview?.missing ?? [];
  const voiced = cues
    .filter((c) => c.status === "fits")
    .map((c) => ({ start: c.start, end: c.start + (c.seconds ?? 0) }));
  const noRoom = (m: MissingItem) => {
    const gap = gaps.find((g) => g.id === m.gapId);
    return !gap || !freeRoom(Math.min(Math.max(m.at, gap.start), gap.end), gap, voiced);
  };
  return (
    <div className="quality-note" role="status">
      <strong>
        {summary.qualityStatus === "model_checked" ? t.editor.checked : t.editor.reviewNeeded}
      </strong>
      {fixed > 0 ? (
        <p>
          {fill(t.editor.autoFixed, {
            lines: fill(t.editor.lines[fixed === 1 ? "one" : "other"], { n: fixed }),
          })}
        </p>
      ) : null}
      {summary.costStatus === "unresolved" ? <p>{t.editor.uncertainty}</p> : null}
      {missing.length || failing.length ? (
        <ul>
          {missing.map((m, i) => (
            <li key={`m${i}`}>
              <span className="mono label">{formatClock(m.at)}</span>{" "}
              <span lang={language ?? undefined}>{m.what}</span>
              <Gloss text={m.what} pageLang={lang} textLang={language} />
              {noRoom(m) ? <span className="label"> · {t.editor.noRoom}</span> : null}
            </li>
          ))}
          {failing.map((v) => (
            <li key={v.cueId}>
              <button className="button ghost small" onClick={() => onSelect(v.cueId)}>
                {fill(t.line.title, { n: lineNumbers.get(v.cueId) ?? v.cueId })}
              </button>{" "}
              <span lang={language ?? undefined}>{v.fix}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="label">{t.editor.optional}</p>
    </div>
  );
}

const DOWNLOADS: [
  keyof RunFiles,
  "downloadDescribed" | "downloadNarration" | "downloadVtt" | "downloadScript",
][] = [
  ["described", "downloadDescribed"],
  ["narration", "downloadNarration"],
  ["vtt", "downloadVtt"],
  ["script", "downloadScript"],
];

/**
 * Result files. Older results list files they never wrote, so each one is probed with a one-byte
 * range request and a missing one is shown as unavailable instead of as a link that 404s.
 */
export function Downloads({ base, files }: { base: string; files: RunFiles }) {
  const { t } = useI18n();
  const [missing, setMissing] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      DOWNLOADS.map(async ([key]) => {
        const response = await fetch(`${base}/${files[key]}`, { headers: { Range: "bytes=0-0" } });
        await response.body?.cancel();
        return response.ok ? null : key;
      }),
    )
      .then((keys) => {
        if (!cancelled) setMissing(new Set(keys.filter((k): k is keyof RunFiles => k !== null)));
      })
      .catch((e: unknown) => console.error("Could not check result files", e));
    return () => {
      cancelled = true;
    };
  }, [base, files]);
  return (
    <div className="downloads">
      <h2 className="inspector-heading">{t.workspace.downloads}</h2>
      {DOWNLOADS.map(([key, label]) =>
        missing.has(key) ? (
          <span key={key} className="download-missing">
            {t.workspace[label]} <span className="label">· {t.workspace.notRecorded}</span>
          </span>
        ) : (
          <a key={key} href={`${base}/${files[key]}?download=1`}>
            <span aria-hidden="true">↓ </span>
            {t.workspace[label]}
          </a>
        ),
      )}
    </div>
  );
}

/** An edited result: the result it came from, and what the editor did to which line. */
export function EditSummary({ parent, note }: { parent: string; note: RunNote }) {
  const { t } = useI18n();
  const sentence = note.kind === "removed" ? t.versions.basedOnRemoved : t.versions.basedOn;
  return (
    <p className="edit-summary">
      {fill(sentence, { parent, line: fill(t.line.title, { n: note.line }) })}
    </p>
  );
}

/**
 * During a run, live or replayed: what the reviewer found missing, round by round. Later rounds
 * cover some of it, so a finished result shows the final check's list (QualityNote) instead.
 */
export function Coverage({
  coverage,
  language,
}: {
  coverage: { round: number; missing: MissingItem[] }[];
  language: Language;
}) {
  const { t, lang } = useI18n();
  return (
    <div className="coverage">
      <h2 className="inspector-heading">{t.coverage.title}</h2>
      <ul>
        {coverage
          .flatMap((c) => c.missing)
          .map((m, i) => (
            <li key={i}>
              <span className="mono label">{formatClock(m.at)}</span>{" "}
              <span lang={language}>{m.what}</span>
              <Gloss text={m.what} pageLang={lang} textLang={language} />
            </li>
          ))}
      </ul>
    </div>
  );
}
