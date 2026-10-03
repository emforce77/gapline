"use client";

import { useEffect, useRef } from "react";
import { useI18n } from "@/i18n/client";

/**
 * The alert under the player. `ownFailure`: it is the stopped run's own reason (not a refused start
 * or a load error), the only case a retry of that run answers; only then does the notice on whether
 * a run could start show beside it, since a refusal already says why none can. `lostRunId`: the page
 * stopped checking on that run because the server could not be reached. `reload`: the shown result
 * did not load, and asking again may work. Those three belong to the result on screen and go with
 * it; the rest (a refused start, a link to a run that is not here) stay until the viewer acts.
 */
export interface Alert {
  message: string;
  ownFailure: boolean;
  lostRunId?: string;
  reload?: boolean;
}

/**
 * The alert and what can be done about it: try the stopped run again (`onRetry`, when it may work
 * now), check again on a lost run, or load the shown result again. It sits under the player; where
 * the run panel stacks below the player (a phone or tablet), the Generate button pressed is far
 * below it, so a new message out of view is scrolled to, once the page around it has its layout
 * back (`settled`: no run shown live; a refused start says why while its live view is still up, and
 * the result coming back then moves the page). Focus stays where it was: role="alert" already says
 * the message.
 */
export function RunAlert({
  alert,
  onRetry,
  onCheckAgain,
  onReload,
  settled,
}: {
  alert: Alert;
  settled: boolean;
  onRetry: (() => void) | null;
  onCheckAgain: (runId: string) => void;
  onReload: () => void;
}) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el || !settled) return;
    const { top, bottom } = el.getBoundingClientRect();
    if (bottom < 0 || top > window.innerHeight) el.scrollIntoView({ block: "center" });
  }, [alert.message, settled]);
  const lost = alert.lostRunId;
  return (
    <div className="ws-error run-error" ref={box}>
      <p role="alert">
        <span aria-hidden="true">⚠ </span>
        {alert.message}
      </p>
      {onRetry ? (
        <button type="button" className="button small" onClick={onRetry}>
          <span aria-hidden="true">↻</span> {t.live.retry}
        </button>
      ) : null}
      {lost ? (
        <button type="button" className="button small" onClick={() => onCheckAgain(lost)}>
          <span aria-hidden="true">↻</span> {t.live.checkAgain}
        </button>
      ) : null}
      {alert.reload ? (
        <button type="button" className="button small" onClick={onReload}>
          <span aria-hidden="true">↻</span> {t.live.retry}
        </button>
      ) : null}
    </div>
  );
}
