import type { Cue, Language } from "../../src/lib/pipeline/schemas";
import type { DemoData, DemoRun } from "./demo-data";
export type Beat = "open" | "replay" | "detail" | "edit" | "listen";
export type CardId = "problem" | "pipeline" | "numbers" | "close";
export interface Sentence {
  text: string;
  speak?: string;
}
export interface FilmSound {
  track: "original" | "described";
  from: number;
  to: number;
  caption: string;
}
export interface Scene {
  id: string;
  show: { card: CardId } | { black: true } | { beat: Beat };
  say: Sentence[];
  film?: FilmSound;
  hold: number;
  targetSeconds: number;
}
export const LISTEN_FROM = 54;
export const LISTEN_TO = 60.4;
export const PRESENTER_VOICES: Record<Language, { languageCode: string; name: string }> = {
  ko: { languageCode: "ko-KR", name: "ko-KR-Chirp3-HD-Aoede" },
  en: { languageCode: "en-US", name: "en-US-Chirp3-HD-Aoede" },
};
export const SERVICE_HOST = "scene-ad-958994530029.asia-northeast3.run.app";
const s = (text: string): Sentence => ({ text });
export function featuredLine(run: DemoRun): { cue: Cue; loop: "review" | "length" } {
  const cue = run.cues.find(
    (c) =>
      c.status === "fits" &&
      c.versions.some((v) => v.review && !v.review.pass) &&
      c.versions.some((v) => v.by === "revise" && v.text !== c.versions[0].text),
  );
  if (cue) return { cue, loop: "review" };
  const shortened = run.cues.find(
    (c) => c.status === "fits" && c.versions.some((v) => v.by === "shorten"),
  );
  if (!shortened) throw Error("No real improved review or length example in pinned run");
  return { cue: shortened, loop: "length" };
}
export function buildStoryboard(lang: Language, data: DemoData): Scene[] {
  const ko = lang === "ko";
  const cost = data.standard.summary.costUsd.toFixed(3);
  const elapsed = Math.round(data.standard.summary.wallSeconds);
  return [
    {
      id: "original",
      show: { black: true },
      targetSeconds: 10,
      say: [s(ko ? "먼저 원음입니다." : "First, the original soundtrack.")],
      film: {
        track: "original",
        from: LISTEN_FROM,
        to: LISTEN_TO,
        caption: ko ? "원음 · 연구실의 소리" : "Original soundtrack · laboratory ambience",
      },
      hold: 0.2,
    },
    {
      id: "described",
      show: { black: true },
      targetSeconds: 10,
      say: [s(ko ? "이번엔 화면해설을 더합니다." : "Now, with Korean audio description.")],
      film: {
        track: "described",
        from: LISTEN_FROM,
        to: LISTEN_TO,
        caption: "Korean AD: Simulation ready. A man examines a brain covered in electrodes.",
      },
      hold: 0.2,
    },
    {
      id: "problem",
      show: { card: "problem" },
      targetSeconds: 15,
      say: [
        s(
          ko
            ? "대사만으로는 장면의 변화나 인물의 행동을 알기 어렵습니다. 씬은 한국어 화면해설을 장면 근거와 실제 음성 길이로 검토하고, 편집자가 고쳐 완성하는 제작 도구입니다."
            : "Dialogue alone can miss a change of setting, an action, or essential text. Scene helps editors make Korean audio description, grounded in the picture, checked against actual voice length, and finished by a person.",
        ),
      ],
      hold: 0.2,
    },
    { id: "open", show: { beat: "open" }, targetSeconds: 5, say: [], hold: 0 },
    {
      id: "replay",
      show: { beat: "replay" },
      targetSeconds: 25,
      say: [
        s(
          ko
            ? `실제 업로드 뒤, 같은 샘플의 저장된 생성 기록을 배속으로 봅니다. 원래 처리 시간은 ${elapsed}초입니다.`
            : `After a real upload, this is the saved generation trace for the same sample, replayed at speed. Its original processing time was ${elapsed} seconds.`,
        ),
        s(
          ko
            ? "구글 음성 인식이 대사 시각을 찾고, 제미나이가 영상을 보며 문장을 씁니다. 검수와 낭독을 거친 뒤, 최종 출력에서 빠진 내용을 한 번 더 확인합니다."
            : "Google speech recognition finds dialogue timings. Gemini watches and writes, then reviews the lines. Synthesized audio is measured before mixing, and a final audit checks what survived.",
        ),
      ],
      hold: 0.2,
    },
    {
      id: "detail",
      show: { beat: "detail" },
      targetSeconds: 30,
      say: [
        s(
          ko
            ? "이 문장은 실제로 반려된 뒤 문구가 바뀌어 통과했습니다. 장면 근거와 반려 이유, 수정 이력을 같은 패널에서 확인할 수 있습니다."
            : "This line really was rejected, changed, and reviewed again. The same panel shows the scene evidence, the reason for rejection, and every version.",
        ),
        s(
          ko
            ? "지정 시각이 잘못된 공백에 속하면 다른 시점으로 옮기지 않고 반려합니다. 반려된 문장을 그대로 돌려주어도 새 개선으로 승인하지 않습니다. 자동 검수 뒤에도 누락이 남으면 검수 필요로 표시합니다."
            : "A line assigned to the wrong gap is rejected without being moved to another scene. Returning the same rejected wording cannot count as an improvement. If the final output still misses information, Scene keeps a visible review-needed status.",
        ),
      ],
      hold: 0.2,
    },
    {
      id: "edit",
      show: { beat: "edit" },
      targetSeconds: 30,
      say: [
        s(
          ko
            ? "이제 반려된 한 문장을 사람이 고칩니다. 시작 시각은 같은 공백 안에서만 조정할 수 있습니다. 앞 문장의 실제 음성 끝과 다음 문장을 침범할 수 없습니다."
            : "Now an editor corrects one rejected sentence. Its start can move only inside the same gap, after the previous voice ends and before the next line.",
        ),
        s(
          ko
            ? "수정 문장만 다시 읽고 검수합니다. 나머지 음성 파일은 그대로 재사용합니다. 원본은 보존되고 새 결과가 만들어집니다. 사람이 쓴 문장이 길면 자동으로 줄이지 않고 이유를 돌려줍니다."
            : "Only that sentence is re-voiced and checked. Every unchanged voice file is reused. The original stays available as a new result is created. If the human wording is too long, Scene returns a reason instead of silently shortening it.",
        ),
      ],
      hold: 0.2,
    },
    {
      id: "listen",
      show: { beat: "listen" },
      targetSeconds: 20,
      say: [
        s(
          ko
            ? "수정한 장면을 다시 듣습니다. 완성 영상, 해설 음성, 텍스트 자막과 검수 기록을 각각 내려받을 수 있습니다."
            : "Listen to the edited scene. The described film, narration stem, captions, and review history can each be downloaded.",
        ),
      ],
      film: {
        track: "described",
        from: LISTEN_FROM,
        to: LISTEN_TO,
        caption: "Edited Korean AD · Simulation ready. A man examines the electrode-covered brain.",
      },
      hold: 0.2,
    },
    {
      id: "numbers",
      show: { card: "numbers" },
      targetSeconds: 20,
      say: [
        s(
          ko
            ? `${data.evaluationRuns}회 중 ${data.evaluationDone}회 완료, ${data.evaluationFailed}회는 시각 오류로 중단됐습니다. 핵심 내용을 놓친 후보는 탈락했습니다.`
            : `${data.evaluationRuns} screening runs produced ${data.evaluationDone} outputs and ${data.evaluationFailed} timing failures. We kept the stronger reviewer after the cheaper candidate missed a key time jump.`,
        ),
        s(
          ko
            ? `API 비용은 ${cost}달러입니다. 클라우드 런과 스토리지, 오픈라우터로 동작합니다.`
            : `This generation cost ${cost} dollars. Cloud Run, Storage, and Secret Manager host Scene; Gemini runs through OpenRouter.`,
        ),
      ],
      hold: 0.2,
    },
    {
      id: "close",
      show: { card: "close" },
      targetSeconds: 10,
      say: [
        s(
          ko
            ? "씬. 장면을 근거로 쓰고, 사람이 고쳐 완성하는 한국어 화면해설. 표시된 주소에서 샘플을 체험할 수 있습니다."
            : "Scene. Korean audio description grounded in the scene and finished by an editor. Try the sample at the address shown.",
        ),
      ],
      hold: 0.2,
    },
  ];
}
