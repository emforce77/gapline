import { UNIT_NAME, UNITS_PER_SECOND } from "./length";
import type { Density, Gap, Language, SceneMap, SpeechSegment } from "./schemas";

/** Everything the writer and the reviewer need to know about the clip, rendered once per run. */
export interface ClipContext {
  language: Language;
  density: Density;
  clipSeconds: number;
  speech: SpeechSegment[];
  scene: SceneMap;
  gaps: Gap[];
  /** Base64 MP4 of the watching proxy, sent with each writer/reviewer call so both see the picture. */
  videoDataUrl: string;
}

const LANGUAGE_STYLE: Record<Language, string> = {
  ko:
    "Write in Korean, in the register of Korean broadcast audio description: complete present-tense " +
    "declarative sentences (-ㄴ다/-는다), neutral third person, standard Korean. " +
    "The first time the script mentions a person, introduce them by one visual trait " +
    "('빨간 우비를 입은 키 큰 여자') and keep that short description afterwards. " +
    "Read on-screen text word for word. A time or place card or a credit may be read directly as a " +
    "short phrase: '40년 후.' The film's own title follows '제목,' ('제목, 신텔.'). Any other text " +
    "(a sign, a screen, a letter, a caption, a quote, anything a listener could take for the " +
    "narrator's own words or an instruction) first says where it is written: the thing in the " +
    "story ('간판에 적힌 글, 출입 금지.', '모니터에 적힌 글, 접속 완료.'), or '자막,' only for words " +
    "laid over the picture ('자막, 눈을 떠.'). " +
    "Do not add viewer framing such as '자막이 뜬다' or '화면에 보인다'. " +
    "Transliterate names consistently (Thom → 톰, Celia → 셀리아).",
  // Netflix AD Style Guide §1.2 (introduce with a descriptor), §2.1 and §2.5 (introduce on-screen text
  // and titles). Bare text such as "Open your eyes." sounds like the narrator speaking to the listener.
  // The examples name nothing in the sample film: a Korean run copied an earlier example's "뚱뚱한"
  // onto a man who is not stout.
  en:
    "Write in English: complete present-tense sentences, third person, plain and conversational — no " +
    "bare fragments except on-screen text read as below. " +
    "The first time the script mentions a person, introduce them with 'a' or 'an' and one " +
    "distinguishing visual ('A tall woman in a red raincoat'), and an object the same way " +
    "('a newspaper'). After that, keep that short description, or use he or she only when no one " +
    "else could be meant. Never squeeze a description into a label such as 'the eyepiece man'. " +
    "Read on-screen text word for word. A time or place card or a credit may be read bare " +
    "('Forty years later.'), and the film's own title follows 'Title:'. Any other text (a sign, a " +
    "screen, a letter, a caption, a quote, anything a listener could take for the narrator's own " +
    "words or an instruction to them) starts with a short lead-in naming where it is written: the " +
    "thing in the story ('A sign reads:', 'A monitor reads:'), or 'A caption reads:' for words laid " +
    "over the picture. Never call it 'the screen', which is the viewer's. Read it whole or cut it at a " +
    "sentence boundary. Never say text 'appears on screen' or add other viewer framing.",
};

export const DENSITY_STYLE: Record<Density, string> = {
  standard:
    "Standard density: describe the key visual information in every usable gap. A long gap may hold " +
    "several lines, each placed at the moment it describes.",
  brief:
    "Brief density: only what a listener needs to follow the story — who, where, key actions and " +
    "essential on-screen text. At most one line per gap, and leave a gap empty when the soundtrack " +
    "already carries the scene.",
};

function seconds(value: number): string {
  return value.toFixed(2);
}

export function languageName(language: Language): string {
  return language === "ko" ? "Korean" : "English";
}

export function styleRules(context: ClipContext): string {
  return `${LANGUAGE_STYLE[context.language]}\n${DENSITY_STYLE[context.density]}`;
}

export function lengthRule(language: Language): string {
  return (
    `Length: the narrator speaks about ${UNITS_PER_SECOND[language]} ${UNIT_NAME[language]} per second, ` +
    `so a line with W seconds of room holds at most floor(W × ${UNITS_PER_SECOND[language]}) ` +
    `${UNIT_NAME[language]}` +
    (language === "ko" ? " (count Hangul syllables and digits, not spaces or punctuation)." : ".")
  );
}

export function renderTranscript(speech: SpeechSegment[]): string {
  if (speech.length === 0) return "(no speech)";
  return speech.map((s) => `[${seconds(s.start)}–${seconds(s.end)}] ${s.text}`).join("\n");
}

export function renderNames(scene: SceneMap): string {
  const lines = scene.characters.map((c) =>
    c.name && c.nameFirstSpokenAt !== null
      ? `- ${c.id}: ${c.look}. Name "${c.name}" may be used only from ${seconds(c.nameFirstSpokenAt)} s.`
      : `- ${c.id}: ${c.look}. No name is spoken or shown in the clip — never name this person.`,
  );
  // The watching stage hears names on its own and misspelled one that speech recognition had right
  // ("Barney" for "Barley", QA 2026-10-03); on the sample, recognition lost "Thom" altogether. So the
  // dialogue's spelling wins only for a name the dialogue also has.
  if (scene.characters.some((c) => c.name))
    lines.push(
      "Where the dialogue has one of these names near its time but spelled differently, use the " +
        "dialogue's spelling.",
    );
  return lines.join("\n");
}

export function renderScene(scene: SceneMap): string {
  const shots = scene.shots.map(
    (s) =>
      `[${seconds(s.start)}–${seconds(s.end)}] ${s.setting}. ${s.action}` +
      (s.onScreenText ? ` On-screen text: "${s.onScreenText}".` : ""),
  );
  const sounds = scene.sounds.map(
    (s) => `[${seconds(s.start)}–${seconds(s.end)}] ${s.kind}: ${s.label}`,
  );
  return `Shots:\n${shots.join("\n")}\nSounds:\n${sounds.join("\n") || "(none)"}`;
}

export function renderGaps(gaps: Gap[]): string {
  if (gaps.length === 0) return "(none)";
  return gaps
    .map(
      (g) => `- ${g.id}: ${seconds(g.start)}–${seconds(g.end)} s (${seconds(g.end - g.start)} s)`,
    )
    .join("\n");
}
