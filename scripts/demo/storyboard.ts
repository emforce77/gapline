/**
 * The demo, scene by scene, in Korean and English. Every number the presenter says is read from the
 * runs the deployed service measured (demo-data.ts), never typed in.
 *
 * A scene shows one thing (a card, black, or a beat of the app recording), the presenter says its
 * sentences back to back, and some scenes then play a stretch of the film's sound.
 */
import { GUIDELINE_RULES } from "../../src/lib/pipeline/guidelines";
import type { Cue, Language } from "../../src/lib/pipeline/schemas";
import type { DemoData, DemoRun } from "./demo-data";

export type Beat = "open" | "replay" | "detail" | "listen" | "brief";
export type CardId = "problem" | "pipeline" | "numbers" | "close";

export interface Sentence {
  /** Shown as the caption. */
  text: string;
  /** Sent to text-to-speech when the caption spelling would be read wrongly. */
  speak?: string;
}

export interface FilmSound {
  track: "original" | "described";
  from: number;
  to: number;
  /** Caption while the film plays. */
  caption: string;
}

export interface Scene {
  id: string;
  show: { card: CardId } | { black: true } | { beat: Beat };
  say: Sentence[];
  film?: FilmSound;
  /** Seconds kept after the last sound of the scene. */
  hold: number;
}

/** The stretch of the film heard twice: once bare, once described. */
export const LISTEN_FROM = 43.8;
export const LISTEN_TO = 62.6;

export const PRESENTER_VOICES: Record<Language, { languageCode: string; name: string }> = {
  ko: { languageCode: "ko-KR", name: "ko-KR-Chirp3-HD-Aoede" },
  en: { languageCode: "en-US", name: "en-US-Chirp3-HD-Aoede" },
};

export const SERVICE_HOST = "scene-ad-958994530029.asia-northeast3.run.app";
export const REPO_URL = "github.com/emforce77/scene-ad";

const s = (text: string, speak?: string): Sentence => (speak ? { text, speak } : { text });

/** "4 minutes 11 seconds" / "4분 11초": written out so text-to-speech reads it naturally. */
function spokenDuration(seconds: number, lang: Language): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  if (lang === "ko") return m > 0 ? `${m}분 ${sec}초` : `${sec}초`;
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return m > 0 ? `${unit(m, "minute")} ${unit(sec, "second")}` : unit(sec, "second");
}

/**
 * The line the demo opens in the inspector. A line the reviewer rejected and Gemini genuinely rewrote
 * shows the review loop; failing that, a line whose first voicing overran its pause shows the length
 * loop. Which one depends on what the run actually did.
 */
export function featuredLine(run: DemoRun): { cue: Cue; loop: "review" | "length" } {
  const fits = run.cues.filter((c) => c.status === "fits");
  const rewritten = fits.find(
    (c) =>
      c.versions.some((v) => v.review && !v.review.pass) &&
      c.versions.some((v) => v.by === "revise" && v.text !== c.versions[0].text),
  );
  if (rewritten) return { cue: rewritten, loop: "review" };
  const shortened = fits.filter((c) => c.versions.some((v) => v.by === "shorten"));
  const cue = shortened.find((c) => c.start >= LISTEN_FROM && c.start < LISTEN_TO) ?? shortened[0];
  if (!cue) throw new Error(`${run.runId} has neither a rewritten nor a shortened line to show`);
  return { cue, loop: "length" };
}

export function buildStoryboard(lang: Language, data: DemoData): Scene[] {
  const run = data.standard;
  const summary = run.summary;
  const featured = featuredLine(run);
  const first = featured.cue.versions[0];
  const rule =
    featured.loop === "review"
      ? GUIDELINE_RULES.find(
          (r) => r.id === featured.cue.versions.find((v) => v.review && !v.review.pass)!.review!.violations[0].rule,
        )!
      : null;
  const firstSeconds = (first.voice?.seconds ?? 0).toFixed(1);
  const roomSeconds = (featured.cue.windowEnd - featured.cue.start).toFixed(1);
  const allFit = summary.cuesFitting === summary.cuesShipped;
  const duration = spokenDuration(summary.wallSeconds, lang);

  if (lang === "en") {
    const cents = Math.round(summary.costUsd * 100);
    return [
      {
        id: "cold",
        show: { black: true },
        say: [s("Close your eyes. This is a scene from a film, the way a blind viewer hears it.")],
        film: {
          track: "original",
          from: LISTEN_FROM,
          to: LISTEN_TO,
          caption: "Sound only · no description",
        },
        hold: 0.6,
      },
      {
        id: "problem",
        show: { card: "problem" },
        say: [
          s(
            "Audio description fixes that. A narrator says what is on screen, in the pauses between the lines.",
          ),
          s("In September 2026, Korea's Supreme Court widened the duty of cinemas to provide it."),
          s(
            "But it is still written, recorded and synced by hand: about fourteen million won for one Korean film.",
          ),
          s("Scene makes it automatically, with Gemini on Google Cloud."),
        ],
        hold: 0.5,
      },
      {
        id: "open",
        show: { beat: "open" },
        say: [
          s(
            "Give Scene a short clip. Here, the opening of Tears of Steel, an open movie by the Blender Foundation.",
          ),
          s(
            "The timeline shows the dialogue, the room between the words, and each narration line placed in that room.",
          ),
        ],
        hold: 0.4,
      },
      {
        id: "replay",
        show: { beat: "replay" },
        say: [
          s("This is the job as it ran on Cloud Run, replayed at high speed."),
          s("Chirp 3 times every spoken word, while Gemini watches the video."),
          s("Plain code measures the room. Gemini writes one line for each pause,"),
          s(
            "then reviews every line against eight rules from Korea's accessible broadcasting guideline and Netflix's style guide.",
          ),
        ],
        hold: 0.4,
      },
      {
        id: "detail",
        show: { beat: "detail" },
        say:
          featured.loop === "review"
            ? [
                s(`The reviewer rejected the first draft of this line: “${rule!.title.en}”.`),
                s("Gemini rewrote it, the new line passed, and Chirp 3 HD voiced it. The meter shows it fits its pause."),
              ]
            : [
                s(`The first draft of this line took ${firstSeconds} seconds to say, but its pause is only ${roomSeconds} seconds long.`),
                s("Gemini shortened it, the shorter line passed review, and now it fits."),
              ],
        hold: 0.6,
      },
      {
        id: "listen",
        show: { beat: "listen" },
        say: [s("Now the same scene again, eyes closed.")],
        film: {
          track: "described",
          from: LISTEN_FROM,
          to: LISTEN_TO,
          caption: "With Scene's description",
        },
        hold: 0.4,
      },
      {
        id: "brief",
        show: { beat: "brief" },
        say: [
          s("Viewers who want less can switch to Brief: fewer lines, only what the story needs."),
        ],
        hold: 1.0,
      },
      {
        id: "pipeline",
        show: { card: "pipeline" },
        say: [
          s(
            "Each step has its own Google model: Chirp 3 to hear, Gemini to watch, write and review, and Chirp 3 HD to speak.",
          ),
          s(
            "Plain code decides where lines go and checks every measured length. A line that runs long is sped up a little, then shortened.",
          ),
        ],
        hold: 0.5,
      },
      {
        id: "numbers",
        show: { card: "numbers" },
        say: [
          s(
            `On this ${summary.clipSeconds}-second clip, ${allFit ? "all" : summary.cuesFitting} of ` +
              `${summary.cuesShipped} lines fit their pauses, with ${summary.overlapWithSpeechSeconds === 0 ? "no" : summary.overlapWithSpeechSeconds} seconds over dialogue.`,
          ),
          s(`The whole job cost ${cents} cents and took ${duration} on Cloud Run.`),
        ],
        hold: 0.6,
      },
      {
        id: "close",
        show: { card: "close" },
        say: [s("Scene narrates in Korean and English. Try it with your own clip.")],
        hold: 2.0,
      },
    ];
  }

  return [
    {
      id: "cold",
      show: { black: true },
      say: [s("눈을 감아 보세요. 시각장애인 관객에게 영화의 한 장면은 이렇게 들립니다.")],
      film: {
        track: "original",
        from: LISTEN_FROM,
        to: LISTEN_TO,
        caption: "소리만 · 화면해설 없음",
      },
      hold: 0.6,
    },
    {
      id: "problem",
      show: { card: "problem" },
      say: [
        s("화면해설은 대사가 없는 틈에, 화면에서 벌어지는 일을 말로 들려줍니다."),
        s("2026년 9월, 대법원은 극장의 화면해설 제공 의무를 넓혔습니다."),
        s(
          "하지만 해설은 지금도 사람이 쓰고 녹음하고 맞춥니다. 한국 영화 한 편에 약 1,400만 원이 듭니다.",
          "하지만 해설은 지금도 사람이 쓰고 녹음하고 맞춥니다. 한국 영화 한 편에 약 천사백만 원이 듭니다.",
        ),
        s(
          "씬은 이 일을 구글 클라우드의 Gemini로 자동화합니다.",
          "씬은 이 일을 구글 클라우드의 제미나이로 자동화합니다.",
        ),
      ],
      hold: 0.5,
    },
    {
      id: "open",
      show: { beat: "open" },
      say: [
        s(
          "짧은 영상을 넣으면 됩니다. 블렌더 재단의 공개 영화, 〈티어스 오브 스틸〉의 도입부입니다.",
          "짧은 영상을 넣으면 됩니다. 블렌더 재단의 공개 영화, 티어스 오브 스틸의 도입부입니다.",
        ),
        s("타임라인에는 대사와, 대사 사이의 빈 구간과, 그 안에 놓인 해설 문장이 보입니다."),
      ],
      hold: 0.4,
    },
    {
      id: "replay",
      show: { beat: "replay" },
      say: [
        s(
          "Cloud Run에서 실제로 돌린 작업을 빠르게 다시 재생합니다.",
          "클라우드 런에서 실제로 돌린 작업을 빠르게 다시 재생합니다.",
        ),
        s(
          "Chirp 3가 대사를 단어 단위로 재고, Gemini가 영상을 봅니다.",
          "처프 쓰리가 대사를 단어 단위로 재고, 제미나이가 영상을 봅니다.",
        ),
        s(
          "빈 구간은 코드가 계산하고, Gemini가 구간마다 해설을 씁니다.",
          "빈 구간은 코드가 계산하고, 제미나이가 구간마다 해설을 씁니다.",
        ),
        s(
          "이어서 장애인방송 가이드라인과 넷플릭스 스타일 가이드에서 가져온 여덟 가지 규칙으로 모든 문장을 검수합니다.",
        ),
      ],
      hold: 0.4,
    },
    {
      id: "detail",
      show: { beat: "detail" },
      say:
        featured.loop === "review"
          ? [
              s(`이 문장의 초안은 ‘${rule!.title.ko}’ 규칙에 걸려 반려됐습니다.`),
              s(
                "Gemini가 다시 쓴 문장은 검수를 통과했고, Chirp 3 HD가 읽었습니다. 막대는 이 문장이 빈 구간 안에 들어간다는 뜻입니다.",
                "제미나이가 다시 쓴 문장은 검수를 통과했고, 처프 쓰리 에이치디가 읽었습니다. 막대는 이 문장이 빈 구간 안에 들어간다는 뜻입니다.",
              ),
            ]
          : [
              s(`이 문장의 초안은 읽는 데 ${firstSeconds}초가 걸렸지만, 들어갈 빈 구간은 ${roomSeconds}초뿐이었습니다.`),
              s(
                "Gemini가 줄여 쓴 문장은 검수를 통과했고, 이제 구간 안에 들어갑니다.",
                "제미나이가 줄여 쓴 문장은 검수를 통과했고, 이제 구간 안에 들어갑니다.",
              ),
            ],
      hold: 0.6,
    },
    {
      id: "listen",
      show: { beat: "listen" },
      say: [s("이제 같은 장면을 눈을 감고 다시 들어 보세요.")],
      film: {
        track: "described",
        from: LISTEN_FROM,
        to: LISTEN_TO,
        caption: "씬의 화면해설과 함께",
      },
      hold: 0.4,
    },
    {
      id: "brief",
      show: { beat: "brief" },
      say: [s("해설이 적은 쪽을 원하면 간결 모드로 바꿉니다. 이야기에 꼭 필요한 것만 남습니다.")],
      hold: 1.0,
    },
    {
      id: "pipeline",
      show: { card: "pipeline" },
      say: [
        s(
          "단계마다 구글 모델이 따로 있습니다. 듣기는 Chirp 3, 보기와 쓰기와 검수는 Gemini, 목소리는 Chirp 3 HD입니다.",
          "단계마다 구글 모델이 따로 있습니다. 듣기는 처프 쓰리, 보기와 쓰기와 검수는 제미나이, 목소리는 처프 쓰리 에이치디입니다.",
        ),
        s(
          "문장을 어디에 둘지와 실제 길이 확인은 코드가 합니다. 긴 문장은 조금 빠르게 읽고, 그래도 길면 줄입니다.",
        ),
      ],
      hold: 0.5,
    },
    {
      id: "numbers",
      show: { card: "numbers" },
      say: [
        s(
          `이 ${summary.clipSeconds}초짜리 영상에서 해설 ${summary.cuesShipped}줄 중 ${allFit ? "모두가" : `${summary.cuesFitting}줄이`} 빈 구간 안에 들어갔고, ` +
            `대사와 겹친 시간은 ${summary.overlapWithSpeechSeconds}초입니다.`,
        ),
        s(
          `Cloud Run에서 ${duration}, 비용은 ${summary.costUsd.toFixed(2)}달러였습니다.`,
          `클라우드 런에서 ${duration}, 비용은 ${summary.costUsd.toFixed(2)}달러였습니다.`,
        ),
      ],
      hold: 0.6,
    },
    {
      id: "close",
      show: { card: "close" },
      say: [s("씬은 한국어와 영어로 해설합니다. 직접 영상을 올려 보세요.")],
      hold: 2.0,
    },
  ];
}
