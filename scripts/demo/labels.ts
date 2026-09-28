/**
 * Every word the film draws over the recorded app and the reveal, in the film's language: honest
 * labels for time shown shortened, the tags that name what is on screen, the service chips (and the
 * one saying where the stages the sample reused came from), and the Korean subtitles of the film's
 * own English dialogue (Korean copy only). Numbers come from facts.ts
 * and the app's own dictionary; product names (Cloud Run, Gemini, Speech-to-Text, Chirp 3,
 * Text-to-Speech) stay in English in both copies.
 */
import { readFileSync } from "node:fs";
import { dictionary, fill } from "../../src/i18n";
import { lineNumbers } from "../../src/components/workspace/labels";
import type { Cue, Language } from "../../src/lib/pipeline/schemas";
import { runFile, SAMPLE_RUN } from "./config";
import { dayLabel, film, GEMINI_NAME, minutesSeconds } from "./facts";

/** The word the edit scene types into Line 7 (never submitted), and its gloss. */
export const EDIT_WORD = { ko: "가만히", en: "steadily" } as const;

/** Stages of the app's stage list that carry a service chip in the replay. */
export type ServiceStage =
  "hear" | "watch" | "write" | "review" | "voice" | "verify" | "fix" | "mix";

export interface FilmLabels {
  /** The replay's tag: the saved run's real processing time, shown sped up. */
  replay: string;
  /** The upload's tag, with the real seconds the preparation took. */
  upload: (seconds: number) => string;
  /** The day the sample ran. */
  day: string;
  /** The reveal's label, up for the whole reveal. */
  revealLabel: string;
  /** Beside Generate: the one press the rest follows from (a product claim, not this sample's). */
  generate: string;
  /** The line heard in the result scene: its number as the app shows it, and its words. */
  resultLine: string;
  /** What the edit scene typed. */
  editAdded: string;
  /** Korean subtitles under the film's English dialogue; null in the English film. */
  dialogueKo: { locked: string; freaky: string } | null;
  /** The service each stage calls, beside the stage list. */
  services: Record<ServiceStage, string>;
  /**
   * Beside the stages the sample reused instead of a service: where their result came from (an
   * earlier run of the clip, data/analysis.ts; the app's own row says the same).
   */
  reused: string;
}

/** Line numbers as the app gives them (by time, over every line of the run). */
const cues = (
  JSON.parse(readFileSync(runFile(SAMPLE_RUN, "script.json"), "utf8")) as { cues: Cue[] }
).cues;
const lineNumber = lineNumbers(cues).get(film.line.cueId);
if (lineNumber === undefined) throw new Error(`${film.line.cueId} is not a line of ${SAMPLE_RUN}`);

const koDay = (d: Date) => `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;

const SERVICES: Record<Language, Record<ServiceStage, string>> = {
  en: {
    hear: "Speech-to-Text · Chirp 3",
    watch: GEMINI_NAME,
    write: GEMINI_NAME,
    review: GEMINI_NAME,
    voice: "Text-to-Speech · Chirp 3 HD",
    verify: GEMINI_NAME,
    fix: GEMINI_NAME,
    mix: "FFmpeg on Cloud Run",
  },
  ko: {
    hear: "Speech-to-Text · Chirp 3",
    watch: GEMINI_NAME,
    write: GEMINI_NAME,
    review: GEMINI_NAME,
    voice: "Text-to-Speech · Chirp 3 HD",
    verify: GEMINI_NAME,
    fix: GEMINI_NAME,
    mix: "FFmpeg · Cloud Run",
  },
};

export function labels(lang: Language): FilmLabels {
  const t = dictionary(lang);
  const took = minutesSeconds(film.original.seconds, lang);
  const line = `${fill(t.line.title, { n: lineNumber! })} · ${film.line.rewrite.text}`;
  if (lang === "ko")
    return {
      replay: `저장된 실행: 처리 ${took}, 빠르게 재생`,
      upload: (seconds) => `준비 ${Math.round(seconds)}초, 줄여서 표시`,
      day: koDay(film.original.day),
      revealLabel: "갭라인의 화면해설",
      generate: "한 번 누르면 모든 단계가 이어집니다",
      resultLine: line,
      editAdded: `추가: ${EDIT_WORD.ko}`,
      dialogueKo: { locked: "…잠금 완료.", freaky: "이거 꽤 섬뜩하네." },
      services: SERVICES.ko,
      reused: `${t.stages.hear}·${t.stages.watch}: 이 클립의 이전 실행 결과 사용`,
    };
  return {
    replay: `Saved run: ${took} of processing, sped up`,
    upload: (seconds) => `Preparing: ${Math.round(seconds)} s, shortened`,
    day: dayLabel(film.original.day),
    revealLabel: "Gapline’s audio description, in Korean · English translation below",
    generate: "One press runs every step",
    resultLine: `${line} “${film.line.gloss}”`,
    editAdded: `Added: ${EDIT_WORD.ko} (${EDIT_WORD.en})`,
    dialogueKo: null,
    services: SERVICES.en,
    reused: "Hearing and watching: saved from an earlier run of this clip",
  };
}
