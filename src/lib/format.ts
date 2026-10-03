import type { UiLang } from "@/i18n";

const LOCALE: Record<UiLang, string> = { en: "en-US", ko: "ko-KR" };

export function formatUsd(value: number, lang: UiLang): string {
  return new Intl.NumberFormat(LOCALE[lang], {
    style: "currency",
    currency: "USD",
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: value < 1 ? 3 : 2,
    maximumFractionDigits: value < 1 ? 3 : 2,
  }).format(value);
}

/** 0:07.4 style, for timestamps inside a clip. */
export function formatClock(seconds: number): string {
  // Rounded before splitting, so 59.96 reads 1:00.0 and never 0:60.0.
  const tenths = Math.round(seconds * 10) / 10;
  const m = Math.floor(tenths / 60);
  return `${m}:${(tenths - m * 60).toFixed(1).padStart(4, "0")}`;
}

/**
 * A no-break space (U+00A0) between a number and its English unit, so a narrow phone never wraps
 * "6 min 27 s" into "6 / min 27 s" (QA round 3, 390 px). Korean writes the unit against the number.
 */
const NBSP = "\u00a0";

/** "2 min 16 s" / "2분 16초", for durations of work; each number stays on the line of its unit. */
export function formatDuration(seconds: number, lang: UiLang): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (lang === "ko") return m > 0 ? `${m}분 ${s}초` : `${s}초`;
  return m > 0 ? `${m}${NBSP}min ${s}${NBSP}s` : `${s}${NBSP}s`;
}

/**
 * "91 seconds" / "91초": a clip length next to the upload limit, in the unit the limit is written in
 * ("Clips up to 90 seconds"), so the two read as one comparison.
 */
export function formatWholeSeconds(seconds: number, lang: UiLang): string {
  return new Intl.NumberFormat(LOCALE[lang], {
    style: "unit",
    unit: "second",
    unitDisplay: "long",
    maximumFractionDigits: 0,
  })
    .formatToParts(Math.round(seconds))
    .map((part) => (part.type === "literal" ? part.value.replaceAll(" ", NBSP) : part.value))
    .join("");
}

/**
 * Rounds to 0.01 s, the precision run records keep a voiced length in. A raw length (a line's trimmed
 * audio, 2.746 s) printed next to its recorded one (2.75 s) must round from the same value, or one
 * reads 2.7 and the other 2.8.
 */
export function toRecordedSeconds(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}

/**
 * One decimal, rounded half up on the decimal value (3.65 reads 3.7). `toFixed` rounds the binary
 * double instead (3.65 is stored as 3.6499…, so it reads 3.6); anything printed next to the app's
 * seconds must use this.
 */
export function formatTenths(seconds: number, lang: UiLang): string {
  return new Intl.NumberFormat(LOCALE[lang], {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(seconds);
}

export function formatSeconds(seconds: number, lang: UiLang): string {
  const n = formatTenths(seconds, lang);
  return lang === "ko" ? `${n}초` : `${n}${NBSP}s`;
}
