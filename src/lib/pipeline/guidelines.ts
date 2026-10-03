/**
 * The review rubric. Every rule points at a clause of a published guideline, so a rejected line can be
 * traced to a sentence a regulator or a streaming platform wrote — not to a rule we invented.
 *
 * KMCC = Korea Media & Communications Commission, 『장애인방송 프로그램 제공 가이드라인』 (accessible PDF),
 *        section 2 "화면해설방송", pages 6–10 (printed page numbers, "- 7 -" in the footer). Issued in
 *        2019 by its predecessor, the Korea Communications Commission (KCC).
 *        https://www.kmcc.go.kr/download.do?fileSeq=62457
 * NFLX = Netflix Audio Description Style Guide v2.5.
 *        https://partnerhelp.netflixstudios.com/hc/en-us/articles/215510667
 * Every clause cited below was checked against both texts on 2026-10-03 (KMCC p.8 "움직임과 동시에
 * 화면해설", NFLX §1.2 pronouns, §2.1 on-screen text, §2.5 "title", §5.1 foreshadowing among them).
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

/**
 * How the English UI names the two guides. Judges outside Korea do not know the commission's acronym,
 * so the Korean guide says what it is first.
 */
export const KMCC_EN = "Korea's broadcast audio description guideline (KMCC)";
export const NFLX_EN = "Netflix Audio Description Style Guide";

export const GUIDELINE_RULES: GuidelineRule[] = [
  {
    id: "spoiler",
    // Two halves, two clauses: p.7 holds names and relationships back until the story reveals them;
    // p.8 and Netflix §5.1 ask for description in step with the picture, not ahead of it. The timing
    // clauses lead: 3 of the 5 rejections under this rule in the team run 3519ee were lines ahead of
    // the picture, and the landing's showcase is a skyline named before its cut. Each clause says
    // which half it covers, because the landing prints the whole citation under a timing rejection
    // too ("p.7 (characters)" under a skyline read as the wrong clause, QA round 3).
    check:
      "Uses a character's name, identity or relationship before it has been spoken or shown in the clip " +
      "at that moment, or describes something before the picture shows it: a line must match the " +
      "picture from the moment it starts, so naming what appears only later in its room is too early. " +
      "Reading titles, credits or signs that are on screen at that moment is never a spoiler.",
    title: { en: "Reveals too early", ko: "스포일러 · 때 이른 해설" },
    source: {
      en:
        `${KMCC_EN} p.8 (describe movement as it happens), ` +
        "p.7 (names and relationships only once the story reveals them); " +
        `${NFLX_EN} §5.1 (foreshadowing), §1.2 (characters unnamed until introduced)`,
      ko:
        "방미통위 가이드라인 p.8 「움직임과 동시에 해설」, p.7 「인물 이름·관계는 극에서 드러난 뒤」; " +
        "Netflix 화면해설 가이드 §5.1 「영상과 동시에 해설」, §1.2 「소개 전 인물 이름 지양」",
    },
  },
  {
    id: "unseen",
    check:
      "States anything not visible or audible anywhere in this clip: outside knowledge of the film, " +
      "guesses (such as what becomes of an object when that moment is not shown), or details the " +
      "picture never shows. Something that appears later in the clip is spoiler, not unseen. " +
      "Exception: on-screen text or an action shown while dialogue was playing may be described in " +
      "the next gap, because narration cannot cover dialogue.",
    title: { en: "Not on screen", ko: "영상에 없는 정보" },
    source: {
      en: `${KMCC_EN} p.8 (no information beyond the picture), p.10 (review)`,
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
      en: `${KMCC_EN} p.9 (describe behavior, not feelings); ${NFLX_EN} §1.2 (factual, not opinionated)`,
      ko: "방미통위 가이드라인 p.9 「감정은 행동·표정 묘사로」; Netflix 화면해설 가이드 §1.2 「사실 위주, 주관 배제」",
    },
  },
  {
    id: "tense_person",
    check: "Is not in present tense and third person.",
    title: { en: "Tense or person", ko: "현재형·3인칭 위반" },
    source: {
      en: `${KMCC_EN} p.8 (present tense, neutral third person); ${NFLX_EN} §1.2 (present tense, third person)`,
      ko: "방미통위 가이드라인 p.8 「현재형, 중립적 3인칭」; Netflix 화면해설 가이드 §1.2 「현재형·3인칭」",
    },
  },
  {
    id: "viewer_frame",
    check:
      "Frames the picture from the viewer or camera ('we see', 'is shown', 'appears on screen', " +
      "'보인다', '화면에') or uses camera jargon (pan, zoom, close-up) the story does not need. A short " +
      "lead-in that names where text is written ('A sign reads:', 'A caption reads:', 'Title:', " +
      "'간판에 적힌 글,', '자막,') is not framing; 'the screen reads' is.",
    title: { en: "Viewer or camera framing", ko: "'보인다'·카메라 용어" },
    source: {
      en: `${KMCC_EN} p.8–9 (avoid 'is seen' phrasing and camera terms)`,
      ko: "방미통위 가이드라인 p.8–9 「'~이 보인다' 표현·카메라 용어 지양」",
    },
  },
  {
    id: "naming",
    check:
      "Refers to a person or object with a different name or descriptor than earlier lines use for the " +
      "same thing ('the airship' in one line, 'the vessel' in a later one).",
    title: { en: "Inconsistent naming", ko: "호칭 불일치" },
    source: {
      en: `${KMCC_EN} p.9 (consistent names for people and objects)`,
      ko: "방미통위 가이드라인 p.9 「인물 성명·사물 명칭 일관」",
    },
  },
  {
    id: "redundant",
    check:
      "Repeats what the dialogue or an obvious sound already tells the listener, or spends the gap on " +
      "something unimportant while a more important visual goes undescribed: a title, caption, sign, " +
      "or time or place card no one speaks, a new place or time, or a person not yet introduced. " +
      "Credits other than the title are the least important. The dialogue is the recognized speech " +
      "listed with the clip, and narration only speaks where none was found: reading on-screen words " +
      "repeats the dialogue only when that speech says the same words in the narration's language; " +
      "subtitles of speech in another language are read, not redundant.",
    // Two halves, two clauses: p.7 lists what must be described (so a minor detail cannot take the
    // room of on-screen text or a new place); p.8 lists what needs no description.
    // The last sentence grounds "the dialogue" in what was measured: on a captioned explainer whose
    // soundtrack is digital silence from 29 s, a reviewer rejected all 5 caption readings placed
    // there as repeating "the voiceover" (QA 2026-10-03, run b6e4aa). Subtitles of speech in another
    // language are read (Netflix §2.2): a listener who does not know that language hears none of it.
    // Credits come last, as in the writer's order (Netflix §2.5: as time permits, condensed).
    title: { en: "Redundant or low priority", ko: "중복·덜 중요한 정보" },
    source: {
      en:
        `${KMCC_EN} p.7 (must describe: characters, place, time, movement, unidentifiable ` +
        "sounds, on-screen text), p.8 (no description for sounds recognized at once or feelings " +
        `the dialogue conveys); ${NFLX_EN} §1.2 (no overload; leave out what dialogue already tells)`,
      ko:
        "방미통위 가이드라인 p.7 「반드시 해설할 요소: 등장인물·장소·시간·움직임·식별이 불가능한 " +
        "소리·자막」, p.8 「즉시 식별 가능한 소리, 대사로 알 수 있는 감정은 해설 불필요」; " +
        "Netflix 화면해설 가이드 §1.2 「대사로 알 수 있는 정보·과잉 정보 지양」",
    },
  },
  {
    id: "clarity",
    // A reviewer that sees the picture knows who "he" is; the listener does not. Judged by ear.
    // The style rules let a card or credit be read bare; a Korean reviewer rejected a bare credit as
    // unclear and its fix added "자막," (run 790315), one more round for a line the rules allow.
    check:
      "Is incomplete, ambiguous, hard to follow by ear, or crams in so much detail that it tires the " +
      "listener. Part of a longer on-screen text, cut at a sentence boundary, is complete. " +
      "Judge it as a listener who cannot see the picture and has heard only the earlier lines " +
      "and the dialogue: a pronoun or 'the …' for a person that no earlier line introduced and the " +
      "dialogue has not named is ambiguous (a first mention such as 'a man' or '남자가' introduces " +
      "one), and so is on-screen text read bare that could be " +
      "taken for the narrator's own words or an instruction to the listener ('Open your eyes.'). " +
      "A time or place card or a credit read bare ('Forty years later.', '40년 후.') is clear.",
    title: { en: "Unclear or overloaded", ko: "불명확·과잉 정보" },
    source: {
      en:
        `${KMCC_EN} p.9 (complete, clear, concise; no overload); ` +
        `${NFLX_EN} §1.2 (pronouns only when it is clear who is meant), ` +
        "§2.1 (introducing on-screen text)",
      ko:
        "방미통위 가이드라인 p.9 「완전·명확·간결, 과잉 정보 지양」; " +
        "Netflix 화면해설 가이드 §1.2 「지칭 대상이 분명할 때만 대명사」, §2.1 「화면 텍스트 소개」",
    },
  },
];

export function ruleSummaryForPrompt(): string {
  return GUIDELINE_RULES.map((r) => `- ${r.id}: ${r.check}`).join("\n");
}
