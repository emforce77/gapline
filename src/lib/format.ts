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
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/** "2 min 16 s" / "2분 16초", for durations of work. */
export function formatDuration(seconds: number, lang: UiLang): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (lang === "ko") return m > 0 ? `${m}분 ${s}초` : `${s}초`;
  return m > 0 ? `${m} min ${s} s` : `${s} s`;
}

/**
 * Rounds to 0.01 s, the precision run records keep a voiced length in. A raw length (a line's trimmed
 * audio, 2.746 s) printed next to its recorded one (2.75 s) must round from the same value, or one
 * reads 2.7 and the other 2.8.
 */
export function toRecordedSeconds(seconds: number): number {
  return Math.round(seconds * 100) / 100;
}

export function formatSeconds(seconds: number, lang: UiLang): string {
  const n = new Intl.NumberFormat(LOCALE[lang], {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(seconds);
  return lang === "ko" ? `${n}초` : `${n} s`;
}
