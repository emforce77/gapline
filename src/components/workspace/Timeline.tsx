"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { fill } from "@/i18n";
import { formatClock } from "@/lib/format";
import type { Cue, Gap, SpeechSegment } from "@/lib/pipeline/schemas";
import { stackCueBoxes } from "./lanes";

const RULER_STEP_SECONDS = 5;
/** Every second tick is hidden on narrow screens, so labels never touch. */
const MAJOR_TICK_SECONDS = 10;
/** Rooms narrower than this have no space for their length label. */
const ROOM_LABEL_MIN_SECONDS = 2.5;
/** Smallest cue target (WCAG 2.5.8); matches min-width in timeline.css. */
const CUE_MIN_PX = 24;

type CueState = "fits" | "approved" | "rejected" | "dropped" | "removed" | "pending";

/** The element's width in CSS pixels, 0 until it has been laid out. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function cueState(cue: Cue): CueState {
  const latest = cue.versions[cue.versions.length - 1];
  if (cue.status === "dropped") return "dropped";
  if (cue.status === "removed") return "removed";
  if (cue.status === "fits") return "fits";
  if (latest.review && !latest.review.pass) return "rejected";
  if (cue.status === "approved") return "approved";
  return "pending";
}

/**
 * Picture, dialogue and narration on one time axis; click anywhere to seek. Each room to speak is drawn
 * as an outlined box with its narration inside, so "fits between the lines" is literally visible.
 */
export function Timeline({
  clipSeconds,
  stripUrl,
  speech,
  gaps,
  cues,
  lineNumbers,
  currentTime,
  selectedCueId,
  onSeek,
  onSelect,
}: {
  clipSeconds: number;
  stripUrl: string;
  speech: SpeechSegment[];
  gaps: Gap[];
  cues: Cue[];
  lineNumbers: Map<string, number>;
  currentTime: number;
  selectedCueId: string | null;
  onSeek: (seconds: number) => void;
  onSelect: (cueId: string) => void;
}) {
  const { t } = useI18n();
  const pct = (s: number) => `${(Math.max(0, Math.min(s, clipSeconds)) / clipSeconds) * 100}%`;
  const ticks = Array.from(
    { length: Math.floor(clipSeconds / RULER_STEP_SECONDS) + 1 },
    (_, i) => i * RULER_STEP_SECONDS,
  );

  // Where each box lands on screen (same rules as the CSS below), so close lines can stack.
  const [narrationRow, rowWidth] = useWidth<HTMLDivElement>();
  const perSecond = rowWidth / clipSeconds;
  const { lanes, count: laneCount } = stackCueBoxes(
    rowWidth
      ? cues.map((cue) => {
          const left = Math.max(0, Math.min(cue.start * perSecond, rowWidth - CUE_MIN_PX));
          const spoken = cue.seconds ?? cue.windowEnd - cue.start;
          return { id: cue.id, left, right: left + Math.max(CUE_MIN_PX, spoken * perSecond) };
        })
      : [],
  );

  const seekFromEvent = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(((event.clientX - rect.left) / rect.width) * clipSeconds);
  };

  return (
    <div
      className={`timeline${laneCount > 1 ? " stacked" : ""}`}
      style={{ "--lanes": laneCount } as React.CSSProperties}
    >
      <div className="tl-labels" aria-hidden="true">
        <span />
        <span>{t.timeline.picture}</span>
        <span>{t.timeline.dialogue}</span>
        <span className="tl-label-room">
          <small>{t.timeline.room}</small>
          {t.timeline.narration}
        </span>
      </div>
      <div className="tl-body" onClick={seekFromEvent} role="presentation">
        <div className="tl-ruler" aria-hidden="true">
          {ticks.map((s) => (
            <span
              key={s}
              className={`tl-tick mono${s % MAJOR_TICK_SECONDS ? " minor" : ""}`}
              style={{ left: pct(s) }}
            >
              {s}
            </span>
          ))}
        </div>
        <div
          className="tl-track tl-picture"
          style={{ backgroundImage: `url(${stripUrl})` }}
          aria-hidden="true"
        />
        <div className="tl-track">
          {speech.map((s, i) => {
            const style = { left: pct(s.start), width: pct(s.end - s.start) };
            if (s.heard !== "relisten")
              return (
                <span key={i} className="tl-dialogue" style={style} title={s.text} aria-hidden />
              );
            // Words the first pass missed or misplaced: named for screen readers, drawn hatched.
            const label = fill(t.timeline.relistenSpeech, {
              from: formatClock(s.start),
              to: formatClock(s.end),
              text: s.text,
            });
            return (
              <span
                key={i}
                role="img"
                className="tl-dialogue relisten"
                style={style}
                title={label}
                aria-label={label}
              />
            );
          })}
        </div>
        <div className="tl-track tl-narration" ref={narrationRow}>
          {gaps.map((g) => (
            <span
              key={g.id}
              className="tl-room"
              style={{ left: pct(g.start), width: pct(g.end - g.start) }}
              aria-hidden="true"
            >
              {g.end - g.start >= ROOM_LABEL_MIN_SECONDS ? (
                <span className="tl-room-label">
                  {fill(t.timeline.seconds, { n: (g.end - g.start).toFixed(1) })}
                </span>
              ) : null}
            </span>
          ))}
          {cues.map((cue) => {
            const spoken = cue.seconds ?? cue.windowEnd - cue.start;
            const state = cueState(cue);
            const speaking =
              state === "fits" && currentTime >= cue.start && currentTime <= cue.start + spoken;
            const line = fill(t.line.title, { n: lineNumbers.get(cue.id) ?? "" });
            return (
              <button
                key={cue.id}
                type="button"
                data-cue-id={cue.id}
                className={`cue ${state}${cue.id === selectedCueId ? " selected" : ""}${speaking ? " speaking" : ""}`}
                style={
                  {
                    left: `min(${pct(cue.start)}, calc(100% - ${CUE_MIN_PX}px))`,
                    width: pct(spoken),
                    "--lane": lanes.get(cue.id) ?? 0,
                  } as React.CSSProperties
                }
                aria-pressed={cue.id === selectedCueId}
                aria-label={fill(t.line.cueLabel, {
                  line,
                  time: formatClock(cue.start),
                  state: t.line.state[state],
                })}
                title={
                  state === "removed"
                    ? `${t.line.by.remove}: ${cue.versions.at(-1)!.text}`
                    : cue.versions.at(-1)!.text
                }
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(cue.id);
                }}
              >
                <span className="cue-id mono">{lineNumbers.get(cue.id)}</span>
                {state === "rejected" ? <span aria-hidden="true"> ✗</span> : null}
              </button>
            );
          })}
        </div>
        <span className="tl-playhead" style={{ left: pct(currentTime) }} aria-hidden="true" />
      </div>
    </div>
  );
}

/** The same lines as a list, in time order: easier than 24 px targets on a phone. */
export function CuePicker({
  cues,
  lineNumbers,
  language,
  selectedCueId,
  disabled,
  onSelect,
}: {
  cues: Cue[];
  lineNumbers: Map<string, number>;
  language: string;
  selectedCueId: string | null;
  disabled: boolean;
  onSelect: (cueId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="cue-picker">
      {t.editor.chooseLine}
      <select
        value={selectedCueId ?? ""}
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
      >
        <option value="" disabled>
          —
        </option>
        {[...cues]
          .sort((a, b) => a.start - b.start)
          .map((cue) => (
            <option key={cue.id} value={cue.id} lang={language}>
              {fill(t.line.title, { n: lineNumbers.get(cue.id) ?? cue.id })} ·{" "}
              {cue.versions.at(-1)!.text}
              {cue.status === "removed" ? ` · ${t.line.state.removed}` : null}
            </option>
          ))}
      </select>
    </label>
  );
}
