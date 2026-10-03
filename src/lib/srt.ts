/**
 * Subtitle text formats: SRT cues parsed as dialogue ground truth (never model input), and WebVTT
 * written for the described lines. No server imports, so the browser can build the same text.
 */

/** Subtitle cues parsed from an .srt file. */
export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

function srtTimeToSeconds(stamp: string): number {
  const [h, m, rest] = stamp.trim().split(":");
  const [s, ms] = rest.split(",");
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000;
}

export function parseSrt(content: string): SubtitleCue[] {
  return content
    .replace(/^﻿/, "")
    .replace(/\r/g, "")
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n");
      const [start, end] = lines[1].split(" --> ");
      return {
        start: srtTimeToSeconds(start),
        end: srtTimeToSeconds(end),
        text: lines.slice(2).join(" ").trim(),
      };
    });
}

/** A line of text and when it is heard, in seconds. */
export interface TimedText {
  start: number;
  end: number;
  text: string;
}

function vttTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(rest, 3)}`;
}

/**
 * Text as a WebVTT cue payload. A blank line ends a cue and a line holding "-->" starts a new one,
 * so the text becomes one line; "&", "<" and ">" are escaped, since cue text reads them as character
 * references and tags (which also turns "-->" into "--&gt;").
 */
export function vttCueText(text: string): string {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .join(" ")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/** A WebVTT file of the lines, in time order as the format requires. */
export function webVtt(lines: TimedText[]): string {
  const body = [...lines]
    .sort((a, b) => a.start - b.start)
    .map((l, i) => `${i + 1}\n${vttTime(l.start)} --> ${vttTime(l.end)}\n${vttCueText(l.text)}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}
