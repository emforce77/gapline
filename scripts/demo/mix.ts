/**
 * The film's sound: presenter sentences at their planned times, the bare film under the dark hook,
 * the described film under the reveal, and the described film again exactly where the recording plays
 * it. The presenter is brought to -16 LUFS as a whole; every film excerpt gets one shared gain (set
 * from the described reveal), so the original and described passes of the hook stay comparable.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { integratedLufs } from "../../src/lib/media/mix";
import { runFfmpeg } from "../../src/lib/media/ffmpeg";
import { CLIP_FILE } from "./config";
import { toOutput, type BeatRecord } from "./recorder-kit";
import { DESCRIBED_FILM } from "./segments";
import type { Scene } from "./storyboard";
import type { ScenePlan } from "./voice";

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
  gain: "presenter" | "film";
  trim?: { from: number; seconds: number };
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
      if (part.sentence?.file)
        sounds.push({
          file: part.sentence.file,
          at: p.start + part.start,
          gain: "presenter",
          note: "",
        });
      if ("film" in part.part) {
        const f = part.part.film;
        sounds.push({
          file: f.track === "original" ? CLIP_FILE : DESCRIBED_FILM,
          at: p.start + part.start,
          gain: "film",
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
        gain: "film",
        trim: { from: pb.media, seconds },
        note: `${p.scene.id}: described film from ${pb.media.toFixed(2)} s for ${seconds.toFixed(2)} s at ${(p.start + at).toFixed(2)} s, where the recording plays it`,
      });
    }
  }
  const reveal = sounds.find((s) => s.gain === "film" && s.file === DESCRIBED_FILM && s.trim);
  if (!reveal?.trim) throw new Error("no described film excerpt to set the film gain from");
  const filmLufs = await excerptLufs(
    reveal.file,
    reveal.trim.from,
    reveal.trim.seconds,
    join(workDir, "film-ref.wav"),
  );
  const gains = { film: TARGET_LUFS - filmLufs, presenter: 0 };
  const presenterFiles = sounds.filter((s) => s.gain === "presenter").map((s) => s.file);
  const notes = [`film gain ${gains.film.toFixed(1)} dB (described reveal at ${filmLufs} LUFS)`];
  if (presenterFiles.length) {
    const list = join(workDir, "presenter.ffconcat");
    await writeFile(
      list,
      `ffconcat version 1.0\n${presenterFiles.map((f) => `file '${f}'`).join("\n")}\n`,
    );
    const all = join(workDir, "presenter-all.wav");
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", list, all]);
    const lufs = await integratedLufs(all);
    gains.presenter = TARGET_LUFS - lufs;
    notes.push(`presenter gain ${gains.presenter.toFixed(1)} dB (${lufs} LUFS)`);
  }
  const inputs: string[] = [];
  const chains = sounds.map((s, k) => {
    inputs.push("-i", s.file);
    const cut = s.trim
      ? `atrim=start=${s.trim.from}:duration=${s.trim.seconds},asetpts=PTS-STARTPTS,afade=t=in:d=0.05,afade=t=out:st=${Math.max(0, s.trim.seconds - FILM_FADE_S)}:d=${FILM_FADE_S},`
      : "";
    return `[${k}:a]${cut}aresample=48000,aformat=channel_layouts=stereo,volume=${gains[s.gain].toFixed(2)}dB,adelay=${Math.round(s.at * 1000)}:all=1[a${k}]`;
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
  return { audio, notes: [...notes, ...sounds.filter((s) => s.note).map((s) => s.note)] };
}
