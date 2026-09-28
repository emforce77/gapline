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
import { gloss, textLang } from "../deck/glosses";
import { runFile, SAMPLE_RUN } from "./config";
import { dayLabel, film, GEMINI_NAME, minutesSeconds } from "./facts";

/**
 * The edit scene's one added word (never submitted): typed into the second line of the seven seconds,
 * just before that line's last word.
 */
export const EDIT = { word: "pink", before: "brain." } as const;

/**
 * Our Korean for the English sample lines the Korean copy shows over the film, keyed by the exact
 * English of the pinned run (runtime/showcase.json `runs.en`). `lineGloss` throws for a line without
 * one, so no English line reaches the Korean copy untranslated.
 */
const KO_LINES: Record<string, string> = {
  "A display reads: Simulation ready.": "디스플레이에 뜬 글자: 시뮬레이션 준비 완료.",
  "A man with a robotic eyepiece inspects a brain.": "로봇 접안경을 낀 남자가 뇌를 살핀다.",
  "Exhaust pours from the thrusters as the rocket ascends.":
    "추진기에서 배기가스가 쏟아지며 로켓이 솟아오른다.",
};

/**
 * What goes under one of Gapline's lines in a film: the English film glosses a Korean line, the Korean
 * copy translates an English one, and a line already in the film's language stands alone.
 */
export function lineGloss(text: string, lang: Language): string {
  if (textLang(text) === lang) return "";
  if (lang === "en") return gloss(text);
  const ko = KO_LINES[text];
  if (!ko) throw new Error(`no Korean for the English line: ${text}`);
  return ko;
}

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
  const heading = fill(t.line.title, { n: lineNumber! });
  const line = `${heading} · ${film.line.rewrite.text}`;
  if (lang === "ko")
    return {
      replay: `저장된 실행: 처리 ${took}, 빠르게 재생`,
      upload: (seconds) => `준비 ${Math.round(seconds)}초, 줄여서 표시`,
      day: koDay(film.original.day),
      revealLabel:
        textLang(film.line.rewrite.text) === "en"
          ? "갭라인의 영어 화면해설 · 아래는 우리말 번역"
          : "갭라인의 화면해설",
      generate: "한 번 누르면 모든 단계가 이어집니다",
      resultLine: `${heading} · ${lineGloss(film.line.rewrite.text, "ko") || film.line.rewrite.text}`,
      // The typed word is English; the Korean copy's overlays stay Korean.
      editAdded: "단어 하나 추가",
      dialogueKo: { locked: "…잠금 완료.", freaky: "이거 꽤 섬뜩하네." },
      services: SERVICES.ko,
      reused: `${t.stages.hear}·${t.stages.watch}: 이 클립의 이전 실행 결과 사용`,
    };
  return {
    replay: `Saved run: ${took} of processing, sped up`,
    upload: (seconds) => `Preparing: ${Math.round(seconds)} s, shortened`,
    day: dayLabel(film.original.day),
    revealLabel:
      textLang(film.line.rewrite.text) === "ko"
        ? "Gapline’s audio description, in Korean · English translation below"
        : "Gapline’s audio description",
    generate: "One press runs every step",
    resultLine: film.line.gloss === film.line.rewrite.text ? line : `${line} “${film.line.gloss}”`,
    editAdded: `Added: ${EDIT.word}`,
    dialogueKo: null,
    services: SERVICES.en,
    reused: "Hearing and watching: saved from an earlier run of this clip",
  };
}
