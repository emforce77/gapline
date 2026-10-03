import type { UiLang } from "@/i18n";
import type { Cue, SpeechSegment } from "@/lib/pipeline/schemas";
import type { TimedText } from "@/lib/srt";

/** The lines heard in a result, as timed text: what the run wrote to descriptions.vtt. */
export function narrationText(cues: Cue[]): TimedText[] {
  return cues
    .filter((c) => c.status === "fits")
    .map((c) => ({
      start: c.start,
      end: c.start + (c.seconds ?? 0),
      text: c.versions.at(-1)!.text,
    }));
}

/** The speech recognized in the clip, as timed text. */
export function speechText(speech: SpeechSegment[]): TimedText[] {
  return speech.map((s) => ({ start: s.start, end: s.end, text: s.text }));
}

/**
 * The HTML language of the film's dialogue. Uploads keep the recognizer's "auto" (detect the
 * language), which is not a language tag; "" is HTML's "language unknown".
 */
export function dialogueLang(filmLanguageCode: string): string {
  return filmLanguageCode === "auto" ? "" : filmLanguageCode;
}

/** "1 minute 5 seconds" / "1분 5초", whole seconds, for a slider's spoken value. */
export function spokenDuration(seconds: number, lang: UiLang): string {
  const total = Math.floor(Math.max(0, seconds));
  const unit = (unit: "minute" | "second", n: number) =>
    new Intl.NumberFormat(lang, { style: "unit", unit, unitDisplay: "long" }).format(n);
  const m = Math.floor(total / 60);
  return m > 0 ? `${unit("minute", m)} ${unit("second", total % 60)}` : unit("second", total);
}
