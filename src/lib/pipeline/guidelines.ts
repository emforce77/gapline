/**
 * The review rubric. Every rule points at a clause of a published guideline, so a rejected line can be
 * traced to a sentence a regulator or a streaming platform wrote — not to a rule we invented.
 *
 * KMCC = Korea Media & Communications Commission, 『장애인방송 프로그램 제공 가이드라인』 (accessible PDF),
 *        section 2 "화면해설방송", pages 6–10 (printed page numbers, "- 7 -" in the footer).
 *        https://www.kmcc.go.kr/download.do?fileSeq=62457
 * NFLX = Netflix Audio Description Style Guide v2.5.
 *        https://partnerhelp.netflixstudios.com/hc/en-us/articles/215510667
 */
export const RULE_IDS = [
  "spoiler",
  "unseen",
  "interpretation",
  "tense_person",
  "viewer_frame",
  "naming",
  "redundant",
  "clarity",
] as const;

export type RuleId = (typeof RULE_IDS)[number];

export interface GuidelineRule {
  id: RuleId;
  /** What the reviewer checks, phrased for the model. */
  check: string;
  title: { en: string; ko: string };
  source: { en: string; ko: string };
}

export const GUIDELINE_RULES: GuidelineRule[] = [
  {
    id: "spoiler",
    check:
      "Uses a character's name, identity or relationship before it has been spoken or shown in the clip " +
      "at that moment, or reveals something the story has not revealed yet. Reading titles, credits or " +
      "signs that are on screen at that moment is never a spoiler.",
    title: { en: "Reveals too early", ko: "스포일러 · 정체 선공개" },
    source: {
      en: "KMCC guideline p.7 (characters); Netflix AD Style Guide §1.2",
      ko: "방미통위 가이드라인 p.7 「등장인물」; Netflix 화면해설 가이드 §1.2",
    },
  },
  {
    id: "unseen",
    check:
      "States anything not visible or audible in this clip: outside knowledge of the film, guesses, or " +
      "details the picture does not show. Exception: on-screen text or an action shown while dialogue " +
      "was playing may be described in the next gap, because narration cannot cover dialogue.",
    title: { en: "Not on screen", ko: "영상에 없는 정보" },
    source: {
      en: "KMCC guideline p.8 (no information beyond the picture), p.10 (review)",
      ko: "방미통위 가이드라인 p.8 「영상에 나타난 정보 이상 추가 금지」, p.10 「검수」",
    },
  },
  {
    id: "interpretation",
    check:
      "Names an emotion, motive or judgment (angry, sad, beautiful, suspicious) instead of describing the " +
      "observable action or expression that lets the listener infer it.",
    title: { en: "Interprets instead of describing", ko: "감정·판단의 직접 서술" },
    source: {
      en: "KMCC guideline p.9 (describe behaviour, not feelings); Netflix AD Style Guide §1.2",
      ko: "방미통위 가이드라인 p.9 「감정은 행동·표정 묘사로」; Netflix 화면해설 가이드 §1.2",
    },
  },
  {
    id: "tense_person",
    check: "Is not in present tense and third person.",
    title: { en: "Tense or person", ko: "현재형·3인칭 위반" },
    source: {
      en: "KMCC guideline p.8 (present tense, neutral third person); Netflix AD Style Guide §1.2",
      ko: "방미통위 가이드라인 p.8 「현재형, 중립적 3인칭」; Netflix 화면해설 가이드 §1.2",
    },
  },
  {
    id: "viewer_frame",
    check:
      "Frames the picture from the viewer or camera ('we see', 'is shown', 'appears on screen', " +
      "'보인다', '화면에') or uses camera jargon (pan, zoom, close-up) the story does not need.",
    title: { en: "Viewer or camera framing", ko: "'보인다'·카메라 용어" },
    source: {
      en: "KMCC guideline p.8–9 (avoid 'is seen' phrasing and camera terms)",
      ko: "방미통위 가이드라인 p.8–9 「'~이 보인다' 표현·카메라 용어 지양」",
    },
  },
  {
    id: "naming",
    check:
      "Refers to a person or object with a different name or descriptor than earlier lines use for the " +
      "same thing.",
    title: { en: "Inconsistent naming", ko: "호칭 불일치" },
    source: {
      en: "KMCC guideline p.9 (consistent names for people and objects)",
      ko: "방미통위 가이드라인 p.9 「인물 성명·사물 명칭 일관」",
    },
  },
  {
    id: "redundant",
    check:
      "Repeats what the dialogue or an obvious sound already tells the listener, or spends the gap on " +
      "something unimportant while a more important visual goes undescribed.",
    // Two halves, two clauses: p.7 lists what must be described (so a minor detail cannot take the
    // room of on-screen text or a new place); p.8 lists what needs no description.
    title: { en: "Redundant or low priority", ko: "중복·덜 중요한 정보" },
    source: {
      en:
        "KMCC guideline p.7 (must describe: characters, place, time, movement, unidentifiable " +
        "sounds, on-screen text), p.8 (no description for sounds recognized at once or feelings " +
        "the dialogue conveys); Netflix AD Style Guide §1.2",
      ko:
        "방미통위 가이드라인 p.7 「반드시 해설할 요소: 등장인물·장소·시간·움직임·식별이 불가능한 " +
        "소리·자막」, p.8 「즉시 식별 가능한 소리, 대사로 알 수 있는 감정은 해설 불필요」; " +
        "Netflix 화면해설 가이드 §1.2",
    },
  },
  {
    id: "clarity",
    check:
      "Is incomplete, ambiguous, hard to follow by ear, or crams in so much detail that it tires the " +
      "listener.",
    title: { en: "Unclear or overloaded", ko: "불명확·과잉 정보" },
    source: {
      en: "KMCC guideline p.9 (complete, clear, concise; no overload)",
      ko: "방미통위 가이드라인 p.9 「완전·명확·간결, 과잉 정보 지양」",
    },
  },
];

export function ruleSummaryForPrompt(): string {
  return GUIDELINE_RULES.map((r) => `- ${r.id}: ${r.check}`).join("\n");
}
