import type { DialogueMap, Gap } from "./schemas";

/** Silence kept between narration and the nearest word, so neither clips the other. */
export const SPEECH_GUARD_SECONDS = 0.25;
/** Shorter windows cannot hold a meaningful phrase in either language. */
export const MIN_GAP_SECONDS = 1.2;

interface Span {
  start: number;
  end: number;
}

/** Overlapping spans merged into one, sorted by start. */
export function mergeSpans(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/**
 * Windows where narration may speak: the clip minus speech and protected sounds,
 * each blocked span widened by the guard, keeping only windows long enough to use.
 */
export function findGaps(map: DialogueMap, clipSeconds: number): Gap[] {
  const blocked = mergeSpans(
    [...map.speech, ...map.sounds.filter((s) => s.kind === "protect")].map((s) => ({
      start: Math.max(0, s.start - SPEECH_GUARD_SECONDS),
      end: Math.min(clipSeconds, s.end + SPEECH_GUARD_SECONDS),
    })),
  );
  const gaps: Gap[] = [];
  let cursor = 0;
  for (const span of [...blocked, { start: clipSeconds, end: clipSeconds }]) {
    if (span.start - cursor >= MIN_GAP_SECONDS) {
      gaps.push({ id: `g${gaps.length + 1}`, start: round(cursor), end: round(span.start) });
    }
    cursor = Math.max(cursor, span.end);
  }
  return gaps;
}

/** Below this much total room a clip can hold at most a line or two, whatever the writer does. */
export const LITTLE_ROOM_MIN_SECONDS = 3;
/** ...or below this share of the clip (QA clips with 5.5-14.7% room are flagged, 26%+ are not). */
export const LITTLE_ROOM_SHARE = 0.15;

/**
 * Total speakable room and whether it is too little for meaningful description. Pure, so the
 * browser can warn from a saved analysis before any paid run.
 */
export function assessRoom(
  gaps: Gap[],
  clipSeconds: number,
): { gapSeconds: number; thresholdSeconds: number; little: boolean } {
  const gapSeconds = round(gaps.reduce((s, g) => s + g.end - g.start, 0));
  const thresholdSeconds = round(
    Math.max(LITTLE_ROOM_MIN_SECONDS, LITTLE_ROOM_SHARE * clipSeconds),
  );
  return { gapSeconds, thresholdSeconds, little: gapSeconds < thresholdSeconds };
}

function round(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}
