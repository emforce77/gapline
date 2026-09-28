"use client";

import { useEffect, useRef, useState } from "react";
import { formatClock } from "@/lib/format";

export interface NarrationLine {
  start: number;
  end: number;
  text: string;
  gloss?: string;
}

export interface NarrationTrack {
  language: "en" | "ko";
  /** The language's own name ("English", "한국어"), shown on its button. */
  name: string;
  describedUrl: string;
  lines: NarrationLine[];
}

type Version = "original" | "described";

/**
 * The landing's proof: one short window of the sample, played as the film's own soundtrack or with
 * Gapline's description, from the same media the workspace uses. Playback stops at the window's end.
 */
export function SevenSeconds({
  originalUrl,
  tracks,
  windowStart,
  windowEnd,
  labels,
}: {
  originalUrl: string;
  tracks: NarrationTrack[];
  windowStart: number;
  windowEnd: number;
  labels: {
    original: string;
    described: string;
    narration: string;
    hidePicture: string;
    idle: string;
    soundtrack: string;
    waiting: string;
    pause: string;
  };
}) {
  const video = useRef<HTMLVideoElement>(null);
  const pendingPlay = useRef(false);
  const [version, setVersion] = useState<Version | null>(null);
  const [trackIndex, setTrackIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(windowStart);
  const [hidden, setHidden] = useState(false);
  const track = tracks[trackIndex];
  const src =
    version === "described" ? track.describedUrl : `${originalUrl}#t=${windowStart.toFixed(1)}`;

  // Poll while playing: timeupdate fires only every ~250 ms, too coarse to stop on the window's end.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      const el = video.current;
      if (!el) return;
      if (el.currentTime >= windowEnd) {
        el.pause();
        el.currentTime = windowStart;
        setTime(windowEnd);
        return;
      }
      setTime(el.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, windowStart, windowEnd]);

  function startFromWindow(el: HTMLVideoElement) {
    if (el.currentTime < windowStart || el.currentTime >= windowEnd - 0.05) {
      el.currentTime = windowStart;
    }
    void el.play();
  }

  function press(next: Version, nextTrack = trackIndex) {
    const el = video.current;
    if (!el) return;
    if (next === version && nextTrack === trackIndex && playing) {
      el.pause();
      return;
    }
    const nextSrc =
      next === "described"
        ? tracks[nextTrack].describedUrl
        : `${originalUrl}#t=${windowStart.toFixed(1)}`;
    setVersion(next);
    setTrackIndex(nextTrack);
    if (nextSrc === src) {
      startFromWindow(el);
      return;
    }
    // The new source starts loading after this render; onLoadedMetadata seeks and plays it.
    el.pause();
    pendingPlay.current = true;
  }

  const spoken =
    version === "described" ? track.lines.find((l) => time >= l.start && time <= l.end) : undefined;
  const progress = Math.min(1, Math.max(0, (time - windowStart) / (windowEnd - windowStart)));
  const pct = (s: number) => `${((s - windowStart) / (windowEnd - windowStart)) * 100}%`;

  return (
    <div className="seven">
      <div className={`seven-frame${hidden ? " hidden" : ""}`}>
        <video
          ref={video}
          src={src}
          preload="auto"
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => {
            if (!pendingPlay.current) return;
            pendingPlay.current = false;
            startFromWindow(e.currentTarget);
          }}
        />
      </div>
      <div className="seven-caption" aria-live="off">
        {version === null ? (
          <span className="idle">{labels.idle}</span>
        ) : version === "original" ? (
          <span className="idle">{labels.soundtrack}</span>
        ) : spoken ? (
          <>
            <span className="narration" lang={track.language}>
              {spoken.text}
            </span>
            {spoken.gloss ? <span className="gloss">{spoken.gloss}</span> : null}
          </>
        ) : (
          <span className="idle">{labels.waiting}</span>
        )}
      </div>
      <div className="seven-window" aria-hidden="true">
        {track.lines.map((l) => (
          <span
            key={l.start}
            className={`seven-line${version === "described" ? " on" : ""}`}
            style={{ left: pct(l.start), width: pct(windowStart + (l.end - l.start)) }}
          />
        ))}
        <span className="seven-head" style={{ left: `${progress * 100}%` }} />
      </div>
      <div className="seven-scale mono" aria-hidden="true">
        <span>{formatClock(windowStart)}</span>
        <span>{formatClock(windowEnd)}</span>
      </div>
      <div className="seven-controls">
        {(["original", "described"] as Version[]).map((v) => {
          const active = version === v && playing;
          return (
            <button
              key={v}
              type="button"
              className={`button${v === "described" ? " primary" : ""}`}
              aria-pressed={active}
              onClick={() => press(v)}
            >
              <span aria-hidden="true">{active ? "❚❚" : "▶"}</span>
              {active ? `${labels.pause}` : v === "original" ? labels.original : labels.described}
            </button>
          );
        })}
      </div>
      <div className="seven-options">
        {tracks.length > 1 ? (
          <div className="segmented" role="group" aria-label={labels.narration}>
            {tracks.map((tr, i) => (
              <button
                key={tr.language}
                type="button"
                lang={tr.language}
                aria-pressed={i === trackIndex}
                onClick={() => (version === "described" ? press("described", i) : setTrackIndex(i))}
              >
                {tr.name}
              </button>
            ))}
          </div>
        ) : null}
        <label className="switch">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          {labels.hidePicture}
        </label>
      </div>
    </div>
  );
}
