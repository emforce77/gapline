"use client";

import { fill } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { ActiveRun, LiveStatus } from "@/lib/api-contract";
import { liveStatusMessage } from "@/lib/client/api-errors";
import type { Connection } from "@/lib/client/use-live-run";
import { formatSeconds } from "@/lib/format";
import { assessRoom } from "@/lib/pipeline/gaps";
import type { RunView } from "@/lib/pipeline/reduce";
import { languageName } from "./labels";
import styles from "./LiveRunNotices.module.css";

type Room = { gapSeconds: number; thresholdSeconds: number };

/**
 * Whether to warn that the clip leaves little room. `view` is the run shown (live or finished), and
 * `shown` what the timeline draws. Before any run the saved analysis tells; during a run only its
 * little_room event does (the gaps are not known before it); a finished older run predates the
 * event, so its gaps are assessed here.
 */
export function littleRoomOf(
  view: RunView | null,
  shown: RunView | null,
  hasAnalysis: boolean,
  clipSeconds: number,
): Room | null {
  if (!shown) return null;
  if (shown.littleRoom) return shown.littleRoom;
  const known = view === null ? hasAnalysis : view.summary !== null;
  if (!known) return null;
  const room = assessRoom(shown.gaps, clipSeconds);
  return room.little ? room : null;
}

/**
 * What the viewer should know around a live run: that a dropped connection is being recovered, that
 * a run they started is still going, that a new run cannot start right now, or that the clip leaves
 * little room to describe. Nothing renders when there is nothing to say.
 */
export function LiveRunNotices({
  connection,
  active,
  status,
  showStatus,
  littleRoom,
  busy,
  onFollow,
}: {
  connection: Connection | null;
  active: ActiveRun[];
  status: LiveStatus | null;
  /** False while a run is live or an error already explains why none can start. */
  showStatus: boolean;
  littleRoom: Room | null;
  busy: boolean;
  onFollow: (runId: string) => void;
}) {
  const { t, lang } = useI18n();
  const clock = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" });
  const refused = showStatus && status && !status.canStart && status.reason ? status : null;
  const followable = busy ? [] : active;
  if (!connection && !followable.length && !refused && !littleRoom) return null;

  return (
    <div className={styles.notices}>
      {connection === "stream" ? (
        <p className={`${styles.notice} ${styles.quiet}`}>{t.live.leaveNote}</p>
      ) : null}
      {connection === "lost" || connection === "resumed" ? (
        <p className={styles.notice} role="status">
          <span className="spinner" aria-hidden="true" />
          <span className={styles.text}>
            {connection === "lost" ? t.live.lost : t.live.following}
          </span>
        </p>
      ) : null}
      {followable.map((run) => (
        <p key={run.runId} className={styles.notice}>
          <span className={styles.text}>
            {fill(t.live.active, {
              language: languageName(run.language, lang),
              time: clock.format(new Date(run.startedAt)),
            })}
          </span>
          <button type="button" className="button small" onClick={() => onFollow(run.runId)}>
            {t.live.follow}
          </button>
        </p>
      ))}
      {refused?.reason ? (
        <p className={styles.notice} role="status">
          <span className={styles.text}>
            {liveStatusMessage(refused.reason, refused.resetAt, t.live.status, t, lang)}
          </span>
        </p>
      ) : null}
      {littleRoom ? (
        <p className={`${styles.notice} ${styles.room}`}>
          <span className={styles.text}>
            {fill(t.live.littleRoom, {
              room: formatSeconds(littleRoom.gapSeconds, lang),
              needed: formatSeconds(littleRoom.thresholdSeconds, lang),
            })}
          </span>
        </p>
      ) : null}
    </div>
  );
}
