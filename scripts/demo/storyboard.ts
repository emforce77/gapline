/**
 * The film, scene by scene: what is on screen, the captions that tell the story (English for the
 * submission, Korean for the review copy; the picture is the same), and where the film's own sound
 * plays. There is no presenter voice. Every number in a caption comes from facts.ts. A scene's
 * captions are split into sentences where the picture should change, because the recorder and the
 * motion pages key their moves to sentence starts; timing.ts times each by its reading length.
 *
 * The story states the default with confidence (one press of Generate runs every step) and names the
 * optional edit once, as an offer. The words drawn over the app live in labels.ts.
 */
import type { Language } from "../../src/lib/pipeline/schemas";
import { film } from "./facts";

export type Beat = "upload" | "replay" | "review" | "edit" | "result";
export type PageId = "dark" | "seven" | "stakes" | "constraint" | "cloud" | "close";

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

/**
 * The next line starts at this line's window end (the sample's L3 at 19.0 s, on the same shot): the
 * listen stops this long before it, so none of the next line is heard.
 */
const WINDOW_END_CLEARANCE_S = 0.2;
/** The listen starts at least this long after the voice of the line before it has ended. */
const PREVIOUS_VOICE_CLEARANCE_S = 0.15;
/** The line heard before the listened one, whose voice must not reach into the listen. */
const previousLine = film.opening.lines.filter((l) => l.start < film.line.start).at(-1);
/**
 * "Play from here" starts up to a second before the line, never in the voice of the line before
 * it; the recording stops just after the line, and clear of its window end: the next shot and, at
 * the end, the next line's caption. `lineAt` is where the line starts, in seconds into the listen.
 */
const listenFrom = Math.max(
  film.line.start - 1,
  previousLine ? previousLine.start + previousLine.voiced + PREVIOUS_VOICE_CLEARANCE_S : 0,
);
export const LISTEN = {
  from: listenFrom,
  to: Math.min(
    film.line.start + film.line.voiced + 0.5,
    film.line.windowEnd - WINDOW_END_CLEARANCE_S,
  ),
  lineAt: film.line.start - listenFrom,
};
const LISTEN_SLOT_S = LISTEN.to - LISTEN.from + 0.6;
/** "Close your eyes." is the dark page's own words, before the film's sound starts. */
const CLOSE_YOUR_EYES_S = 1.8;
/** The upload preparing its clip, and the editor opening, between the scenes' two sentences. */
const UPLOAD_WAIT_S = 3.1;
const EDIT_TYPING_S = 1.4;
/** The review opens on the line being picked, before its first sentence. */
const REVIEW_PICK_S = 1.6;

export function buildStoryboard(): Scene[] {
  const court = film.court.date;
  const courtEn = court.toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const courtKo = `${court.getUTCFullYear()}년 ${court.getUTCMonth() + 1}월`;
  const hand = film.handMade;
  const silence = film.hook.silence.toFixed(1);
  const wonKo = `${(hand.wonMillions * 100).toLocaleString("en-US")}만 원`;
  const gaps = film.opening.gaps.length;
  const shortest = film.opening.shortest.toFixed(1);
  const clip = film.original.clipSeconds;
  const voiced = film.line.voiced.toFixed(1);
  const room = film.line.room.toFixed(1);
  // The review scene says the draft named a city before the picture shows one.
  if (film.line.rejectedBy !== "review" || !/\bcity\b/i.test(film.line.draft.quote))
    throw new Error(
      "the review scene's line is not a reviewer's rejection of a city named too early",
    );
  return [
    {
      id: "dark",
      show: { page: "dark" },
      parts: [
        pause(CLOSE_YOUR_EYES_S),
        { film: { track: "original", from: film.hook.from, to: film.hook.to } },
        cap(
          "Seven seconds without a word. A blind viewer hears only a hum.",
          `${silence}초 동안 대사가 없습니다. 시각장애인 관객에겐 웅웅거리는 소리만 들립니다.`,
          {
            ko: [
              [
                `${silence}초 동안 대사가 없습니다.`,
                "시각장애인 관객에겐 웅웅거리는 소리만 들립니다.",
              ],
            ],
          },
        ),
        // Short: "Open your eyes." is up with it, and the reveal's label says the rest (in Korean).
        cap("This time, with Gapline's description.", "이번에는 갭라인의 화면해설과 함께."),
      ],
      hold: 0.2,
    },
    {
      id: "reveal",
      show: { film: { from: film.hook.from, to: film.hook.to } },
      parts: [{ film: { track: "described", from: film.hook.from, to: film.hook.to } }],
      hold: 0,
    },
    {
      id: "seven",
      show: { page: "seven" },
      chapter: true,
      parts: [
        cap(
          "Gapline fit two lines into that silence, each measured to end before the next word.",
          "갭라인은 이 침묵에 두 문장을 넣고, 실제 낭독 길이를 재서 둘 다 다음 대사 전에 끝냈습니다.",
          {
            ko: [
              ["갭라인은 이 침묵에 두 문장을 넣고,"],
              ["실제 낭독 길이를 재서", "둘 다 다음 대사 전에 끝냈습니다."],
            ],
          },
        ),
        cap(
          "One press of Generate runs all of it: writing, checking and voicing.",
          "생성하기 한 번이면 쓰기, 검수, 낭독까지 모두 자동으로 진행됩니다.",
        ),
      ],
      hold: 0.4,
    },
    {
      id: "stakes",
      show: { page: "stakes" },
      chapter: true,
      parts: [
        cap(
          `In ${courtEn}, Korea's Supreme Court ruled against the big cinema chains: showing films without description or captions is discrimination.`,
          `${courtKo} 대법원은 대형 영화관 3사가 화면해설과 자막 없이 영화를 상영한 것을 차별로 판단했습니다.`,
          {
            // The ruling, then what it found: two captions, each a whole clause.
            en: [
              [`In ${courtEn}, Korea's Supreme Court`, "ruled against the big cinema chains:"],
              ["showing films without description", "or captions is discrimination."],
            ],
            ko: [
              [`${courtKo} 대법원은`, "대형 영화관 3사가"],
              ["화면해설과 자막 없이 영화를", "상영한 것을 차별로 판단했습니다."],
            ],
          },
        ),
        cap(
          `Yet one accessible film still takes about ${hand.months} months and ₩${hand.wonMillions} million (US$${hand.usdThousands}k) by hand.`,
          `하지만 배리어프리 영화 한 편을 손으로 만들려면 여전히 약 ${hand.months}개월, ${wonKo}이 듭니다.`,
          {
            // One caption: "about" ends the first line rather than split the sentence in two.
            en: [
              [
                "Yet one accessible film still takes about",
                `${hand.months} months and ₩${hand.wonMillions} million (US$${hand.usdThousands}k) by hand.`,
              ],
            ],
          },
        ),
      ],
      hold: 0.4,
    },
    {
      id: "constraint",
      show: { page: "constraint" },
      parts: [
        cap(
          "Description must never talk over dialogue, so Gapline first times every spoken word.",
          "해설은 대사와 겹치면 안 되기에, 갭라인은 먼저 말소리가 나오는 시점을 모두 잽니다.",
        ),
        cap(
          `This ${clip}-second clip has ${gaps} usable silences; the shortest is ${shortest} seconds.`,
          `${clip}초 클립에서 해설이 들어갈 수 있는 침묵은 ${gaps}곳, 가장 짧은 곳은 ${shortest}초입니다.`,
          {
            en: [
              [
                `This ${clip}-second clip has ${gaps} usable silences;`,
                `the shortest is ${shortest} seconds.`,
              ],
            ],
          },
        ),
        cap(
          "Every line is written, voiced and measured to fit one of them.",
          "모든 문장은 그중 한 곳에 들어가도록 쓰고, 낭독하고, 길이를 잽니다.",
        ),
      ],
      hold: 0.4,
    },
    {
      id: "upload",
      show: { beat: "upload" },
      chapter: true,
      parts: [
        cap(
          `Upload a clip of up to ${film.maxClipSeconds} seconds.`,
          `${film.maxClipSeconds}초 이하의 클립을 올립니다.`,
        ),
        pause(UPLOAD_WAIT_S),
        cap(
          "Then one press of Generate does the rest, end to end.",
          "그다음 생성하기를 한 번 누르면, 나머지는 끝까지 자동입니다.",
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
          "Gemini writes each line from the picture, sized to fit its silence.",
          "제미나이가 화면을 보고, 침묵 길이에 맞춰 문장을 씁니다.",
          {
            en: [["Gemini writes each line from the picture,", "sized to fit its silence."]],
            ko: [["제미나이가 화면을 보고,", "침묵 길이에 맞춰 문장을 씁니다."]],
          },
        ),
        // The writer and the reviewer are the same model with separate instructions: a separate
        // review, not a second model.
        cap(
          `A separate Gemini review checks every line against ${film.rules} rules from Korea's and Netflix's guides.`,
          `제미나이가 별도 검수로 모든 문장을 한국·넷플릭스 해설 규칙 ${film.rules}가지로 검토합니다.`,
          {
            // "화면해설 규칙" would take the second line one character past the Korean limit.
            ko: [
              [
                "제미나이가 별도 검수로 모든 문장을",
                `한국·넷플릭스 해설 규칙 ${film.rules}가지로 검토합니다.`,
              ],
            ],
            // Too long for one caption: the rules and whose they are stay together in the second.
            en: [
              ["A separate Gemini review checks every line"],
              [`against ${film.rules} rules from Korea's`, "and Netflix's guides."],
            ],
          },
        ),
        cap(
          "Each line is voiced and measured; the final check sends back what fails.",
          "문장마다 낭독해 길이를 재고, 최종 점검에서 걸린 문장은 다시 씁니다.",
          {
            en: [["Each line is voiced and measured;", "the final check sends back what fails."]],
            ko: [["문장마다 낭독해 길이를 재고,", "최종 점검에서 걸린 문장은 다시 씁니다."]],
          },
        ),
      ],
      hold: 0.6,
    },
    {
      id: "review",
      show: { beat: "review" },
      parts: [
        pause(REVIEW_PICK_S),
        cap(
          "Here the reviewer sent a line back, citing the rules and the guideline pages.",
          "여기서는 검수가 문장 하나를 돌려보냈습니다. 어긴 규칙과 가이드라인의 해당 쪽이 함께 적힙니다.",
          {
            en: [
              ["Here the reviewer sent a line back,", "citing the rules and the guideline pages."],
            ],
            ko: [
              ["여기서는 검수가", "문장 하나를 돌려보냈습니다."],
              ["어긴 규칙과", "가이드라인의 해당 쪽이 함께 적힙니다."],
            ],
          },
        ),
        cap(
          "The draft named a city not yet on screen. Gapline rewrote it as suggested.",
          "초안은 아직 화면에 없는 도시를 먼저 말했습니다. 갭라인은 검수 의견대로 다시 썼습니다.",
          {
            en: [["The draft named a city not yet on screen.", "Gapline rewrote it as suggested."]],
            ko: [
              ["초안은 아직 화면에 없는", "도시를 먼저 말했습니다."],
              ["갭라인은 검수 의견대로 다시 썼습니다."],
            ],
          },
        ),
        cap(
          "The new line passed, was voiced and went into the mix, in the same run.",
          "새 문장은 검수를 통과해 낭독되고, 같은 실행 안에서 믹스까지 이어졌습니다.",
        ),
      ],
      hold: 0.6,
    },
    {
      id: "result",
      show: { beat: "result" },
      parts: [
        cap(
          `Measured, not estimated: ${voiced} seconds of voice in ${room} seconds of room.`,
          `추정이 아니라 실측입니다. 자리 ${room}초에 낭독 ${voiced}초.`,
        ),
        cap("Listen to it in the film.", "영화 속에서 들어 보세요."),
        pause(LISTEN_SLOT_S),
      ],
      hold: 0.3,
    },
    {
      id: "edit",
      show: { beat: "edit" },
      parts: [
        cap(
          "Want different words? You can still edit any line yourself.",
          "다른 표현을 원하면, 어떤 문장이든 직접 고칠 수 있습니다.",
        ),
        pause(EDIT_TYPING_S),
        cap(
          "Gapline re-voices just that line and checks the whole track again.",
          "그러면 갭라인은 그 문장만 다시 낭독하고, 트랙 전체를 다시 점검합니다.",
          {
            en: [["Gapline re-voices just that line", "and checks the whole track again."]],
            ko: [["그러면 갭라인은 그 문장만 다시 낭독하고,", "트랙 전체를 다시 점검합니다."]],
          },
        ),
      ],
      hold: 0.3,
    },
    {
      id: "cloud",
      show: { page: "cloud" },
      chapter: true,
      parts: [
        cap(
          "All of it runs on one Cloud Run service.",
          "이 모든 과정이 Cloud Run 서비스 하나에서 돌아갑니다.",
          { ko: [["이 모든 과정이", "Cloud Run 서비스 하나에서 돌아갑니다."]] },
        ),
        cap(
          "Speech-to-Text times the words, Gemini watches, writes and checks, and Text-to-Speech voices each line.",
          "음성 인식이 단어마다 시점을 재고, 제미나이가 보고 쓰고 검수하며, 음성 합성이 문장마다 낭독합니다.",
          {
            en: [
              ["Speech-to-Text times the words,", "Gemini watches, writes and checks,"],
              ["and Text-to-Speech voices each line."],
            ],
            ko: [
              ["음성 인식이 단어마다 시점을 재고,", "제미나이가 보고 쓰고 검수하며,"],
              ["음성 합성이 문장마다 낭독합니다."],
            ],
          },
        ),
        cap(
          "Cloud Storage keeps every version, and progress streams to the browser live.",
          "Cloud Storage가 모든 버전을 보관하고, 진행 상황은 브라우저에 실시간으로 전해집니다.",
        ),
      ],
      hold: 0.4,
    },
    {
      id: "close",
      show: { page: "close" },
      chapter: true,
      parts: [
        cap(
          "Gapline. Descriptions that fit between the lines.",
          "갭라인. 대사와 대사 사이에 꼭 맞는 화면해설.",
          {
            en: [["Gapline.", "Descriptions that fit between the lines."]],
          },
        ),
        cap("Try the sample with your eyes closed.", "눈을 감고 샘플을 들어 보세요."),
      ],
      hold: 1.4,
    },
  ];
}
