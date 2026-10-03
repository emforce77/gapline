"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { fill } from "@/i18n";
import { formatClock } from "@/lib/format";
import type { Cue, Gap, SpeechSegment } from "@/lib/pipeline/schemas";
import { PictureLane } from "../PictureLane";
import { LANE_GAP_PX, stackCueBoxes } from "./lanes";

const RULER_STEP_SECONDS = 5;
/** Every second tick is hidden on narrow screens, so labels never touch. */
const MAJOR_TICK_SECONDS = 10;
/** Rooms drawn narrower than this have no space for their length label ("11.9 s" is about 30 px). */
const ROOM_LABEL_MIN_PX = 40;
/** Smallest cue target with a mouse (WCAG 2.5.8); timeline.css reads it as --cue-min. */
const CUE_MIN_PX = 24;
/** On a touch screen boxes grow and lanes spread toward 44 px targets (WCAG 2.5.5). */
const CUE_MIN_TOUCH_PX = 36;
const LANE_GAP_TOUCH_PX = 8;
/** Distance between stacked lanes: a box and the space under it. */
const LANE_PITCH_PX = 26;
const LANE_PITCH_TOUCH_PX = 44;

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

/** Whether the main pointer is a finger; false until the browser says so. */
function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return coarse;
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
 * as an outlined box with its narration inside, so "fits between the lines" is literally visible. The
 * speech row is labelled as recognized: its words are the recognizer's, slips included. On a touch
 * screen the line boxes are larger and their lanes further apart; a mouse keeps the dense layout.
 */
export function Timeline({
  clipSeconds,
  stripUrl,
  stripStepSeconds,
  speech,
  soundless,
  gaps,
  cues,
  lineNumbers,
  currentTime,
  selectedCueId,
  disabled = false,
  onSeek,
  onSelect,
}: {
  clipSeconds: number;
  stripUrl: string;
  /** Seconds covered by each thumbnail in the strip (Project.stripStepSeconds). */
  stripStepSeconds: number;
  speech: SpeechSegment[];
  /** The clip's soundtrack is silent or missing (the run's re-listen says so). */
  soundless: boolean;
  gaps: Gap[];
  cues: Cue[];
  lineNumbers: Map<string, number>;
  currentTime: number;
  selectedCueId: string | null;
  disabled?: boolean;
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
  const touch = useCoarsePointer();
  const cueMin = touch ? CUE_MIN_TOUCH_PX : CUE_MIN_PX;
  const perSecond = rowWidth / clipSeconds;
  const { lanes, count: laneCount } = stackCueBoxes(
    rowWidth
      ? cues.map((cue) => {
          const left = Math.max(0, Math.min(cue.start * perSecond, rowWidth - cueMin));
          const spoken = cue.seconds ?? cue.windowEnd - cue.start;
          return { id: cue.id, left, right: left + Math.max(cueMin, spoken * perSecond) };
        })
      : [],
    touch ? LANE_GAP_TOUCH_PX : LANE_GAP_PX,
  );
  const relistened = speech.some((s) => s.heard === "relisten");

  const seekFromEvent = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onSeek(((event.clientX - rect.left) / rect.width) * clipSeconds);
  };

  return (
    <div
      className={`timeline${laneCount > 1 || touch ? " stacked" : ""}`}
      style={
        {
          "--lanes": laneCount,
          "--cue-min": `${cueMin}px`,
          "--lane-pitch": `${touch ? LANE_PITCH_TOUCH_PX : LANE_PITCH_PX}px`,
        } as React.CSSProperties
      }
    >
      <div className="tl-labels" aria-hidden="true">
        <span />
        <span>{t.timeline.picture}</span>
        <span className="tl-label-speech">
          {t.timeline.dialogue}
          <small>{t.timeline.recognized}</small>
        </span>
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
        <PictureLane
          className="tl-track tl-picture"
          stripUrl={stripUrl}
          clipSeconds={clipSeconds}
          stepSeconds={stripStepSeconds}
        />
        {/* Only re-listened words are named; the group says what they are. */}
        <div
          className="tl-track"
          {...(relistened ? { role: "group", "aria-label": t.workspace.dialogue } : {})}
        >
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
          {soundless ? <span className="tl-soundless">{t.timeline.soundless}</span> : null}
        </div>
        <div
          className="tl-track tl-narration"
          ref={narrationRow}
          role="group"
          aria-label={t.timeline.narration}
        >
          {gaps.map((g) => (
            <span
              key={g.id}
              className="tl-room"
              style={{ left: pct(g.start), width: pct(g.end - g.start) }}
              aria-hidden="true"
            >
              {(g.end - g.start) * perSecond >= ROOM_LABEL_MIN_PX ? (
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
                disabled={disabled}
                data-cue-id={cue.id}
                className={`cue ${state}${cue.id === selectedCueId ? " selected" : ""}${speaking ? " speaking" : ""}`}
                style={
                  {
                    left: `min(${pct(cue.start)}, calc(100% - ${cueMin}px))`,
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

/** The same lines as a list, in time order: easier than the timeline's boxes on a phone. */
export function CuePicker({
  cues,
  lineNumbers,
  language,
  selectedCueId,
  disabled,
  describedBy,
  onSelect,
}: {
  cues: Cue[];
  lineNumbers: Map<string, number>;
  language: string;
  selectedCueId: string | null;
  disabled: boolean;
  /** The id of the hint that says how to open a line from the list. */
  describedBy?: string;
  onSelect: (cueId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <label className="cue-picker">
      {t.editor.chooseLine}
      <select
        value={selectedCueId ?? ""}
        aria-describedby={describedBy}
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
              {cue.status === "removed" || cue.status === "dropped"
                ? ` · ${t.line.state[cue.status]}`
                : null}
            </option>
          ))}
      </select>
    </label>
  );
}
