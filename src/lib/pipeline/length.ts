import type { Language } from "./schemas";

/**
 * Speaking speed the length budget assumes, per second of window.
 * Measured with the Chirp 3: HD narrators at rate 1.0 (scripts/measure-voice.ts, 2026-09-21):
 * Korean 5.64 syllables/s, English 2.82 words/s. The budget keeps ~11% in reserve because the
 * final check is the measured duration of the synthesized line, not this estimate.
 */
export const UNITS_PER_SECOND: Record<Language, number> = { ko: 5.0, en: 2.5 };
export const UNIT_NAME: Record<Language, string> = { ko: "syllables", en: "words" };

/** Korean counts syllables (letters and digits, no spaces or punctuation); English counts words. */
export function spokenUnits(text: string, language: Language): number {
  if (language === "ko") return [...text].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length;
  return text.split(/\s+/).filter(Boolean).length;
}

export function unitBudget(seconds: number, language: Language): number {
  return Math.max(1, Math.floor(seconds * UNITS_PER_SECOND[language]));
}
