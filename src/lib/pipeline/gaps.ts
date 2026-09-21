import type { DialogueMap, Gap } from "./schemas";

/** Silence kept between narration and the nearest word, so neither clips the other. */
export const SPEECH_GUARD_SECONDS = 0.25;
/** Shorter windows cannot hold a meaningful phrase in either language. */
export const MIN_GAP_SECONDS = 1.2;

interface Span {
  start: number;
  end: number;
}

function mergeSpans(spans: Span[]): Span[] {
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

function round(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}
