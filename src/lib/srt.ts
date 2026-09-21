/** Subtitle cues parsed from an .srt file (used as dialogue ground truth, never as model input). */
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
