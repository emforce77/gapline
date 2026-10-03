"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { fill } from "@/i18n";
import { useI18n } from "@/i18n/client";
import { formatClock } from "@/lib/format";
import type { Cue, Language, SpeechSegment } from "@/lib/pipeline/schemas";
import { webVtt } from "@/lib/srt";
import { PlayIcon } from "../PlayIcon";
import { Gloss } from "./glosses";
import { dialogueLang, narrationText, speechText, spokenDuration } from "./text-tracks";

export interface PlayerHandle {
  seek: (seconds: number, play?: boolean) => void;
}

/**
 * Seeking a freshly loaded video to 0 clears its "show poster" flag and paints frame 0, which is
 * black in most films. Only positions past this are restored after a source switch.
 */
const RESUME_MIN_SECONDS = 0.05;
/** Arrow keys on the position slider move this far (Shift: five times as far). */
const SEEK_KEY_SECONDS = 1;
const SEEK_KEY_SHIFT_FACTOR = 5;
const SEEK_KEYS: Record<string, -1 | 1> = {
  ArrowLeft: -1,
  ArrowDown: -1,
  ArrowRight: 1,
  ArrowUp: 1,
};

/** Keys stay with the control that has focus: typing, native button activation, sliders. */
function keyBelongsToControl(target: EventTarget | null, key: string): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return key === " " && (tag === "BUTTON" || tag === "A" || tag === "SUMMARY");
}

/** A pause or a new source interrupts a pending play: the viewer's own choice, not a failure. */
function startPlaying(el: HTMLVideoElement) {
  el.play().catch((error: unknown) => {
    if (error instanceof DOMException && error.name === "AbortError") return;
    throw error;
  });
}

/** An object URL for generated text, released when the text changes or the player goes. */
function useTextUrl(text: string | null, type: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (text === null) {
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(new Blob([text], { type }));
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [text, type]);
  return url;
}

/**
 * The film with or without description. Switching tracks keeps the position and play state.
 * "Eyes closed" blacks out the picture so a sighted viewer hears what a blind viewer hears. The strip
 * under the picture shows the line being spoken, so the demo can be followed without sound. The same
 * lines, and the speech as recognized, are also text tracks of the video for assistive software.
 * The frame takes the clip's own shape, a portrait clip as much as the widescreen sample. Its letter
 * keys work only while focus is inside the player (WCAG 2.1.4), never page-wide.
 */
export const Player = forwardRef<
  PlayerHandle,
  {
    originalUrl: string;
    posterUrl: string;
    describedUrl: string | null;
    cues: Cue[];
    speech: SpeechSegment[];
    /** BCP 47 code of the film's own dialogue, e.g. "en-US", or "auto" when it was detected. */
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
  const [ratio, setRatio] = useState<number | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const resume = useRef<{ time: number; playing: boolean } | null>(null);
  // A result with no voiced line has a "described" file that is the film as it was.
  const describable = describedUrl !== null && cues.some((c) => c.status === "fits");
  const described = adOn && describable;
  const src = described ? describedUrl : originalUrl;
  const speechLang = dialogueLang(filmLanguage);

  const descriptionsVtt = useMemo(
    () => (described ? webVtt(narrationText(cues)) : null),
    [described, cues],
  );
  const speechVtt = useMemo(() => (speech.length ? webVtt(speechText(speech)) : null), [speech]);
  const descriptionsUrl = useTextUrl(descriptionsVtt, "text/vtt");
  const speechUrl = useTextUrl(speechVtt, "text/vtt");

  function togglePlay() {
    const el = video.current;
    if (!el) return;
    if (el.paused) startPlaying(el);
    else el.pause();
  }

  function seekTo(seconds: number) {
    const el = video.current;
    if (!el) return;
    const clamped = Math.min(Math.max(0, seconds), el.duration || 0);
    el.currentTime = clamped;
    setTime(clamped);
  }

  useImperativeHandle(ref, () => ({
    seek(seconds, play) {
      const el = video.current;
      if (!el) return;
      el.currentTime = seconds;
      if (play) startPlaying(el);
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
    setLoadFailed(false);
    el.src = src;
  }, [src]);

  // A <track> without `default` stays disabled and is never loaded; hidden loads its cues for
  // assistive software without drawing them over the picture (the strip below shows them).
  useEffect(() => {
    const tracks = video.current?.textTracks;
    if (!tracks) return;
    for (const track of Array.from(tracks)) if (track.mode === "disabled") track.mode = "hidden";
  }, [descriptionsUrl, speechUrl]);

  function onPlayerKey(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (keyBelongsToControl(event.target, event.key)) return;
    const key = event.key.toLowerCase();
    if (key === " " || key === "k") {
      event.preventDefault();
      togglePlay();
    } else if (key === "d" && describable) {
      setAdOn((on) => !on);
    } else if (key === "e") {
      setEyesClosed((closed) => !closed);
    }
  }

  function retryLoad() {
    const el = video.current;
    if (!el) return;
    resume.current ??= { time, playing: false };
    setLoadFailed(false);
    el.load();
  }

  const speaking = cues.find(
    (c) => c.status === "fits" && time >= c.start && time <= c.start + (c.seconds ?? 0),
  );
  const spokenText = speaking && described ? speaking.versions.at(-1)!.text : null;
  // Where a re-listen heard the same words again, its timing is the better one.
  const heardNow = speech.filter((s) => time >= s.start && time <= s.end);
  const dialogue = heardNow.find((s) => s.heard === "relisten") ?? heardNow[0];

  return (
    // tabIndex -1: a click on the picture or the strip moves focus into the player, so its keys work.
    <div className="player" tabIndex={-1} onKeyDown={onPlayerKey}>
      <div
        className="player-frame"
        style={ratio ? ({ "--clip-ratio": ratio } as React.CSSProperties) : undefined}
      >
        <video
          ref={video}
          poster={posterUrl}
          playsInline
          preload="auto"
          onClick={togglePlay}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => {
            console.error("Video failed to load", video.current?.error);
            setLoadFailed(true);
          }}
          onLoadedMetadata={(e) => {
            const el = e.currentTarget;
            setLoadFailed(false);
            setDuration(el.duration);
            if (el.videoWidth && el.videoHeight) setRatio(el.videoWidth / el.videoHeight);
            const saved = resume.current;
            resume.current = null;
            if (!saved) return;
            if (saved.time > RESUME_MIN_SECONDS) el.currentTime = Math.min(saved.time, el.duration);
            if (saved.playing) startPlaying(el);
          }}
          onTimeUpdate={(e) => {
            setTime(e.currentTarget.currentTime);
            onTime(e.currentTarget.currentTime);
          }}
        >
          {descriptionsUrl ? (
            <track
              kind="descriptions"
              src={descriptionsUrl}
              srcLang={narrationLanguage ?? undefined}
              label={t.timeline.narration}
            />
          ) : null}
          {speechUrl ? (
            <track
              kind="captions"
              src={speechUrl}
              srcLang={speechLang || undefined}
              label={t.workspace.dialogue}
            />
          ) : null}
        </video>
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
      {loadFailed ? (
        <div className="ws-error run-error">
          <p role="alert">
            <span aria-hidden="true">⚠ </span>
            {t.workspace.videoFailed}
          </p>
          <button type="button" className="button small" onClick={retryLoad}>
            <span aria-hidden="true">↻</span> {t.live.retry}
          </button>
        </div>
      ) : null}
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
            <span className="caption-text" lang={dialogue.lang ?? speechLang}>
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
          className={`button play${describable && !playing ? " primary" : ""}`}
          aria-label={playing ? t.workspace.pause : undefined}
          onClick={togglePlay}
        >
          <PlayIcon pause={playing} />
          {playing ? null : <span>{described ? t.workspace.playDescribed : t.workspace.play}</span>}
        </button>
        <span className="player-time mono">
          {formatClock(time)} / {formatClock(duration)}
        </span>
        <input
          className="player-seek"
          aria-label={t.editor.seek}
          aria-valuetext={fill(t.editor.seekValue, {
            time: spokenDuration(time, lang),
            total: spokenDuration(duration, lang),
          })}
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          onChange={(e) => seekTo(Number(e.target.value))}
          onKeyDown={(e) => {
            const direction = SEEK_KEYS[e.key];
            if (!direction || !video.current) return;
            e.preventDefault();
            const step = SEEK_KEY_SECONDS * (e.shiftKey ? SEEK_KEY_SHIFT_FACTOR : 1);
            seekTo(video.current.currentTime + direction * step);
          }}
        />
        {/* What is pressed is what plays: before a result exists, only the film is there. */}
        <div className="segmented" role="group" aria-label={t.editor.track}>
          <button
            type="button"
            aria-pressed={described}
            disabled={!describable}
            onClick={() => setAdOn(true)}
          >
            {t.workspace.adOn}
          </button>
          <button
            type="button"
            aria-pressed={!described}
            disabled={!describable}
            onClick={() => setAdOn(false)}
          >
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
