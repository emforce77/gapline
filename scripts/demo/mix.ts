/**
 * The film's sound, which is only the film's own (captions carry the story): the bare film under the
 * dark hook, the described film under the reveal, and the described film again exactly where the
 * recording plays it. Every excerpt gets one shared gain, so the original and described passes of the
 * hook stay comparable; the gain brings all the excerpts together to -16 LUFS, which is then the
 * film's loudness (the silent stretches between them do not count toward it).
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { integratedLufs } from "../../src/lib/media/mix";
import { runFfmpeg } from "../../src/lib/media/ffmpeg";
import { CLIP_FILE } from "./config";
import { toOutput, type BeatRecord } from "./recorder-kit";
import { DESCRIBED_FILM } from "./segments";
import type { Scene } from "./storyboard";
import type { ScenePlan } from "./timing";

const TARGET_LUFS = -16;
const LIMIT = 0.89;
const FILM_FADE_S = 0.35;

export interface Placed {
  scene: Scene;
  plan: ScenePlan;
  start: number;
  seconds: number;
  rec?: BeatRecord;
}

interface Sound {
  file: string;
  at: number;
  trim: { from: number; seconds: number };
  note: string;
}

async function excerptLufs(file: string, from: number, seconds: number, out: string) {
  await runFfmpeg([
    "-y",
    "-ss",
    String(from),
    "-t",
    String(seconds),
    "-i",
    file,
    "-vn",
    "-ac",
    "2",
    "-ar",
    "48000",
    out,
  ]);
  return integratedLufs(out);
}

export async function mixSound(
  placed: Placed[],
  total: number,
  workDir: string,
): Promise<{ audio: string; notes: string[] }> {
  const sounds: Sound[] = [];
  for (const p of placed) {
    for (const part of p.plan.parts) {
      if ("film" in part.part) {
        const f = part.part.film;
        sounds.push({
          file: f.track === "original" ? CLIP_FILE : DESCRIBED_FILM,
          at: p.start + part.start,
          trim: { from: f.from, seconds: f.to - f.from },
          note: `${p.scene.id}: ${f.track} film ${f.from}–${f.to} s at ${(p.start + part.start).toFixed(2)} s`,
        });
      }
    }
    const pb = p.rec?.playback;
    if (pb && p.rec) {
      const at = toOutput(p.rec, pb.wall);
      const seconds = Math.min(toOutput(p.rec, pb.until), p.seconds) - at;
      sounds.push({
        file: DESCRIBED_FILM,
        at: p.start + at,
        trim: { from: pb.media, seconds },
        note: `${p.scene.id}: described film from ${pb.media.toFixed(2)} s for ${seconds.toFixed(2)} s at ${(p.start + at).toFixed(2)} s, where the recording plays it`,
      });
    }
  }
  if (!sounds.length) throw new Error("no film excerpt to set the film gain from");
  const levels = await Promise.all(
    sounds.map((s, k) =>
      excerptLufs(s.file, s.trim.from, s.trim.seconds, join(workDir, `film-ref-${k}.wav`)),
    ),
  );
  // Loudness of the excerpts heard one after another: their energies averaged by length.
  const seconds = sounds.reduce((n, s) => n + s.trim.seconds, 0);
  const energy = sounds.reduce((n, s, k) => n + s.trim.seconds * 10 ** (levels[k] / 10), 0);
  const filmLufs = Math.round(10 * Math.log10(energy / seconds) * 10) / 10;
  const filmGain = TARGET_LUFS - filmLufs;
  const notes = [
    `film gain ${filmGain.toFixed(1)} dB (excerpts together at ${filmLufs} LUFS: ${levels.join(", ")})`,
  ];
  const inputs: string[] = [];
  const chains = sounds.map((s, k) => {
    inputs.push("-i", s.file);
    const cut = `atrim=start=${s.trim.from}:duration=${s.trim.seconds},asetpts=PTS-STARTPTS,afade=t=in:d=0.05,afade=t=out:st=${Math.max(0, s.trim.seconds - FILM_FADE_S)}:d=${FILM_FADE_S},`;
    return `[${k}:a]${cut}aresample=48000,aformat=channel_layouts=stereo,volume=${filmGain.toFixed(2)}dB,adelay=${Math.round(s.at * 1000)}:all=1[a${k}]`;
  });
  const graph = `${chains.join(";\n")};\n${chains.map((_, k) => `[a${k}]`).join("")}amix=inputs=${chains.length}:normalize=0:dropout_transition=0,apad=whole_dur=${total},atrim=0:${total},alimiter=limit=${LIMIT}:level=false[out]`;
  const graphFile = join(workDir, "audio.filter");
  await writeFile(graphFile, graph);
  const audio = join(workDir, "audio.wav");
  await runFfmpeg([
    "-y",
    ...inputs,
    "-filter_complex_script",
    graphFile,
    "-map",
    "[out]",
    "-c:a",
    "pcm_s16le",
    audio,
  ]);
  return { audio, notes: [...notes, ...sounds.map((s) => s.note)] };
}
