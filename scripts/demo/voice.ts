/**
 * The presenter's voice and the timing plan that follows from it. One Chirp 3 HD request per sentence
 * (a different voice from the film's narrator, so the two never blur). A sentence kept from an
 * earlier run with the same text and voice is used again at whatever rate it was kept, unless its
 * file is gone or clipped. A sentence that comes back faster than MAX_WPM is synthesized once more,
 * slower; one that comes back clipped (a hot first or last 20 ms) is requested again at a rate 0.01
 * away. Each request writes a file named by its sentence and rate, so a slower retry no longer shares
 * a file with the attempt it replaced, and a kept sentence (never requested again) keeps its file.
 * A recorded human take at takes/<scene>-<n>.wav replaces the synthetic sentence without any other
 * change.
 *
 * Output: runtime/demo-v3/<lang>/voice/<scene>-<n>@<rate>.wav, voice.json, ledger.jsonl
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { decodeMonoPcm, probeDurationSeconds } from "../../src/lib/media/ffmpeg";
import { synthesizeLine } from "../../src/lib/pipeline/voice";
import type { Language } from "../../src/lib/pipeline/schemas";
import { PRESENTER_VOICES } from "./config";
import type { Part, Scene } from "./storyboard";

/** Silence before the first sentence, between sentences, and around film sound. */
const LEAD_IN_SECONDS = 0.35;
const BETWEEN_SECONDS = 0.5;
const AROUND_FILM_SECONDS = 0.5;
const PRESENTER_RATE = 1.0;
/** Pace limit per sentence, and the pace a too-fast sentence is re-synthesized for. */
export const MAX_WPM = 150;
const RETRY_WPM = 138;
const MIN_RATE = 0.85;
/**
 * A file whose first or last 20 ms is louder than EDGE_MAX_DB starts or ends inside a word (Chirp
 * returned it clipped; every clean file measured -43.9 dBFS or lower). It is requested again at
 * these rate offsets in turn (the slower one may pass MIN_RATE by 0.01), then the step fails.
 */
const EDGE_SECONDS = 0.02;
const EDGE_MAX_DB = -40;
/**
 * More than a millisecond of samples at full scale is a burst, not speech: Chirp returned one
 * re-voiced sentence with 0.2 s of clipped noise before the words (1,168 samples at 0.99 or more),
 * while the 57 clean files measured on 2026-09-23 peak at 0.94 at most. Such a file is treated like
 * a clipped one.
 */
const FULL_SCALE = 0.99;
const FULL_SCALE_MAX_SECONDS = 0.001;
const EDGE_RETRY_STEPS = [-0.01, 0.01];
/** Speech starts at the first 10 ms window above SPEECH_MIN_DB and ends after the last one. */
const SPEECH_WINDOW_SECONDS = 0.01;
const SPEECH_MIN_DB = -45;
/** Chirp's LINEAR16 rate; files are decoded at it for the level measurements. */
const ANALYSIS_RATE = 24000;
const FULL_SCALE_MAX_SAMPLES = Math.round(FULL_SCALE_MAX_SECONDS * ANALYSIS_RATE);
const RATE_STEPS_PER_UNIT = 100;

const roundRate = (rate: number): number =>
  Math.round(rate * RATE_STEPS_PER_UNIT) / RATE_STEPS_PER_UNIT;

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

/** A presenter file's levels: its edges (a hot edge is a clipped word) and where its speech lies. */
export interface SpeechLevels {
  /** RMS of the first and last EDGE_SECONDS, in dBFS. */
  edges: [number, number];
  /** Samples at or above FULL_SCALE. */
  fullScale: number;
  /** Seconds from the start of the file to where speech starts, and to where it ends. */
  onset: number;
  offset: number;
}

export async function measureSpeech(file: string): Promise<SpeechLevels> {
  const pcm = await decodeMonoPcm(file, ANALYSIS_RATE);
  const dbfs = (from: number, to: number): number => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += pcm[i] * pcm[i];
    return 10 * Math.log10(sum / (to - from));
  };
  const edge = Math.round(EDGE_SECONDS * ANALYSIS_RATE);
  const span = Math.round(SPEECH_WINDOW_SECONDS * ANALYSIS_RATE);
  const loud: number[] = [];
  for (let i = 0; i + span <= pcm.length; i += span)
    if (dbfs(i, i + span) > SPEECH_MIN_DB) loud.push(i);
  if (loud.length === 0) throw new Error(`no speech above ${SPEECH_MIN_DB} dBFS in ${file}`);
  return {
    edges: [dbfs(0, edge), dbfs(pcm.length - edge, pcm.length)],
    fullScale: pcm.filter((x) => Math.abs(x) >= FULL_SCALE).length,
    onset: loud[0] / ANALYSIS_RATE,
    offset: (loud[loud.length - 1] + span) / ANALYSIS_RATE,
  };
}

/** A sentence that came back clipped at its rate and at both retry rates. */
class ClippedSentenceError extends Error {}

const clipped = (levels: SpeechLevels): boolean =>
  Math.max(...levels.edges) > EDGE_MAX_DB || levels.fullScale > FULL_SCALE_MAX_SAMPLES;
const edgesText = (levels: SpeechLevels): string =>
  levels.edges.map((db) => `${db.toFixed(1)} dBFS`).join(" / ") +
  (levels.fullScale ? `, ${levels.fullScale} full-scale samples` : "");

/**
 * The kept sentence a run can use as it is: the same scene, index, text and voice, whatever rate it
 * was kept at, with its file still there and not clipped. Null when the sentence must be requested.
 */
export async function keptSentence(
  previous: VoicedSentence[],
  want: Pick<VoicedSentence, "scene" | "index" | "text" | "voice">,
): Promise<VoicedSentence | null> {
  const kept = previous.find(
    (v) =>
      v.scene === want.scene &&
      v.index === want.index &&
      v.text === want.text &&
      v.voice === want.voice &&
      v.file !== null &&
      existsSync(v.file),
  );
  if (!kept?.file) return null;
  const levels = await measureSpeech(kept.file);
  if (!clipped(levels)) return kept;
  console.log(
    `${want.scene}-${want.index}: kept file clipped (${edgesText(levels)}), requested again`,
  );
  return null;
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
  const takesDir = join(outDir, "..", "takes");
  const voice = PRESENTER_VOICES[lang].name;
  const voiced: VoicedSentence[] = [];
  const failed: string[] = [];

  /** One request at `rate`, and again at each EDGE_RETRY_STEPS offset while it comes back clipped. */
  const synth = async (scene: string, index: number, text: string, rate: number) => {
    const tried: string[] = [];
    for (const r of [rate, ...EDGE_RETRY_STEPS.map((step) => roundRate(rate + step))]) {
      const file = join(outDir, `${scene}-${index}@${r}.wav`);
      const line = await synthesizeLine({
        text,
        language: lang,
        speakingRate: r,
        ledgerFile: join(outDir, "ledger.jsonl"),
        label: `presenter:${scene}-${index}@${r}`,
        voiceName: voice,
      });
      await writeFile(file, line.wav);
      const levels = await measureSpeech(file);
      if (!clipped(levels)) {
        const wpm = (wordsIn(text) / line.seconds) * 60;
        return { scene, index, text, voice, rate: r, file, seconds: line.seconds, wpm };
      }
      tried.push(`@${r} ${edgesText(levels)}`);
      console.log(`${scene}-${index}@${r}: clipped (${edgesText(levels)})`);
    }
    throw new ClippedSentenceError(
      `${scene}-${index} came back clipped at every rate (${tried.join("; ")}): reword it or record a take`,
    );
  };

  /** A sentence at PRESENTER_RATE, or once more slower if that comes back faster than MAX_WPM. */
  const request = async (scene: string, index: number, text: string) => {
    const first = await synth(scene, index, text, PRESENTER_RATE);
    if (first.wpm <= MAX_WPM) return first;
    const rate = Math.max(MIN_RATE, roundRate(first.rate * (RETRY_WPM / first.wpm)));
    return synth(scene, index, text, rate);
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
      const kept = await keptSentence(previous, { scene: scene.id, index, text, voice });
      if (kept) {
        voiced.push(kept);
        continue;
      }
      try {
        voiced.push(await request(scene.id, index, text));
      } catch (error) {
        if (!(error instanceof ClippedSentenceError)) throw error;
        failed.push(error.message);
      }
    }
  }
  // Written before a clipped sentence fails the step, so the next run reuses what this one paid for.
  await writeFile(manifestFile, JSON.stringify(voiced, null, 2));
  if (failed.length)
    throw new Error(`not voiced, and left out of voice.json:\n${failed.join("\n")}`);
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
