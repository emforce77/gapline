"use client";

import { useEffect, useState } from "react";
import { fill } from "@/i18n";
import { useI18n } from "@/i18n/client";
import type { ActiveRun, LiveStatus } from "@/lib/api-contract";
import { liveStatusNotice } from "@/lib/client/api-errors";
import type { Connection } from "@/lib/client/use-live-run";
import { formatDuration, formatSeconds } from "@/lib/format";
import { assessRoom, MIN_GAP_SECONDS, SPEECH_GUARD_SECONDS } from "@/lib/pipeline/gaps";
import type { RunView } from "@/lib/pipeline/reduce";
import { languageName } from "./labels";
import { runClockSeconds } from "./run-choice";
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

/** The shortest pause a line can go in: a usable silence plus the margin kept around each word. */
const SHORTEST_PAUSE_SECONDS = MIN_GAP_SECONDS + 2 * SPEECH_GUARD_SECONDS;
const TICK_MS = 1_000;

/** Seconds since `startedAt`, ticking once a second while it is set. */
function useSecondsSince(startedAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  return startedAt ? Math.max(0, Math.floor((now - Date.parse(startedAt)) / TICK_MS)) : 0;
}

/**
 * How long the live run has been going (runClockSeconds), ticking once a second. `runSeconds` is
 * its latest event's time, `startedAt` when it started; null when no run is live.
 */
function useRunClock(runSeconds: number | null, startedAt: string | null): number | null {
  const [anchor, setAnchor] = useState({ wall: 0, t: 0 });
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (runSeconds === null) return;
    const wall = Date.now();
    setAnchor({ wall, t: runSeconds });
    setNow(wall);
  }, [runSeconds]);
  const live = runSeconds !== null;
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [live]);
  return live ? runClockSeconds(anchor, now, startedAt) : null;
}

/**
 * What the viewer should know around a live run: that a dropped connection is being recovered (or
 * a lost start looked for), that a run or an edit they started is still going, that a new run
 * cannot start right now, or that the clip leaves little room to describe. Nothing renders when
 * there is nothing to say.
 */
export function LiveRunNotices({
  connection,
  active,
  status,
  showStatus,
  littleRoom,
  busy,
  pendingEdit,
  runSeconds,
  runStartedAt,
  onFollow,
}: {
  connection: Connection | null;
  active: ActiveRun[];
  status: LiveStatus | null;
  /** False while a run is live or an error already explains why none can start. */
  showStatus: boolean;
  littleRoom: Room | null;
  busy: boolean;
  /** An edit started before a reload that is still being made: its line ("Line 3") and start. */
  pendingEdit: { line: string; startedAt: string } | null;
  /** While a run is live, the time of its latest event (seconds since it started); else null. */
  runSeconds: number | null;
  /** When the live run started (server time), when known. */
  runStartedAt: string | null;
  onFollow: (runId: string) => void;
}) {
  const { t, lang } = useI18n();
  const editSeconds = useSecondsSince(pendingEdit?.startedAt ?? null);
  const runClock = useRunClock(runSeconds, runStartedAt);
  const clock = new Intl.DateTimeFormat(lang, { hour: "numeric", minute: "2-digit" });
  const followable = busy ? [] : active;
  // This visitor's other run or edit: when it is one of this clip's, its own notice says so.
  const ownShown = followable.length > 0 || pendingEdit !== null;
  const refused =
    showStatus && status && !(status.visitor === "visitor_busy" && !status.reason && ownShown)
      ? liveStatusNotice(status, t, lang)
      : null;
  if (!connection && !followable.length && !refused && !littleRoom && !pendingEdit) return null;

  return (
    <div className={styles.notices}>
      {runClock !== null ? (
        <p className={styles.notice}>
          <span className={styles.text}>
            {fill(t.live.elapsed, { elapsed: formatDuration(runClock, lang) })}
          </span>
        </p>
      ) : null}
      {connection === "stream" ? (
        <p className={`${styles.notice} ${styles.quiet}`}>{t.live.leaveNote}</p>
      ) : null}
      {connection === "lost" || connection === "resumed" || connection === "confirming" ? (
        <p className={styles.notice} role="status">
          <span className="spinner" aria-hidden="true" />
          <span className={styles.text}>
            {connection === "lost"
              ? t.live.lost
              : connection === "confirming"
                ? t.live.confirming
                : t.live.following}
          </span>
        </p>
      ) : null}
      {pendingEdit ? (
        <p className={styles.notice}>
          <span className="spinner" aria-hidden="true" />
          {/* Only the sentence is a live region: the counter beside it changes every second, and
              in the region it would be said again each time. */}
          <span className={styles.text} role="status">
            {fill(t.live.editPending, { line: pendingEdit.line })}
          </span>
          <span className={styles.quiet}>
            {fill(t.live.editPendingElapsed, { elapsed: formatDuration(editSeconds, lang) })}
          </span>
        </p>
      ) : null}
      {followable.map((run) => (
        <p key={run.runId} className={styles.notice}>
          <span className={styles.text}>
            {fill(t.live.active, {
              density: (run.density === "brief"
                ? t.workspace.densityBrief
                : t.workspace.densityStandard
              ).toLocaleLowerCase(lang),
              language: languageName(run.language, lang),
              time: clock.format(new Date(run.startedAt)),
            })}
          </span>
          <button type="button" className="button small" onClick={() => onFollow(run.runId)}>
            {t.live.follow}
          </button>
        </p>
      ))}
      {refused ? (
        <p className={styles.notice} role="status">
          <span className={styles.text}>{refused}</span>
        </p>
      ) : null}
      {littleRoom ? (
        <p className={`${styles.notice} ${styles.room}`}>
          <span className={styles.text}>
            {fill(t.live.littleRoom, {
              room: formatSeconds(littleRoom.gapSeconds, lang),
              needed: formatSeconds(littleRoom.thresholdSeconds, lang),
              pause: formatSeconds(SHORTEST_PAUSE_SECONDS, lang),
            })}
          </span>
        </p>
      ) : null}
    </div>
  );
}
