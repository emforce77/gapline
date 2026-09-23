/**
 * The film, scene by scene: what is on screen, what the presenter says (English for the submission,
 * Korean for the review copy; the picture is the same), and where the film's own sound plays.
 * Every number in a sentence comes from facts.ts. Sentences are split where the picture should change,
 * because the recorder and the motion pages key their moves to sentence starts.
 */
import type { Language } from "../../src/lib/pipeline/schemas";
import { dayLabel, film, minutesSeconds } from "./facts";

export type Beat = "upload" | "replay" | "review" | "edit" | "result";
export type PageId = "dark" | "seven" | "stakes" | "constraint" | "cloud" | "evidence" | "close";

export type Part =
  /**
   * A presenter sentence. `captions` sets its caption groups (each up to two lines) where no break
   * rule finds the natural split, as in a list; joined, they must read as the sentence.
   */
  | { say: Record<Language, string>; captions?: Partial<Record<Language, string[][]>> }
  | { film: { track: "original" | "described"; from: number; to: number } }
  /** Time kept free of speech: an action in the app, or film sound the recording plays. */
  | { pause: number };

export interface Scene {
  id: string;
  show: { page: PageId } | { film: { from: number; to: number } } | { beat: Beat };
  parts: Part[];
  /** Seconds kept after the last part. */
  hold: number;
  /** Starts with a short dip from black: a new chapter. */
  chapter?: boolean;
}

const say = (en: string, ko: string, captions?: Partial<Record<Language, string[][]>>): Part =>
  captions ? { say: { en, ko }, captions } : { say: { en, ko } };
const pause = (seconds: number): Part => ({ pause: seconds });

/** The film cuts to the next shot 0.33 s before this line's window ends (measured on described.mp4). */
const WINDOW_END_CLEARANCE_S = 0.45;
/**
 * "Play from here" starts a second before the line; the recording stops just after it, and clear of
 * the line's window end: the next shot and, at the end, the next line's caption.
 */
export const LISTEN = {
  from: film.line.start - 1,
  to: Math.min(
    film.line.start + film.line.voiced + 0.5,
    film.line.windowEnd - WINDOW_END_CLEARANCE_S,
  ),
};
const LISTEN_SLOT_S = LISTEN.to - LISTEN.from + 0.6;

export function buildStoryboard(): Scene[] {
  const h = film.hook;
  const month = film.court.date.toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
  const monthKo = film.court.date.getUTCMonth() + 1;
  const won = film.handMade.wonMillions;
  const shortest = film.opening.shortest.toFixed(1);
  const clip = film.original.clipSeconds;
  const voiced = film.line.voiced.toFixed(1);
  const room = film.line.room.toFixed(1);
  const l = film.loops;
  return [
    {
      id: "dark",
      show: { page: "dark" },
      parts: [
        say("Close your eyes.", "눈을 감아 보세요."),
        { film: { track: "original", from: h.from, to: h.to } },
        say(
          "Seven seconds without a word. Now, with Scene.",
          "7초 동안 대사가 없습니다. 이번엔 씬의 화면해설과 함께 들어 보세요.",
        ),
      ],
      hold: 0.3,
    },
    {
      id: "reveal",
      show: { film: { from: h.from, to: h.to } },
      parts: [{ film: { track: "described", from: h.from, to: h.to } }],
      hold: 0,
    },
    {
      id: "seven",
      show: { page: "seven" },
      chapter: true,
      parts: [
        say(
          "Scene wrote those two lines for that silence.",
          "씬은 이 침묵에 맞춰 두 문장을 썼습니다.",
        ),
        say(
          "Each is voiced and measured, and ends before anyone speaks.",
          "문장마다 목소리로 읽어 길이를 재고, 모두 다음 대사 전에 끝납니다.",
        ),
        say("An editor finished the first one.", "첫 문장은 편집자가 마무리했습니다."),
      ],
      hold: 0.6,
    },
    {
      id: "stakes",
      show: { page: "stakes" },
      chapter: true,
      parts: [
        say(
          `In ${month}, Korea's Supreme Court confirmed that the three big cinema chains discriminate when films lack audio description and captions.`,
          `지난 ${monthKo}월 대법원은 대형 영화관 3사가 화면해설과 자막 없이 영화를 상영한 것을 차별로 판단했습니다.`,
          {
            ko: [
              [`지난 ${monthKo}월 대법원은`, "대형 영화관 3사가"],
              ["화면해설과 자막 없이 영화를", "상영한 것을 차별로 판단했습니다."],
            ],
          },
        ),
        say(
          `Yet one accessible film still takes about ${film.handMade.months} months and ${won} million won to make by hand.`,
          `하지만 배리어프리 영화 한 편을 사람 손으로 만들려면 여전히 ${film.handMade.months}개월, 약 ${(won * 100).toLocaleString("en-US")}만 원이 듭니다.`,
        ),
      ],
      hold: 0.8,
    },
    {
      id: "constraint",
      show: { page: "constraint" },
      parts: [
        say(
          "Speech-to-Text marks when every word is spoken.",
          "음성 인식이 모든 단어의 시각을 잽니다.",
        ),
        say(
          `In this ${clip}-second clip, that leaves ${film.opening.gaps.length} usable silences, the shortest only ${shortest} seconds.`,
          `${clip}초짜리 이 클립에서 쓸 수 있는 침묵은 ${film.opening.gaps.length}개, 가장 짧은 것은 ${shortest}초입니다.`,
        ),
        say("Every line has to fit inside one.", "모든 문장은 그중 하나에 들어가야 합니다."),
      ],
      hold: 1.0,
    },
    {
      id: "upload",
      show: { beat: "upload" },
      chapter: true,
      parts: [
        say(
          `You upload a clip of up to ${film.maxClipSeconds} seconds.`,
          `${film.maxClipSeconds}초 이하의 클립을 올립니다.`,
        ),
        pause(2.1),
      ],
      hold: 0.4,
    },
    {
      id: "replay",
      show: { beat: "replay" },
      parts: [
        pause(0.6),
        say(
          "This is a saved run on our sample, sped up.",
          "샘플에서 저장해 둔 실행을 빠르게 재생합니다.",
        ),
        say(
          "Gemini watches the clip and writes each line for one silence.",
          "제미나이가 영상을 보고, 문장마다 들어갈 침묵을 정해 씁니다.",
        ),
        say(
          "Then it checks every line against 8 rules from Korea's guideline.",
          "그리고 가이드라인의 규칙 8가지로 모든 문장을 검수합니다.",
        ),
      ],
      hold: 1.0,
    },
    {
      id: "review",
      show: { beat: "review" },
      parts: [
        pause(1.6),
        say("This line was sent back twice.", "이 문장은 두 번 반려됐습니다."),
        say("First, it skipped the words on screen.", "처음엔 화면 속 글자를 빠뜨렸습니다."),
        say(
          "Then the rewrite described the screen, not the scene.",
          "다시 쓴 문장은 장면 대신 화면을 설명했습니다.",
        ),
        say(
          "So Scene dropped it, and flagged it for the editor.",
          "그래서 씬은 이 문장을 빼고, 편집자에게 알렸습니다.",
        ),
      ],
      hold: 1.0,
    },
    {
      id: "edit",
      show: { beat: "edit" },
      parts: [
        say("The editor types the reviewer's fix.", "편집자가 검수자의 수정안을 입력합니다."),
        pause(2.0),
        say(
          "The start can only move inside its own silence.",
          "시작 시각은 같은 침묵 안에서만 옮길 수 있습니다.",
        ),
        pause(1.0),
      ],
      hold: 0.3,
    },
    {
      id: "result",
      show: { beat: "result" },
      parts: [
        say(
          "Scene voices only that line, and reviews it again.",
          "씬은 그 문장만 다시 읽고, 다시 검수합니다.",
        ),
        say(
          `Then it measures the audio: ${voiced} seconds, in ${room} seconds of room.`,
          `그리고 음성 길이를 잽니다. ${room}초의 여유에 ${voiced}초입니다.`,
        ),
        pause(LISTEN_SLOT_S),
      ],
      hold: 0.3,
    },
    {
      id: "cloud",
      show: { page: "cloud" },
      chapter: true,
      parts: [
        say(
          "It all runs on one Cloud Run service.",
          "모두 클라우드 런 서비스 하나에서 돌아갑니다.",
        ),
        say(
          "Speech-to-Text finds the words, Gemini watches, writes and reviews, and Text-to-Speech speaks.",
          "음성 인식이 단어를 찾고, 제미나이가 보고 쓰고 검수하고, 음성 합성이 읽습니다.",
          {
            en: [
              ["Speech-to-Text finds the words,", "Gemini watches, writes and reviews,"],
              ["and Text-to-Speech speaks."],
            ],
            ko: [
              ["음성 인식이 단어를 찾고,", "제미나이가 보고 쓰고 검수하고,"],
              ["음성 합성이 읽습니다."],
            ],
          },
        ),
        say(
          "Cloud Storage keeps every clip, and every version.",
          "클라우드 스토리지는 모든 클립과 모든 버전을 보관합니다.",
        ),
      ],
      hold: 1.0,
    },
    {
      id: "evidence",
      show: { page: "evidence" },
      parts: [
        say(
          `In our tests, ${l.voiced} of ${l.written} lines made it into the finished tracks, none over the recognized speech.`,
          `시험 실행에서 ${l.written}문장 중 ${l.voiced}문장이 완성된 해설 트랙에 들어갔고, 인식된 대사와 겹친 문장은 없었습니다.`,
        ),
        say(
          "And with our default reviewer, every finished run listed what it still missed.",
          "기본 검수 설정으로 끝난 실행은 모두, 아직 빠진 내용을 목록으로 알려 주었습니다.",
        ),
      ],
      hold: 1.4,
    },
    {
      id: "close",
      show: { page: "close" },
      chapter: true,
      parts: [
        say(
          "Scene. Descriptions that fit between the lines.",
          "씬. 대사 사이에 꼭 맞는 화면해설.",
          {
            en: [["Scene.", "Descriptions that fit between the lines."]],
          },
        ),
        say("Try the sample with your eyes closed.", "눈을 감고 샘플을 들어 보세요."),
      ],
      hold: 2.2,
    },
  ];
}

/** Honest labels for time the film does not show at its real length (English on both films). */
export const TIME_LABELS = {
  replay: `Saved run: ${minutesSeconds(film.original.seconds, "en")} of processing, sped up`,
  result: `This same edit, run ${dayLabel(film.edit.day)}: ${minutesSeconds(film.edit.seconds, "en")} of processing not shown`,
  upload: (seconds: number) => `Preparing: ${Math.round(seconds)} s, shortened`,
};
