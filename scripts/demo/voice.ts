/**
 * The presenter's voice: one Chirp 3 HD request per sentence (a different voice from the film's
 * narrator, so the two never blur), and the timing plan that follows from the measured lengths.
 * The recorder sizes each app beat from this plan, and the builder lays audio on it.
 *
 * Output: runtime/demo/<lang>/voice/<scene>-<n>.wav, voice.json, ledger.jsonl
 * A sentence already synthesized with the same text and voice is not requested again.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { synthesizeLine } from "../../src/lib/pipeline/voice";
import type { Language } from "../../src/lib/pipeline/schemas";
import { PRESENTER_VOICES, type Scene } from "./storyboard";

/** Silence before the first sentence, between sentences, and before film sound starts. */
const LEAD_IN_SECONDS = 0.35;
const BETWEEN_SECONDS = 0.3;
const BEFORE_FILM_SECONDS = 0.5;
const PRESENTER_RATE = 1.06;

export interface VoicedSentence {
  scene: string;
  index: number;
  text: string;
  speak: string;
  voice: string;
  file: string;
  seconds: number;
  rate?: number;
}

export interface ScenePlan {
  /** Offsets from the start of the scene. */
  speech: { start: number; seconds: number; file: string; text: string }[];
  film: { start: number; seconds: number } | null;
  /** Shortest the scene may be: all sound plus its hold. */
  minSeconds: number;
}

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
  const voice = PRESENTER_VOICES[lang].name;
  const voiced: VoicedSentence[] = [];
  for (const scene of scenes) {
    for (const [index, sentence] of scene.say.entries()) {
      const speak = sentence.speak ?? sentence.text;
      const file = join(outDir, `${scene.id}-${index}.wav`);
      const cached = previous.find(
        (v) =>
          v.file === file &&
          v.speak === speak &&
          v.voice === voice &&
          v.rate === PRESENTER_RATE &&
          existsSync(file),
      );
      if (cached) {
        voiced.push({ ...cached, text: sentence.text });
        continue;
      }
      const line = await synthesizeLine({
        text: speak,
        language: lang,
        speakingRate: PRESENTER_RATE,
        ledgerFile: join(outDir, "ledger.jsonl"),
        label: `presenter:${scene.id}-${index}`,
        voiceName: voice,
      });
      await writeFile(file, line.wav);
      voiced.push({
        scene: scene.id,
        index,
        text: sentence.text,
        speak,
        voice,
        rate: PRESENTER_RATE,
        file,
        seconds: line.seconds,
      });
    }
  }
  await writeFile(manifestFile, JSON.stringify(voiced, null, 2));
  return voiced;
}

export async function readVoiceManifest(outDir: string): Promise<VoicedSentence[]> {
  return JSON.parse(await readFile(join(outDir, "voice.json"), "utf8"));
}

export function planScene(scene: Scene, voiced: VoicedSentence[]): ScenePlan {
  const mine = voiced.filter((v) => v.scene === scene.id).sort((a, b) => a.index - b.index);
  if (mine.length !== scene.say.length) {
    throw new Error(`Scene ${scene.id}: ${mine.length} voiced sentences for ${scene.say.length}`);
  }
  let t = LEAD_IN_SECONDS;
  const speech = mine.map((v, i) => {
    const start = t + (i > 0 ? BETWEEN_SECONDS : 0);
    t = start + v.seconds;
    return { start, seconds: v.seconds, file: v.file, text: v.text };
  });
  const film = scene.film
    ? {
        start: Math.max(scene.id === "listen" ? 10 : 0, t + BEFORE_FILM_SECONDS),
        seconds: scene.film.to - scene.film.from,
      }
    : null;
  const end = film ? film.start + film.seconds : t;
  return { speech, film, minSeconds: Math.max(scene.targetSeconds, end + scene.hold) };
}
