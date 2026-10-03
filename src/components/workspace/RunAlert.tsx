"use client";

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
 * now), check again on a lost run, or load the shown result again.
 */
export function RunAlert({
  alert,
  onRetry,
  onCheckAgain,
  onReload,
}: {
  alert: Alert;
  onRetry: (() => void) | null;
  onCheckAgain: (runId: string) => void;
  onReload: () => void;
}) {
  const { t } = useI18n();
  const lost = alert.lostRunId;
  return (
    <div className="ws-error run-error">
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
