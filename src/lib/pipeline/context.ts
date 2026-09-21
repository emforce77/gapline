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
    "declarative sentences (-ㄴ다/-는다), neutral third person, standard Korean — no bare noun phrases. " +
    "Read on-screen text inside a sentence, quoting it: '“40년 후”라는 자막이 뜬다.' " +
    "Transliterate names consistently (Thom → 톰, Celia → 셀리아).",
  en:
    "Write in English: complete present-tense sentences, third person, plain and conversational — no " +
    "bare fragments. Read on-screen text inside a sentence, quoting it: 'The words “Forty years later” " +
    "appear.'",
};

const DENSITY_STYLE: Record<Density, string> = {
  standard:
    "Standard density: describe the key visual information in every usable gap. A long gap may hold " +
    "several lines, each placed at the moment it describes.",
  brief:
    "Brief density: only what a listener needs to follow the story — who, where, key actions and " +
    "essential on-screen text. At most one line per gap, and leave a gap empty when the soundtrack " +
    "already carries the scene.",
};

function seconds(value: number): string {
  return value.toFixed(1);
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
      : `- ${c.id}: ${c.look}. No name is spoken in the clip — never name this person.`,
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
  return gaps
    .map(
      (g) => `- ${g.id}: ${seconds(g.start)}–${seconds(g.end)} s (${seconds(g.end - g.start)} s)`,
    )
    .join("\n");
}
