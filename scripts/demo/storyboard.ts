/**
 * The film, scene by scene: what is on screen, the captions that tell the story (English for the
 * submission, Korean for the review copy; the picture is the same), and where the film's own sound
 * plays. There is no presenter voice. Every number in a caption comes from facts.ts. A scene's
 * captions are split into sentences where the picture should change, because the recorder and the
 * motion pages key their moves to sentence starts; timing.ts times each by its reading length.
 */
import type { Language } from "../../src/lib/pipeline/schemas";
import { dayLabel, film, minutesSeconds } from "./facts";

export type Beat = "upload" | "replay" | "review" | "edit" | "result";
export type PageId = "dark" | "seven" | "stakes" | "constraint" | "cloud" | "evidence" | "close";

export type Part =
  /**
   * A caption sentence. `groups` sets its captions (each up to two lines) where no break rule finds
   * the natural split, as in a list; joined, they must read as the sentence.
   */
  | { caption: Record<Language, string>; groups?: Partial<Record<Language, string[][]>> }
  | { film: { track: "original" | "described"; from: number; to: number } }
  /** Time with no caption: an action in the app, film sound the recording plays, a page's own words. */
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

const cap = (en: string, ko: string, groups?: Partial<Record<Language, string[][]>>): Part =>
  groups ? { caption: { en, ko }, groups } : { caption: { en, ko } };
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
/** "Close your eyes." is the dark page's own words, before the film's sound starts. */
const CLOSE_YOUR_EYES_S = 2.2;

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
        pause(CLOSE_YOUR_EYES_S),
        { film: { track: "original", from: h.from, to: h.to } },
        cap(
          "Seven seconds with no words: a blind viewer hears only a hum and music.",
          "7초 동안 대사가 없습니다. 시각장애인 관객에게는 소음과 음악만 들립니다.",
        ),
        cap(
          "Now the same seconds, with the description Scene wrote.",
          "이번에는 씬이 쓴 화면해설과 함께 들어 보세요.",
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
        cap(
          "Scene wrote two lines for that silence; each voice is measured and ends before the next word.",
          "씬은 이 침묵에 두 문장을 썼고, 둘 다 다음 대사 전에 끝납니다.",
        ),
        cap(
          "No one edited them. One automatic run made the whole track.",
          "사람은 손대지 않았습니다. 자동 실행 한 번이 트랙 전체를 만들었습니다.",
        ),
      ],
      hold: 0.6,
    },
    {
      id: "stakes",
      show: { page: "stakes" },
      chapter: true,
      parts: [
        cap(
          `In ${month}, Korea's Supreme Court ruled that the big cinema chains discriminate by showing films without description or captions.`,
          `지난 ${monthKo}월 대법원은 대형 영화관 3사가 화면해설과 자막 없이 영화를 상영한 것을 차별로 판단했습니다.`,
          {
            ko: [
              [`지난 ${monthKo}월 대법원은`, "대형 영화관 3사가"],
              ["화면해설과 자막 없이 영화를", "상영한 것을 차별로 판단했습니다."],
            ],
          },
        ),
        cap(
          `Yet an accessible film still takes about ${film.handMade.months} months and ₩${won} million by hand.`,
          `하지만 배리어프리 영화 한 편을 손으로 만들려면 여전히 약 ${film.handMade.months}개월, ${(won * 100).toLocaleString("en-US")}만 원이 듭니다.`,
        ),
      ],
      hold: 0.8,
    },
    {
      id: "constraint",
      show: { page: "constraint" },
      parts: [
        cap(
          "Description may only speak where no one else does, so Speech-to-Text times every word.",
          "해설은 대사가 없는 곳에서만 말할 수 있어, 음성 인식으로 모든 단어의 시각을 잽니다.",
        ),
        cap(
          `This ${clip}-second clip has ${film.opening.gaps.length} usable silences; the shortest is only ${shortest} seconds.`,
          `${clip}초 클립에 쓸 수 있는 침묵은 ${film.opening.gaps.length}곳, 가장 짧은 곳은 ${shortest}초입니다.`,
        ),
        cap(
          "Every line is written, voiced and measured to fit one of them.",
          "모든 문장은 그중 한 곳에 맞게 쓰고, 읽고, 잽니다.",
        ),
      ],
      hold: 0.7,
    },
    {
      id: "upload",
      show: { beat: "upload" },
      chapter: true,
      parts: [
        cap(
          `You upload a clip of up to ${film.maxClipSeconds} seconds.`,
          `${film.maxClipSeconds}초 이하의 클립을 올립니다.`,
        ),
        pause(2.6),
        cap(
          "One press of Generate runs the rest, end to end.",
          "나머지는 Generate 한 번으로 끝까지 자동으로 진행됩니다.",
        ),
      ],
      hold: 0.4,
    },
    {
      id: "replay",
      show: { beat: "replay" },
      parts: [
        pause(0.6),
        cap(
          "Chirp 3 times the dialogue. Gemini watches the picture and writes a line for each silence.",
          "Chirp 3가 대사 시각을 재고, 제미나이가 화면을 보며 침묵마다 한 문장씩 씁니다.",
          {
            ko: [
              ["Chirp 3가 대사 시각을 재고,"],
              ["제미나이가 화면을 보며", "침묵마다 한 문장씩 씁니다."],
            ],
            en: [
              ["Chirp 3 times the dialogue."],
              ["Gemini watches the picture", "and writes a line for each silence."],
            ],
          },
        ),
        cap(
          `A second Gemini reviews every line against ${film.rules} rules from Korea's guideline.`,
          `검수는 또 하나의 제미나이가 맡아, 가이드라인 규칙 ${film.rules}가지로 모든 문장을 봅니다.`,
        ),
        cap(
          "Each line is voiced and measured; a final check reviews the whole track.",
          "문장마다 읽어서 길이를 재고, 믹스 전에 트랙 전체를 마지막으로 점검합니다.",
        ),
      ],
      hold: 0.8,
    },
    {
      id: "review",
      show: { beat: "review" },
      parts: [
        pause(2.0),
        cap(
          "When a check rejects a line, it cites the rule and the guideline page.",
          "문장이 반려되면 어긴 규칙과 가이드라인 쪽수가 함께 적힙니다.",
        ),
        cap(
          "Scene rewrites it from the reviewer's fix and reviews it again.",
          "씬은 검수 의견대로 문장을 다시 쓰고 다시 검수합니다.",
        ),
        cap(
          "This rewrite passed and was voiced. No one stepped in.",
          "다시 쓴 문장은 통과해 녹음됐고, 사람은 나서지 않았습니다.",
        ),
      ],
      hold: 1.0,
    },
    {
      id: "result",
      show: { beat: "result" },
      parts: [
        cap(
          `Each line shows its measured voice inside its room: ${voiced} seconds in ${room}.`,
          `문장마다 자리와 실제 음성 길이가 보입니다. ${room}초 침묵에 ${voiced}초입니다.`,
        ),
        pause(LISTEN_SLOT_S),
      ],
      hold: 0.3,
    },
    {
      id: "edit",
      show: { beat: "edit" },
      parts: [
        cap(
          "An editor can still change any line, if they want to.",
          "그래도 원하면, 편집자가 어떤 문장이든 고칠 수 있습니다.",
        ),
        pause(1.4),
        cap(
          "Scene then re-voices and re-checks only that line.",
          "그러면 씬은 그 문장만 다시 읽고 다시 검수합니다.",
        ),
      ],
      hold: 0.3,
    },
    {
      id: "cloud",
      show: { page: "cloud" },
      chapter: true,
      parts: [
        cap("It all runs on one Cloud Run service.", "모두 Cloud Run 하나에서 돌아갑니다."),
        cap(
          "Speech-to-Text times the words, Gemini watches, writes and reviews, and Text-to-Speech voices each line.",
          "음성 인식이 단어의 시각을 재고, 제미나이가 보고 쓰고 검수하고, 음성 합성이 문장을 읽습니다.",
          {
            en: [
              ["Speech-to-Text times the words,", "Gemini watches, writes and reviews,"],
              ["and Text-to-Speech voices each line."],
            ],
            ko: [
              ["음성 인식이 단어의 시각을 재고,", "제미나이가 보고 쓰고 검수하고,"],
              ["음성 합성이 문장을 읽습니다."],
            ],
          },
        ),
        cap(
          "Cloud Storage holds every version, and progress streams live.",
          "클라우드 스토리지가 모든 버전을 보관하고, 진행 상황은 실시간으로 전해집니다.",
        ),
      ],
      hold: 0.7,
    },
    {
      id: "evidence",
      show: { page: "evidence" },
      parts: [
        cap(
          `In our test runs, ${l.voiced} of ${l.written} lines reached the finished tracks, none over speech.`,
          `시험 실행에서 ${l.written}문장 중 ${l.voiced}문장이 완성 트랙에 들어갔고, 대사와 겹친 문장은 없었습니다.`,
        ),
        cap(
          `With no one in the loop, the sample took ${minutesSeconds(film.original.seconds, "en")} and cost $${film.original.costUsd.toFixed(2)}.`,
          `샘플은 사람 개입 없이 ${minutesSeconds(film.original.seconds, "ko")}, API 비용 ${film.original.costUsd.toFixed(2)}달러가 들었습니다.`,
        ),
      ],
      hold: 1.0,
    },
    {
      id: "close",
      show: { page: "close" },
      chapter: true,
      parts: [
        cap(
          "Scene. Descriptions that fit between the lines.",
          "씬. 대사와 대사 사이에 꼭 맞는 화면해설.",
          {
            en: [["Scene.", "Descriptions that fit between the lines."]],
          },
        ),
        cap("Try the sample with your eyes closed.", "눈을 감고 샘플을 들어 보세요."),
      ],
      hold: 1.8,
    },
  ];
}

/** Honest labels for time the film does not show at its real length (English on both films). */
export const TIME_LABELS = {
  replay: `Saved run: ${minutesSeconds(film.original.seconds, "en")} of processing, sped up`,
  upload: (seconds: number) => `Preparing: ${Math.round(seconds)} s, shortened`,
  day: dayLabel(film.original.day),
};
