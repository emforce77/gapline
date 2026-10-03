"use client";

import { useEffect, useRef, useState } from "react";
import { formatClock } from "@/lib/format";
import { PlayIcon } from "../PlayIcon";

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
type TrackLanguage = NarrationTrack["language"];

/** Screen readers hear "Loading" only for a wait a listener would notice, not a seek in buffered media. */
const ANNOUNCE_LOADING_AFTER_MS = 1_000;

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
    quiet: string;
    loading: string;
    paused: string;
    ended: string;
    failed: string;
    pause: string;
  };
}) {
  const video = useRef<HTMLVideoElement>(null);
  const pendingPlay = useRef(false);
  const [version, setVersion] = useState<Version | null>(null);
  // The visitor's narration, kept by language: the list is ordered by UI language, which a refresh
  // can change. Until they pick one or play the described version, the first (the UI's) stands.
  const [chosen, setChosen] = useState<TrackLanguage | null>(null);
  const [playing, setPlaying] = useState(false);
  // From a press until sound plays, and again whenever playback stops to wait for data.
  const [loading, setLoading] = useState(false);
  const [slowLoading, setSlowLoading] = useState(false);
  const [ended, setEnded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [time, setTime] = useState(windowStart);
  const [hidden, setHidden] = useState(false);
  const trackIn = (lang: TrackLanguage) => tracks.find((tr) => tr.language === lang);
  // A refresh can drop the chosen narration (its result was unpinned); the first one stands in.
  const track = (chosen && trackIn(chosen)) ?? tracks[0];
  const originalSrc = `${originalUrl}#t=${windowStart.toFixed(1)}`;
  const src = version === "described" ? track.describedUrl : originalSrc;

  // Poll while playing: timeupdate fires only every ~250 ms, too coarse to stop on the window's end.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = video.current?.currentTime ?? 0;
    const tick = () => {
      const el = video.current;
      if (!el) return;
      if (el.currentTime >= windowEnd) {
        el.pause();
        el.currentTime = windowStart;
        setTime(windowEnd);
        setEnded(true);
        return;
      }
      // Some engines (WebKit's GStreamer port) never fire `playing` after a seek's `waiting`; a clock
      // that moves forward means sound is playing. A stall stops the clock, so "Loading…" still shows.
      if (el.currentTime > last && !el.seeking) setLoading(false);
      last = el.currentTime;
      setTime(el.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, windowStart, windowEnd]);

  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => setSlowLoading(true), ANNOUNCE_LOADING_AFTER_MS);
    return () => {
      window.clearTimeout(timer);
      setSlowLoading(false);
    };
  }, [loading]);

  function startFromWindow(el: HTMLVideoElement) {
    if (el.currentTime < windowStart || el.currentTime >= windowEnd - 0.05) {
      el.currentTime = windowStart;
    }
    setTime(el.currentTime);
    el.play().catch((error: unknown) => {
      // A pause or a new source interrupts a pending play; that was the visitor's own choice.
      if (error instanceof DOMException && error.name === "AbortError") return;
      setLoading(false);
      throw error;
    });
    // play() unpauses at once; its play event follows a task later.
    setPlaying(!el.paused);
  }

  function press(next: Version, nextLanguage = track.language) {
    const el = video.current;
    if (!el) return;
    if (next === version && nextLanguage === track.language && (playing || loading)) {
      pendingPlay.current = false;
      el.pause();
      // pause() pauses at once; its pause event follows a task later.
      setPlaying(false);
      setLoading(false);
      return;
    }
    const nextSrc = next === "described" ? trackIn(nextLanguage)!.describedUrl : originalSrc;
    setVersion(next);
    if (next === "described") setChosen(nextLanguage);
    setEnded(false);
    setFailed(false);
    if (nextSrc === src && !el.error) {
      startFromWindow(el);
      return;
    }
    // The new source starts loading after this render (a failed one loads again now), and
    // onLoadedMetadata plays it from the window's start. Loading drops the pause event that
    // pause() queued, so the paused state is set here rather than by onPause.
    el.pause();
    if (nextSrc === src) el.load();
    setPlaying(false);
    setTime(windowStart);
    pendingPlay.current = true;
    setLoading(true);
  }

  const spoken =
    version === "described" ? track.lines.find((l) => time >= l.start && time <= l.end) : undefined;
  // Only promise a next description while one is still ahead in the window.
  const lineAhead = track.lines.some((l) => l.start > time);
  const progress = Math.min(1, Math.max(0, (time - windowStart) / (windowEnd - windowStart)));
  const pct = (s: number) => `${((s - windowStart) / (windowEnd - windowStart)) * 100}%`;

  return (
    <div className="seven">
      <div className={`seven-frame${hidden ? " hidden" : ""}`}>
        <video
          ref={video}
          src={src}
          // Only the metadata and the poster frame before a press: the clip is 13 MB and the window
          // plays 7 s of it. "none" would leave the frame black and never fire loadedmetadata.
          preload="metadata"
          playsInline
          onPlay={() => setPlaying(true)}
          onPause={() => {
            setPlaying(false);
            // Switching sources pauses the old one; the press stays loading until the new one plays.
            if (!pendingPlay.current) setLoading(false);
          }}
          onWaiting={(e) => {
            if (!e.currentTarget.paused) setLoading(true);
          }}
          onPlaying={() => setLoading(false)}
          onError={(e) => {
            pendingPlay.current = false;
            setPlaying(false);
            setLoading(false);
            setFailed(true);
            console.error("seven seconds: media failed", e.currentTarget.error);
          }}
          onLoadedMetadata={(e) => {
            if (!pendingPlay.current) return;
            pendingPlay.current = false;
            startFromWindow(e.currentTarget);
          }}
        />
      </div>
      <div className="seven-caption" aria-live="off">
        {loading ? (
          <span className="idle loading">
            <span className="spinner" aria-hidden="true" />
            {labels.loading}
          </span>
        ) : failed ? (
          <span className="idle failed">
            <span aria-hidden="true">⚠ </span>
            {labels.failed}
          </span>
        ) : ended ? (
          <span className="idle">{labels.ended}</span>
        ) : version === null ? (
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
        ) : !playing ? (
          <span className="idle">{labels.paused}</span>
        ) : (
          <span className="idle">{lineAhead ? labels.waiting : labels.quiet}</span>
        )}
      </div>
      <p className="sr-only" aria-live="polite">
        {slowLoading ? labels.loading : failed ? labels.failed : ended ? labels.ended : ""}
      </p>
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
          const active = version === v && (playing || loading);
          return (
            // A play/pause button: its label carries the state ("Pause" while playing), so it has no
            // aria-pressed, which would read "Pause, pressed" as if playback were paused.
            <button
              key={v}
              type="button"
              className={`button${v === "described" ? " primary" : ""}`}
              onClick={() => press(v)}
            >
              {active && loading ? (
                <span className="spinner" aria-hidden="true" />
              ) : (
                <PlayIcon pause={active} />
              )}
              {active ? `${labels.pause}` : v === "original" ? labels.original : labels.described}
            </button>
          );
        })}
      </div>
      <div className="seven-options">
        {tracks.length > 1 ? (
          <div className="segmented" role="group" aria-label={labels.narration}>
            {tracks.map((tr) => (
              <button
                key={tr.language}
                type="button"
                lang={tr.language}
                aria-pressed={tr.language === track.language}
                onClick={() => {
                  if (version === "described" && tr.language !== track.language) {
                    press("described", tr.language);
                  } else {
                    setChosen(tr.language);
                  }
                }}
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
