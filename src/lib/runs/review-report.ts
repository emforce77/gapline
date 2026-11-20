import { dictionary, fill, type UiLang } from "@/i18n";
import { toRecordedSeconds } from "../format";
import type { RunEvent } from "../pipeline/events";
import { GUIDELINE_RULES } from "../pipeline/guidelines";
import type { Verdict } from "../pipeline/schemas";

/** A producer's copy of the saved result. Older runs without a final check say so explicitly. */
export function lineReviewReport(
  title: string,
  started: Extract<RunEvent, { type: "run_started" }>,
  { cues, summary }: Extract<RunEvent, { type: "run_done" }>,
  lang: UiLang,
): string {
  const t = dictionary(lang);
  const r = t.report;
  const seconds = (n: number) => toRecordedSeconds(n).toFixed(2) + (lang === "ko" ? "초" : " s");
  const reviewLines = (label: string, review: Verdict) => {
    const rows = [`${label} · ${review.pass ? t.line.passed : t.line.rejected}`];
    for (const violation of review.violations) {
      const rule = GUIDELINE_RULES.find((item) => item.id === violation.rule);
      rows.push(
        `  “${violation.quote}” · ${rule?.title[lang] ?? violation.rule} · ${violation.reason}`,
      );
      if (rule) rows.push(`  ${rule.source[lang]}`);
    }
    if (review.fix) rows.push(`  ${t.line.fix} · ${review.fix}`);
    return rows;
  };

  const rows = [
    r.title,
    title,
    `${r.run} · ${started.runId}`,
    ...(summary.parentRunId ? [`${r.parent} · ${summary.parentRunId}`] : []),
    `${t.workspace.narration} · ${new Intl.DisplayNames([lang], { type: "language" }).of(started.language)}`,
    `${r.duration} · ${seconds(summary.clipSeconds)}`,
    r.origin,
    ...(summary.parentRunId ? [r.edited] : []),
    "",
    summary.cuesShipped
      ? `${r.fitCount} · ${summary.cuesFitting}/${summary.cuesShipped}`
      : r.noVoice,
    `${t.metrics.overlap} · ${seconds(summary.overlapWithSpeechSeconds)}`,
    "",
    r.missing,
  ];
  const check = summary.finalReview;
  if (!check) rows.push(r.notRecorded);
  else if (!check.missing.length) rows.push(r.noneListed);
  else for (const item of check.missing) rows.push(`${seconds(item.at)} · ${item.what}`);

  rows.push("", r.lineNotes);
  if (!cues.length) rows.push(r.noLines);
  const ordered = [...cues].sort((a, b) => a.start - b.start);
  for (const [index, cue] of ordered.entries()) {
    rows.push(
      "",
      `${fill(t.line.title, { n: index + 1 })} · ${seconds(cue.start)}–${seconds(cue.windowEnd)} · ${t.line.state[cue.status]}`,
    );
    rows.push(`${t.line.room} · ${seconds(cue.windowEnd - cue.start)}`);
    if (cue.status === "fits" && cue.seconds !== undefined)
      rows.push(`${t.line.spoken} · ${seconds(cue.seconds)}`);
    if (cue.droppedReason) rows.push(t.line.dropped[cue.droppedReason]);
    for (const [i, version] of cue.versions.entries()) {
      const author = i === 0 && version.by === "human" ? r.editorWrote : t.line.by[version.by];
      rows.push(`v${i + 1} · ${author} · ${version.text}`);
      if (version.review) rows.push(...reviewLines(r.versionCheck, version.review));
    }
    const verdict = check?.verdicts.find((v) => v.cueId === cue.id);
    if (verdict) rows.push(...reviewLines(r.final, verdict));
    else if (cue.status === "fits") rows.push(r.notRecorded);
  }
  return rows.join("\n") + "\n";
}
