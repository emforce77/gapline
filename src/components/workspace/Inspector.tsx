"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { useI18n } from "@/i18n/client";
import { fill } from "@/i18n";
import { sentBackByFinalCheck } from "@/components/landing/RejectionStory";
import { formatClock, formatSeconds, toRecordedSeconds } from "@/lib/format";
import type { RunView } from "@/lib/pipeline/reduce";
import type { Cue, Language } from "@/lib/pipeline/schemas";
import { Gloss } from "./glosses";
import { listedStages } from "./listed-stages";
import { runClockSeconds } from "./run-choice";
import { VersionHistory } from "./VersionHistory";

/**
 * Stage list with elapsed time for the running stage; where a failed or interrupted run stopped
 * reads "Stopped", and where the page lost touch with it "Connection lost". clockRate is 1 while
 * live, the replay speed during a replay, and 0 for a finished run. trace is the whole saved run
 * during a replay, null otherwise; which stages are listed is decided by listedStages. `ref` lets
 * the page move focus here when the control that had it goes away.
 */
export function StageList({
  view,
  trace,
  clockRate,
  startedAt = null,
  ref,
}: {
  view: RunView;
  trace: RunView | null;
  clockRate: number;
  /** When a live run began (ISO); after a reload its last event can be minutes old. */
  startedAt?: string | null;
  ref?: Ref<HTMLOListElement>;
}) {
  const { t, lang } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  // The run clock advances between events: last event time plus wall time since it arrived.
  const [anchor, setAnchor] = useState(() => ({ wall: Date.now(), t: view.t }));
  useEffect(() => setAnchor({ wall: Date.now(), t: view.t }), [view.t]);
  useEffect(() => {
    if (clockRate === 0) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [clockRate]);
  const runClock =
    clockRate === 1
      ? runClockSeconds(anchor, now, startedAt)
      : clockRate > 0
        ? anchor.t + ((now - anchor.wall) / 1000) * clockRate
        : view.t;
  const stages = listedStages(view, trace);

  return (
    <ol ref={ref} className="stages" tabIndex={-1}>
      {stages.map((stage) => {
        const s = view.stages[stage];
        let status: React.ReactNode = <span className="label">{t.stages.waiting}</span>;
        if (s.state === "running") {
          const elapsed = Math.max(0, runClock - (s.startedAt ?? runClock));
          status = (
            <span className="stage-running">
              <span className="spinner" aria-hidden="true" />
              {fill(t.stages.running, { elapsed: formatSeconds(elapsed, lang) })}
            </span>
          );
        } else if (s.state === "done") {
          status = (
            <span className="label">
              <span aria-hidden="true">✓ </span>
              {fill(t.stages.done, { seconds: (s.seconds ?? 0).toFixed(1) })}
            </span>
          );
        } else if (s.state === "skipped") {
          status = (
            <span className="label">
              <span aria-hidden="true">✓ </span>
              {t.stages.skipped}
            </span>
          );
        } else if (s.state === "reused") {
          status = (
            <span className="label">
              <span aria-hidden="true">✓ </span>
              {t.stages.reused}
            </span>
          );
        } else if (s.state === "stopped") {
          status = (
            <span className="label">
              <span aria-hidden="true">✕ </span>
              {t.stages.stopped}
            </span>
          );
        } else if (s.state === "lost") {
          status = (
            <span className="label">
              <span aria-hidden="true">⚠ </span>
              {t.stages.lost}
            </span>
          );
        }
        const found = stage === "relisten" ? view.relisten : null;
        return (
          <li key={stage} className={`stage ${s.state}${found ? " has-detail" : ""}`}>
            <span>{t.stages[stage]}</span>
            {status}
            {found ? (
              <small className="stage-detail">
                {found.soundless
                  ? t.stages.relistenSoundless
                  : found.wordsFound > 0
                    ? fill(t.stages.relistenFound, {
                        gaps: found.gapsChecked,
                        words: found.wordsFound,
                        blocked: formatSeconds(found.blockedSeconds, lang),
                      })
                    : found.gapsChecked === 0
                      ? t.stages.relistenNone
                      : fill(t.stages.relistenQuiet, { gaps: found.gapsChecked })}
              </small>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function FitMeter({ cue }: { cue: Cue }) {
  const { t, lang } = useI18n();
  const room = cue.windowEnd - cue.start;
  const measured = cue.seconds ?? cue.versions[cue.versions.length - 1].voice?.seconds;
  if (measured === undefined) return null;
  // The version history prints the recorded length; the meter rounds from the same 0.01 s value.
  const spoken = toRecordedSeconds(measured);
  const ratio = Math.min(1.2, spoken / room);
  return (
    <div className="fit">
      <div className="fit-bar" aria-hidden="true">
        <span
          className={`fit-fill${spoken > room ? " over" : ""}`}
          style={{ width: `${(ratio / 1.2) * 100}%` }}
        />
        <span className="fit-limit" style={{ left: `${(1 / 1.2) * 100}%` }} />
      </div>
      <div className="fit-legend label">
        <span>
          {t.line.spoken} {formatSeconds(spoken, lang)}
          {cue.rate && cue.rate !== 1 ? ` · ${fill(t.line.rate, { rate: cue.rate })}` : ""}
        </span>
        <span>
          {t.line.room} {formatSeconds(room, lang)}
        </span>
      </div>
    </div>
  );
}

const VERDICT_ICON = { pass: "✓", fixed: "↺", fail: "✗", removed: "−" } as const;

/** One sentence on how the line got here, so the history below reads as evidence, not a puzzle. */
function Verdict({ cue }: { cue: Cue }) {
  const { t } = useI18n();
  const v = t.line.verdict;
  const versions = cue.versions;
  const last = versions[versions.length - 1];
  const rejected = versions.filter((x) => x.review && !x.review.pass);
  const shortened = versions.some((x) => x.by === "shorten");
  let tone: "pass" | "fixed" | "fail" | "removed";
  let text: string;
  if (cue.status === "removed") {
    // An editor's decision, not a failed check: a neutral chip.
    tone = "removed";
    text = t.line.by.remove;
  } else if (cue.status === "dropped") {
    tone = "fail";
    text = cue.droppedReason ? t.line.dropped[cue.droppedReason] : t.line.state.dropped;
  } else if (!last.review?.pass) {
    return null;
  } else if (rejected.length === 0) {
    tone = "pass";
    text = shortened ? `${v.firstPass}, ${v.shortened}` : v.firstPass;
  } else {
    tone = "fixed";
    const head =
      rejected.length === 1
        ? sentBackByFinalCheck(rejected[0])
          ? v.sentBack
          : v.rejectedOnce
        : rejected.length === 2
          ? v.rejectedTwice
          : fill(v.rejectedMany, { n: rejected.length });
    const tail =
      last.by === "human"
        ? v.byEditor
        : rejected.some((x) => x.text === last.text)
          ? v.sameWords
          : v.rewritten;
    text = `${head}, ${tail}`;
  }
  return (
    <p className={`verdict-chip ${tone}`}>
      <span aria-hidden="true">{VERDICT_ICON[tone]}</span>
      {text}
    </p>
  );
}

/**
 * One line: its words, one sentence on how it got here, whether it fits, every version with the
 * reviewer's findings, and only then the form to edit it.
 */
export function LineDetail({
  cue,
  lineNumber,
  language,
  onPlay,
  evidence,
  editor,
}: {
  cue: Cue;
  lineNumber: number;
  language: Language | null;
  onPlay: () => void;
  evidence?: string;
  editor: React.ReactNode;
}) {
  const { t, lang } = useI18n();
  const latest = cue.versions[cue.versions.length - 1];
  const outOfTrack = cue.status === "dropped" || cue.status === "removed";
  const heading = useRef<HTMLHeadingElement>(null);
  // Moving focus to the heading tells keyboard and screen-reader users where the details went; the
  // view follows it on purpose. On a wide screen the inspector scrolls on its own and starts each
  // line at its top. Where it is stacked under the player and the timeline (phones, tablets, 200%
  // zoom), the page scrolls to it, so "Back to the run" stays in view above the heading.
  useEffect(() => {
    const h = heading.current;
    if (!h) return;
    h.focus({ preventScroll: true });
    const panel = h.closest<HTMLElement>(".ws-inspector");
    if (!panel) return;
    panel.scrollTop = 0;
    const box = h.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) panel.scrollIntoView({ block: "start" });
  }, [cue.id]);
  return (
    <div className="line-detail">
      <div className="line-head">
        <h2 className="line-heading label mono" tabIndex={-1} ref={heading}>
          {fill(t.line.title, { n: lineNumber })} · {formatClock(cue.start)}
        </h2>
        <button type="button" className="button ghost small" onClick={onPlay}>
          <span aria-hidden="true">▶</span> {t.line.play}
        </button>
      </div>
      <p className={`line-text${outOfTrack ? " struck" : ""}`} lang={language ?? undefined}>
        {latest.text}
      </p>
      <Gloss text={latest.text} pageLang={lang} textLang={language} />
      <Verdict cue={cue} />
      {outOfTrack ? null : <FitMeter cue={cue} />}
      <h3 className="inspector-heading">{t.line.history}</h3>
      <VersionHistory cue={cue} language={language} />
      {editor}
      {/* The model's own scene memo is in its working language, so it stays folded until asked for. */}
      {evidence ? (
        <details className="scene-evidence">
          <summary className="inspector-heading">{t.line.evidence}</summary>
          <p>{evidence}</p>
        </details>
      ) : null}
    </div>
  );
}
