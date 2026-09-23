/**
 * The film's sound, which is only the film's own (captions carry the story): the bare film under the
 * dark hook, the described film under the reveal, and the described film again exactly where the
 * recording plays it. Every excerpt gets one shared gain, so the original and described passes of the
 * hook stay comparable; the gain brings all the excerpts together to -16 LUFS, which is then the
 * film's loudness (the silent stretches between them do not count toward it).
 *
 * Each excerpt is also written alone (film-ref-<k>.wav): check.ts finds it in the finished film by
 * cross-correlation, so the check note reports where each one is heard, not where it was planned.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { integratedLufs } from "../../src/lib/media/mix";
import { runFfmpeg } from "../../src/lib/media/ffmpeg";
import { CLIP_FILE } from "./config";
import type { BeatRecord } from "./recorder-kit";
import { DESCRIBED_FILM, heardExcerpt, playbackExcerpt } from "./segments";
import type { Scene } from "./storyboard";
import type { ScenePlan } from "./timing";

const TARGET_LUFS = -16;
const LIMIT = 0.89;
const FILM_FADE_S = 0.35;
const FADE_IN_S = 0.05;
const SAMPLE_RATE = 48000;

export interface Placed {
  scene: Scene;
  plan: ScenePlan;
  start: number;
  seconds: number;
  rec?: BeatRecord;
}

/** One excerpt of the film laid on the film's timeline. */
export interface FilmSound {
  /** What it is, for the check note ("dark: original film 53.03–62.60 s"). */
  label: string;
  file: string;
  /** Film seconds where it is planned to start. */
  at: number;
  /** Source seconds it is cut from, and how long it runs. */
  from: number;
  seconds: number;
  /** The excerpt decoded alone, as the check looks for it. */
  ref: string;
}

/** Every excerpt the placed scenes call for, in film order. */
export function filmSounds(placed: Placed[], workDir: string): FilmSound[] {
  const sounds: Omit<FilmSound, "ref">[] = [];
  for (const p of placed) {
    for (const part of p.plan.parts) {
      if (!("film" in part.part)) continue;
      const f = part.part.film;
      sounds.push({
        label: `${p.scene.id}: ${f.track} film ${f.from}–${f.to} s`,
        file: f.track === "original" ? CLIP_FILE : DESCRIBED_FILM,
        at: p.start + part.start,
        from: f.from,
        seconds: f.to - f.from,
      });
    }
    const played = p.rec ? playbackExcerpt(p.rec, p.seconds) : null;
    const play = played && heardExcerpt(played);
    if (play)
      sounds.push({
        label: `${p.scene.id}: described film from ${play.media.toFixed(2)} s, where the recording plays it`,
        file: DESCRIBED_FILM,
        at: p.start + play.at,
        from: play.media,
        seconds: play.seconds,
      });
  }
  return sounds.map((s, k) => ({ ...s, ref: join(workDir, `film-ref-${k}.wav`) }));
}

async function excerptLufs(s: FilmSound): Promise<number> {
  await runFfmpeg([
    "-y",
    "-ss",
    String(s.from),
    "-t",
    String(s.seconds),
    "-i",
    s.file,
    "-vn",
    "-ac",
    "2",
    "-ar",
    String(SAMPLE_RATE),
    s.ref,
  ]);
  return integratedLufs(s.ref);
}

/**
 * The FFmpeg graph that lays every excerpt at its place. adelay pads each excerpt with silence up
 * to its start, but with a file input cut by atrim that silence leaves adelay without timestamps
 * (FFmpeg 7.0.2), and amix drops it: without the aresample after amix the whole track started at
 * the first excerpt, 2.70 s early (measured 2026-09-23). aresample=async=1 fills the track from
 * zero by its timestamps, so each excerpt is heard where it was laid.
 */
export function mixGraph(sounds: FilmSound[], filmGainDb: number, total: number): string {
  const chains = sounds.map((s, k) => {
    const cut = `atrim=start=${s.from}:duration=${s.seconds},asetpts=PTS-STARTPTS,afade=t=in:d=${FADE_IN_S},afade=t=out:st=${Math.max(0, s.seconds - FILM_FADE_S)}:d=${FILM_FADE_S},`;
    return `[${k}:a]${cut}aresample=${SAMPLE_RATE},aformat=channel_layouts=stereo,volume=${filmGainDb.toFixed(2)}dB,adelay=${Math.round(s.at * 1000)}:all=1[a${k}]`;
  });
  const inputs = chains.map((_, k) => `[a${k}]`).join("");
  return `${chains.join(";\n")};\n${inputs}amix=inputs=${chains.length}:normalize=0:dropout_transition=0,aresample=async=1:first_pts=0,apad=whole_dur=${total},atrim=0:${total},alimiter=limit=${LIMIT}:level=false[out]`;
}

/** Writes the graph and renders it to a WAV of exactly `total` seconds. */
export async function renderMix(
  sounds: FilmSound[],
  filmGainDb: number,
  total: number,
  workDir: string,
): Promise<string> {
  const graphFile = join(workDir, "audio.filter");
  await writeFile(graphFile, mixGraph(sounds, filmGainDb, total));
  const audio = join(workDir, "audio.wav");
  await runFfmpeg([
    "-y",
    ...sounds.flatMap((s) => ["-i", s.file]),
    "-filter_complex_script",
    graphFile,
    "-map",
    "[out]",
    "-c:a",
    "pcm_s16le",
    audio,
  ]);
  return audio;
}

export async function mixSound(
  placed: Placed[],
  total: number,
  workDir: string,
): Promise<{ audio: string; notes: string[]; sounds: FilmSound[] }> {
  const sounds = filmSounds(placed, workDir);
  if (!sounds.length) throw new Error("no film excerpt to set the film gain from");
  const levels = await Promise.all(sounds.map(excerptLufs));
  // Loudness of the excerpts heard one after another: their energies averaged by length.
  const seconds = sounds.reduce((n, s) => n + s.seconds, 0);
  const energy = sounds.reduce((n, s, k) => n + s.seconds * 10 ** (levels[k] / 10), 0);
  const filmLufs = Math.round(10 * Math.log10(energy / seconds) * 10) / 10;
  const filmGain = TARGET_LUFS - filmLufs;
  const audio = await renderMix(sounds, filmGain, total, workDir);
  return {
    audio,
    notes: [
      `film gain ${filmGain.toFixed(1)} dB (excerpts together at ${filmLufs} LUFS: ${levels.join(", ")})`,
    ],
    sounds,
  };
}
