"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";
import { fill } from "@/i18n";
import { formatClock, formatSeconds } from "@/lib/format";
import { GUIDELINE_RULES } from "@/lib/pipeline/guidelines";
import { STAGES, type RunView } from "@/lib/pipeline/reduce";
import type { Cue } from "@/lib/pipeline/schemas";

const RULES = new Map(GUIDELINE_RULES.map((r) => [r.id, r]));

/**
 * Stage list with elapsed time for the running stage. clockRate is 1 while live, the replay speed
 * during a replay, and 0 for a finished run.
 */
export function StageList({ view, clockRate }: { view: RunView; clockRate: number }) {
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
  const runClock = clockRate > 0 ? anchor.t + ((now - anchor.wall) / 1000) * clockRate : view.t;

  return (
    <ol className="stages">
      {STAGES.map((stage) => {
        const s = view.stages[stage];
        const label = t.stages[stage];
        let status: React.ReactNode = <span className="label">{t.stages.waiting}</span>;
        if (s.state === "running") {
          const elapsed = Math.max(0, runClock - (s.startedAt ?? runClock));
          status = (
            <span className="stage-running">
              <span className="spinner" />
              {fill(t.stages.running, { elapsed: formatSeconds(elapsed, lang) })}
            </span>
          );
        } else if (s.state === "done") {
          status = (
            <span className="label">
              ✓ {fill(t.stages.done, { seconds: (s.seconds ?? 0).toFixed(1) })}
            </span>
          );
        } else if (s.state === "reused") {
          status = <span className="label">✓ {t.stages.reused}</span>;
        }
        return (
          <li key={stage} className={`stage ${s.state}`}>
            <span>{label}</span>
            {status}
          </li>
        );
      })}
    </ol>
  );
}

function FitMeter({ cue }: { cue: Cue }) {
  const { t, lang } = useI18n();
  const room = cue.windowEnd - cue.start;
  const spoken = cue.seconds ?? cue.versions[cue.versions.length - 1].voice?.seconds;
  if (spoken === undefined) return null;
  const ratio = Math.min(1.2, spoken / room);
  return (
    <div className="fit">
      <div className="fit-bar">
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

/** One line: its final words, whether it fits, and every version with the reviewer's findings. */
export function LineDetail({ cue, onPlay }: { cue: Cue; onPlay: () => void }) {
  const { t, lang } = useI18n();
  const latest = cue.versions[cue.versions.length - 1];
  return (
    <div className="line-detail">
      <div className="line-head">
        <span className="label mono">
          {fill(t.line.title, { id: cue.id })} · {formatClock(cue.start)}
        </span>
        <button type="button" className="button ghost small" onClick={onPlay}>
          ▶ {t.line.play}
        </button>
      </div>
      <p className={`line-text${cue.status === "dropped" ? " struck" : ""}`}>{latest.text}</p>
      {cue.status === "dropped" && cue.droppedReason ? (
        <p className="line-dropped">⚠ {t.line.dropped[cue.droppedReason]}</p>
      ) : (
        <FitMeter cue={cue} />
      )}
      <h4>{t.line.history}</h4>
      <ol className="versions">
        {cue.versions.map((version, i) => (
          <li key={i} className="version">
            <div className="version-head label">
              <span className="mono">v{i + 1}</span> {t.line.by[version.by]}
            </div>
            <p className="version-text">{version.text}</p>
            {version.review ? (
              version.review.pass ? (
                <p className="verdict pass">✓ {t.line.passed}</p>
              ) : (
                <div className="verdict fail">
                  <p>✗ {t.line.rejected}</p>
                  <ul>
                    {version.review.violations.map((v, j) => {
                      const rule = RULES.get(v.rule);
                      return (
                        <li key={j}>
                          <strong>{rule?.title[lang] ?? v.rule}</strong>
                          <span className="quote">“{v.quote}”</span>
                          <span>{v.reason}</span>
                          <span className="label">{rule?.source[lang]}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {version.review.fix ? (
                    <p className="fix">
                      {t.line.fix}: {version.review.fix}
                    </p>
                  ) : null}
                </div>
              )
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
