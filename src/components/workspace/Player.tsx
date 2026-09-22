"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { formatClock } from "@/lib/format";
import type { Cue } from "@/lib/pipeline/schemas";

export interface PlayerHandle {
  seek: (seconds: number, play?: boolean) => void;
}

/**
 * The film with or without description. Switching tracks keeps the position and play state.
 * "Eyes closed" blacks out the picture so a sighted viewer hears what a blind viewer hears; the line
 * being spoken is shown as text so the demo is followable without sound.
 */
export const Player = forwardRef<
  PlayerHandle,
  {
    originalUrl: string;
    posterUrl: string;
    describedUrl: string | null;
    cues: Cue[];
    onTime: (seconds: number) => void;
  }
>(function Player({ originalUrl, posterUrl, describedUrl, cues, onTime }, ref) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [adOn, setAdOn] = useState(true);
  const [eyesClosed, setEyesClosed] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const resume = useRef<{ time: number; playing: boolean } | null>(null);
  const src = adOn && describedUrl ? describedUrl : originalUrl;

  useImperativeHandle(ref, () => ({
    seek(seconds, play) {
      const el = video.current;
      if (!el) return;
      el.currentTime = seconds;
      if (play) void el.play();
    },
  }));

  // The server-rendered <video> may load its metadata before React attaches handlers.
  useEffect(() => {
    const el = video.current;
    if (el && el.readyState >= 1) setDuration(el.duration);
  }, []);

  // Remember where we were before the source changes, restore it once the new source is ready.
  const previousSrc = useRef(src);
  useEffect(() => {
    if (previousSrc.current === src) return;
    previousSrc.current = src;
    const el = video.current;
    if (!el) return;
    resume.current = { time: time, playing: !el.paused };
  }, [src]);

  const speaking = cues.find(
    (c) => c.status === "fits" && time >= c.start && time <= c.start + (c.seconds ?? 0),
  );

  return (
    <div className="player">
      <div className="player-frame">
        <video
          ref={video}
          src={src}
          poster={posterUrl}
          playsInline
          preload="auto"
          onClick={(e) =>
            e.currentTarget.paused ? void e.currentTarget.play() : e.currentTarget.pause()
          }
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            if (!resume.current) return;
            e.currentTarget.currentTime = resume.current.time;
            if (resume.current.playing) void e.currentTarget.play();
            resume.current = null;
          }}
          onTimeUpdate={(e) => {
            setTime(e.currentTarget.currentTime);
            onTime(e.currentTarget.currentTime);
          }}
        />
        {eyesClosed ? (
          <div className="eyes-closed" aria-live="polite">
            <span className="label">{t.workspace.listening}</span>
            {speaking && adOn ? (
              <p className="spoken-line">{speaking.versions[speaking.versions.length - 1].text}</p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="player-controls">
        <button
          type="button"
          className="button play"
          aria-label={playing ? t.workspace.pause : t.workspace.play}
          onClick={() => {
            const el = video.current;
            if (!el) return;
            if (el.paused) void el.play();
            else el.pause();
          }}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <span className="player-time mono">
          {formatClock(time)} / {formatClock(duration)}
        </span>
        <span className="player-spacer" />
        <input
          className="player-seek"
          aria-label={t.editor.seek}
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          onChange={(e) => {
            if (video.current) video.current.currentTime = Number(e.target.value);
          }}
        />
        <div className="segmented" role="group" aria-label={t.editor.track}>
          <button
            type="button"
            aria-pressed={adOn}
            disabled={!describedUrl}
            onClick={() => setAdOn(true)}
          >
            {t.workspace.adOn}
          </button>
          <button type="button" aria-pressed={!adOn} onClick={() => setAdOn(false)}>
            {t.workspace.adOff}
          </button>
        </div>
        <div className="segmented" role="group" aria-label={t.editor.picture}>
          <button type="button" aria-pressed={!eyesClosed} onClick={() => setEyesClosed(false)}>
            {t.workspace.eyesOpen}
          </button>
          <button type="button" aria-pressed={eyesClosed} onClick={() => setEyesClosed(true)}>
            {t.workspace.eyesClosed}
          </button>
        </div>
      </div>
    </div>
  );
});
