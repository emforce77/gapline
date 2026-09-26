"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { fill } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { formatClock } from "@/lib/format";
import type { Cue, Language, SpeechSegment } from "@/lib/pipeline/schemas";
import { Gloss } from "./glosses";

export interface PlayerHandle {
  seek: (seconds: number, play?: boolean) => void;
}

/**
 * Seeking a freshly loaded video to 0 clears its "show poster" flag and paints frame 0, which is
 * black in most films. Only positions past this are restored after a source switch.
 */
const RESUME_MIN_SECONDS = 0.05;

/** Keys stay with the control that has focus: typing, native button activation, sliders. */
function keyBelongsToControl(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return key === " " && (tag === "BUTTON" || tag === "A" || tag === "SUMMARY");
}

/**
 * The film with or without description. Switching tracks keeps the position and play state.
 * "Eyes closed" blacks out the picture so a sighted viewer hears what a blind viewer hears. The strip
 * under the picture shows the line being spoken, so the demo can be followed without sound.
 */
export const Player = forwardRef<
  PlayerHandle,
  {
    originalUrl: string;
    posterUrl: string;
    describedUrl: string | null;
    cues: Cue[];
    speech: SpeechSegment[];
    /** BCP 47 code of the film's own dialogue, e.g. "en-US". */
    filmLanguage: string;
    narrationLanguage: Language | null;
    lineNumbers: Map<string, number>;
    onTime: (seconds: number) => void;
  }
>(function Player(
  {
    originalUrl,
    posterUrl,
    describedUrl,
    cues,
    speech,
    filmLanguage,
    narrationLanguage,
    lineNumbers,
    onTime,
  },
  ref,
) {
  const { t, lang } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [adOn, setAdOn] = useState(true);
  const [eyesClosed, setEyesClosed] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const resume = useRef<{ time: number; playing: boolean } | null>(null);
  const described = adOn && describedUrl !== null;
  const src = described ? describedUrl : originalUrl;

  function togglePlay() {
    const el = video.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }

  useImperativeHandle(ref, () => ({
    seek(seconds, play) {
      const el = video.current;
      if (!el) return;
      el.currentTime = seconds;
      if (play) void el.play();
    },
  }));

  // Set the source here so we can capture playback before the browser resets it. A JSX `src`
  // changes during React's commit, before an effect can read the old time and play state.
  const previousSrc = useRef<string | null>(null);
  useEffect(() => {
    if (previousSrc.current === src) return;
    const el = video.current;
    if (!el) return;
    if (previousSrc.current !== null) {
      // Another toggle can arrive before metadata for the previous switch finishes loading.
      resume.current ??= { time: el.currentTime, playing: !el.paused };
    }
    previousSrc.current = src;
    el.src = src;
  }, [src]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (keyBelongsToControl(event.target, event.key)) return;
      const key = event.key.toLowerCase();
      if (key === " " || key === "k") {
        event.preventDefault();
        togglePlay();
      } else if (key === "d" && describedUrl) {
        setAdOn((on) => !on);
      } else if (key === "e") {
        setEyesClosed((closed) => !closed);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [describedUrl]);

  const speaking = cues.find(
    (c) => c.status === "fits" && time >= c.start && time <= c.start + (c.seconds ?? 0),
  );
  const spokenText = speaking && described ? speaking.versions.at(-1)!.text : null;
  const dialogue = speech.find((s) => time >= s.start && time <= s.end);

  return (
    <div className="player">
      <div className="player-frame">
        <video
          ref={video}
          poster={posterUrl}
          playsInline
          preload="auto"
          onClick={togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onLoadedMetadata={(e) => {
            setDuration(e.currentTarget.duration);
            const saved = resume.current;
            resume.current = null;
            if (!saved) return;
            if (saved.time > RESUME_MIN_SECONDS)
              e.currentTarget.currentTime = Math.min(saved.time, e.currentTarget.duration);
            if (saved.playing) void e.currentTarget.play();
          }}
          onTimeUpdate={(e) => {
            setTime(e.currentTarget.currentTime);
            onTime(e.currentTarget.currentTime);
          }}
        />
        {eyesClosed ? (
          <div className="eyes-closed">
            <span className="label">{t.workspace.listening}</span>
            {spokenText ? (
              <p className="spoken-line" lang={narrationLanguage ?? undefined}>
                {spokenText}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="caption-strip">
        {spokenText && speaking ? (
          <>
            <span className="caption-tag">
              {fill(t.line.title, { n: lineNumbers.get(speaking.id) ?? "" })}
            </span>
            <span className="caption-text narration" lang={narrationLanguage ?? undefined}>
              {spokenText}
            </span>
            <Gloss text={spokenText} pageLang={lang} textLang={narrationLanguage} />
          </>
        ) : dialogue ? (
          <>
            <span className="caption-tag">{t.workspace.dialogue}</span>
            <span className="caption-text" lang={filmLanguage}>
              {dialogue.text}
            </span>
          </>
        ) : (
          <span className="caption-text idle">{t.workspace.captionIdle}</span>
        )}
      </div>
      <div className="player-controls">
        <button
          type="button"
          className={`button play${describedUrl && !playing ? " primary" : ""}`}
          aria-label={playing ? t.workspace.pause : undefined}
          onClick={togglePlay}
        >
          <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
          {playing ? null : <span>{described ? t.workspace.playDescribed : t.workspace.play}</span>}
        </button>
        <span className="player-time mono">
          {formatClock(time)} / {formatClock(duration)}
        </span>
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
      <p className="label keys-hint">{t.workspace.keys}</p>
    </div>
  );
});
