"use client";

import { useEffect, useState } from "react";
import { fill } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { formatClock, formatDuration, formatSeconds, formatUsd } from "@/lib/format";
import type { RunFiles, RunSummary } from "@/lib/pipeline/events";
import { roomForMoment } from "@/lib/pipeline/cues";
import { MIN_GAP_SECONDS, SPEECH_GUARD_SECONDS } from "@/lib/pipeline/gaps";
import type { Cue, Gap, Language, MissingItem } from "@/lib/pipeline/schemas";
import { Gloss } from "./glosses";
import type { RunNote } from "./labels";
import { readResult } from "./result-notes";
import { knownMissingFiles, probeRunFiles } from "./run-files";

/** The measured outcome of a result; labels come first in the markup, values first on screen. */
export function Metrics({ summary }: { summary: RunSummary }) {
  const { t, lang } = useI18n();
  const items = [
    [String(summary.cuesShipped), summary.cuesShipped === 1 ? t.metrics.line : t.metrics.lines],
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

/** The shortest pause a line can go in: a usable silence plus the margin kept around each word. */
const SHORTEST_PAUSE_SECONDS = MIN_GAP_SECONDS + 2 * SPEECH_GUARD_SECONDS;

/**
 * What the result amounts to, then the final check's outcome. The heading says plainly when no
 * line or only part of the clip is described, and the sentence under it says how much and why
 * (narration only goes where nobody speaks). Then what Gapline fixed on its own after the check, and
 * what it still notes, each list under its own lead so a note reads as a note: moments with no line
 * (one with no free silence left says so), heard lines it still flags with the reviewer's fix
 * labelled as such, lines it took out instead of fixing, and lines it wrote but dropped before the
 * check, each with why. A static block, not a live region: it is the same result every time it is
 * shown again. Older results have no final check; unless they describe little, they get no block
 * rather than a sentence that sounds like a failure.
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
  const reading = readResult(summary, cues, gaps);
  if (reading.coverage === "enough" && !summary.qualityStatus) return null;
  const fixed = summary.finalFix ? summary.finalFix.rewritten + summary.finalFix.added : 0;
  const missing = summary.finalReview?.missing ?? [];
  const voiced = cues
    .filter((c) => c.status === "fits")
    .map((c) => ({ start: c.start, end: c.start + (c.seconds ?? 0) }));
  // The same rule the final check's fix used to place a line for the moment (cues.ts).
  const noRoom = (m: MissingItem) => !roomForMoment(m, gaps, voiced);
  const heading =
    reading.coverage === "none"
      ? t.editor.noLines
      : reading.coverage === "little"
        ? t.editor.littleCovered
        : reading.notes
          ? t.editor.reviewNeeded
          : t.editor.checked;
  const room = formatSeconds(summary.gapSeconds, lang);
  const lineButton = (cueId: string) => (
    <button className="button ghost small" onClick={() => onSelect(cueId)}>
      {fill(t.line.title, { n: lineNumbers.get(cueId) ?? cueId })}
    </button>
  );
  const lineText = (cue: Cue) => <q lang={language ?? undefined}>{cue.versions.at(-1)!.text}</q>;
  const droppedLine = (cue: Cue) => (
    <li key={cue.id}>
      {lineButton(cue.id)} {lineText(cue)}
      <span className="label">
        {" "}
        · {cue.droppedReason ? t.line.dropped[cue.droppedReason] : t.line.state.dropped}
      </span>
    </li>
  );
  return (
    <div className="quality-note">
      <h2>{heading}</h2>
      <p>
        {reading.noLines
          ? fill(t.editor.noLinesWhy[reading.noLines], {
              pause: formatSeconds(SHORTEST_PAUSE_SECONDS, lang),
              room,
            })
          : fill(t.editor.coverage, {
              lines: fill(t.editor.lines[summary.cuesShipped === 1 ? "one" : "other"], {
                n: summary.cuesShipped,
              }),
              narrated: formatSeconds(summary.narrationSeconds, lang),
              room,
              clip: formatSeconds(summary.clipSeconds, lang),
            })}
      </p>
      {reading.coverage === "little" && summary.qualityStatus && !reading.notes ? (
        <p>{t.editor.checkedNote}</p>
      ) : null}
      {fixed > 0 ? (
        <p>
          {fill(t.editor.autoFixed, {
            lines: fill(t.editor.lines[fixed === 1 ? "one" : "other"], { n: fixed }),
          })}
        </p>
      ) : null}
      {summary.costStatus === "unresolved" ? <p>{t.editor.uncertainty}</p> : null}
      {missing.length ? (
        <>
          <p>{t.editor.missingLead}</p>
          <ul>
            {missing.map((m, i) => (
              <li key={i}>
                <span className="mono label">{formatClock(m.at)}</span>{" "}
                <span lang={language ?? undefined}>{m.what}</span>
                <Gloss text={m.what} pageLang={lang} textLang={language} />
                {noRoom(m) ? <span className="label"> · {t.editor.noRoom}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {reading.flagged.length ? (
        <>
          <p>{t.editor.failingLead}</p>
          <ul>
            {reading.flagged.map(({ verdict, cue }) => (
              <li key={cue.id}>
                {lineButton(cue.id)} {lineText(cue)}
                <span className="label"> · {t.line.fix}: </span>
                <span lang={language ?? undefined}>{verdict.fix}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {reading.takenOut.length ? (
        <>
          <p>{t.editor.takenOutLead}</p>
          <ul>{reading.takenOut.map(({ cue }) => droppedLine(cue))}</ul>
        </>
      ) : null}
      {reading.unvoiced.length ? (
        <>
          <p>{t.editor.unvoicedLead}</p>
          <ul>{reading.unvoiced.map(droppedLine)}</ul>
        </>
      ) : null}
      {/* With no line voiced, the reason above already says what can be done. */}
      {cues.length && !reading.noLines ? <p className="label">{t.editor.optional}</p> : null}
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

/** Files a result holds only when a line is voiced: without one they are the film as it was. */
const DESCRIBED_FILES = new Set<keyof RunFiles>(["described", "narration", "vtt"]);

/**
 * Result files. Older results list files they never wrote, so each one is probed with a one-byte
 * range request and a missing one is shown as unavailable instead of as a link that 404s. Only a
 * 404 counts as missing (probeRunFile); a file with no clear answer stays a link and is probed again
 * the next time. A result with no voiced line offers its script; its film, stem and text track say
 * they hold no description.
 */
export function Downloads({
  base,
  files,
  described,
}: {
  base: string;
  files: RunFiles;
  /** Whether any line is voiced in this result. */
  described: boolean;
}) {
  const { t } = useI18n();
  const [probed, setProbed] = useState<{
    base: string;
    missing: ReadonlySet<keyof RunFiles>;
  } | null>(null);
  const missing =
    probed?.base === base
      ? probed.missing
      : (knownMissingFiles<keyof RunFiles>(base) ?? new Set<keyof RunFiles>());
  useEffect(() => {
    if (knownMissingFiles(base)) return;
    let cancelled = false;
    probeRunFiles(base, files)
      .then((found) => {
        if (!cancelled) setProbed({ base, missing: found });
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
        !described && DESCRIBED_FILES.has(key) ? (
          <span key={key} className="download-missing">
            {t.workspace[label]} <span className="label">· {t.workspace.noDescription}</span>
          </span>
        ) : missing.has(key) ? (
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

/** An edited result: the result it came from, and what the edit did to which line. */
export function EditSummary({ parent, note }: { parent: string; note: RunNote }) {
  const { t } = useI18n();
  const sentence =
    t.versions[
      note.kind === "removed"
        ? "basedOnRemoved"
        : note.kind === "moved"
          ? "basedOnMoved"
          : "basedOn"
    ];
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
