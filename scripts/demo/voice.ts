/**
 * The presenter's voice and the timing plan that follows from it. One Chirp 3 HD request per sentence
 * (a different voice from the film's narrator, so the two never blur); a sentence already synthesized
 * with the same text, voice and rate is not requested again. A sentence that comes back faster than
 * MAX_WPM is synthesized once more, slower. A recorded human take at takes/<scene>-<n>.wav replaces
 * the synthetic sentence without any other change.
 *
 * Output: runtime/demo-v3/<lang>/voice/<scene>-<n>.wav, voice.json, ledger.jsonl
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { probeDurationSeconds } from "../../src/lib/media/ffmpeg";
import { synthesizeLine } from "../../src/lib/pipeline/voice";
import type { Language } from "../../src/lib/pipeline/schemas";
import { PRESENTER_VOICES, type Part, type Scene } from "./storyboard";

/** Silence before the first sentence, between sentences, and around film sound. */
const LEAD_IN_SECONDS = 0.35;
const BETWEEN_SECONDS = 0.5;
const AROUND_FILM_SECONDS = 0.5;
const PRESENTER_RATE = 1.0;
/** Pace limit per sentence, and the pace a too-fast sentence is re-synthesized for. */
export const MAX_WPM = 150;
const RETRY_WPM = 138;
const MIN_RATE = 0.85;

export interface VoicedSentence {
  scene: string;
  index: number;
  text: string;
  voice: string;
  rate: number;
  /** Null for a sentence whose length is only estimated (no audio yet). */
  file: string | null;
  seconds: number;
  wpm: number;
}

/** Pace assumed by --estimate: Chirp 3 HD Aoede at rate 1.0 (from the v2 film at 1.06). */
const ESTIMATE_WPM: Record<Language, number> = { en: 148, ko: 110 };
const ESTIMATE_PAD_SECONDS = 0.3;

export const wordsIn = (text: string): number =>
  text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

const sentencesOf = (scene: Scene, lang: Language): string[] =>
  scene.parts.flatMap((p) => ("say" in p ? [p.say[lang]] : []));

export async function voiceStoryboard(
  lang: Language,
  scenes: Scene[],
  outDir: string,
): Promise<VoicedSentence[]> {
  await mkdir(outDir, { recursive: true });
  const manifestFile = join(outDir, "voice.json");
  const previous: VoicedSentence[] = existsSync(manifestFile)
    ? JSON.parse(await readFile(manifestFile, "utf8"))
    : [];
  const takesDir = join(outDir, "..", "takes");
  const voice = PRESENTER_VOICES[lang].name;
  const voiced: VoicedSentence[] = [];

  const synth = async (scene: string, index: number, text: string, rate: number) => {
    const file = join(outDir, `${scene}-${index}.wav`);
    const cached = previous.find(
      (v) => v.file === file && v.text === text && v.voice === voice && v.rate === rate,
    );
    if (cached && existsSync(file)) return cached;
    const line = await synthesizeLine({
      text,
      language: lang,
      speakingRate: rate,
      ledgerFile: join(outDir, "ledger.jsonl"),
      label: `presenter:${scene}-${index}@${rate}`,
      voiceName: voice,
    });
    await writeFile(file, line.wav);
    const wpm = (wordsIn(text) / line.seconds) * 60;
    return { scene, index, text, voice, rate, file, seconds: line.seconds, wpm };
  };

  for (const scene of scenes) {
    for (const [index, text] of sentencesOf(scene, lang).entries()) {
      const take = join(takesDir, `${scene.id}-${index}.wav`);
      if (existsSync(take)) {
        const seconds = await probeDurationSeconds(take);
        const wpm = (wordsIn(text) / seconds) * 60;
        voiced.push({
          scene: scene.id,
          index,
          text,
          voice: "human take",
          rate: 1,
          file: take,
          seconds,
          wpm,
        });
        continue;
      }
      const first = await synth(scene.id, index, text, PRESENTER_RATE);
      if (first.wpm <= MAX_WPM) {
        voiced.push(first);
        continue;
      }
      const rate = Math.max(
        MIN_RATE,
        Math.round(PRESENTER_RATE * (RETRY_WPM / first.wpm) * 100) / 100,
      );
      voiced.push(await synth(scene.id, index, text, rate));
    }
  }
  await writeFile(manifestFile, JSON.stringify(voiced, null, 2));
  return voiced;
}

/**
 * A draft plan without audio: every sentence gets the length it would have at ESTIMATE_WPM. The
 * builder lays no presenter sound for these and the check note says the film is not voiced.
 */
export async function estimateStoryboard(
  lang: Language,
  scenes: Scene[],
  outDir: string,
): Promise<VoicedSentence[]> {
  await mkdir(outDir, { recursive: true });
  const voiced = scenes.flatMap((scene) =>
    sentencesOf(scene, lang).map((text, index) => {
      const seconds = (wordsIn(text) / ESTIMATE_WPM[lang]) * 60 + ESTIMATE_PAD_SECONDS;
      const wpm = (wordsIn(text) / seconds) * 60;
      return { scene: scene.id, index, text, voice: "estimate", rate: 1, file: null, seconds, wpm };
    }),
  );
  await writeFile(join(outDir, "voice.json"), JSON.stringify(voiced, null, 2));
  return voiced;
}

export async function readVoiceManifest(outDir: string): Promise<VoicedSentence[]> {
  return JSON.parse(await readFile(join(outDir, "voice.json"), "utf8"));
}

export interface PlannedPart {
  part: Part;
  /** Seconds from the start of the scene. */
  start: number;
  seconds: number;
  /** Set on sentences. */
  sentence?: VoicedSentence;
}

export interface ScenePlan {
  parts: PlannedPart[];
  /** Start of each sentence, in order: the times the picture keys its moves to. */
  sentenceStarts: number[];
  seconds: number;
}

/** Where each sentence, film sound and pause of a scene falls, from the measured voice. */
export function planScene(scene: Scene, voiced: VoicedSentence[]): ScenePlan {
  const mine = voiced.filter((v) => v.scene === scene.id).sort((a, b) => a.index - b.index);
  const says = scene.parts.filter((p) => "say" in p).length;
  if (mine.length !== says)
    throw new Error(`Scene ${scene.id}: ${mine.length} voiced sentences for ${says}`);
  let t = "say" in scene.parts[0] ? LEAD_IN_SECONDS : 0;
  let prev: Part | null = null;
  let k = 0;
  const parts: PlannedPart[] = scene.parts.map((part) => {
    if (prev && "say" in part && "say" in prev) t += BETWEEN_SECONDS;
    if (prev && ("film" in part || "film" in prev) && !("pause" in part)) t += AROUND_FILM_SECONDS;
    prev = part;
    const start = t;
    if ("say" in part) {
      const sentence = mine[k++];
      t += sentence.seconds;
      return { part, start, seconds: sentence.seconds, sentence };
    }
    const seconds = "film" in part ? part.film.to - part.film.from : part.pause;
    t += seconds;
    return { part, start, seconds };
  });
  return {
    parts,
    sentenceStarts: parts.filter((p) => p.sentence).map((p) => p.start),
    seconds: t + scene.hold,
  };
}
