import { writeFile } from "node:fs/promises";
import { runFfmpeg } from "./ffmpeg";

/** Narration sits at the level of the film's own dialogue (the sample's dialogue measured -16.9 LUFS). */
export const NARRATION_TARGET_LUFS = -16;
/** How far the film dips while narration speaks, and how fast it gets there. */
const DUCK_GAIN = 10 ** (-9 / 20);
const DUCK_RAMP_SECONDS = 0.15;
const DUCK_HOLD_AFTER_SECONDS = 0.1;

/** Integrated loudness (EBU R128) of the whole file, read from ffmpeg's ebur128 summary. */
export async function integratedLufs(file: string): Promise<number> {
  const { stderr } = await runFfmpeg([
    "-nostats",
    "-i",
    file,
    "-vn",
    "-af",
    "ebur128",
    "-f",
    "null",
    "-",
  ]);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  const match = summary.match(/I:\s+(-?\d+(?:\.\d+)?) LUFS/);
  if (!match) throw new Error(`No integrated loudness in ebur128 output for ${file}`);
  return Number(match[1]);
}

/** Gain curve for the film track: 1 everywhere, dipping to DUCK_GAIN under each spoken line. */
function duckExpression(spans: { start: number; end: number }[]): string {
  if (spans.length === 0) return "1";
  const r = DUCK_RAMP_SECONDS;
  const bumps = spans.map(({ start, end }) => {
    const a = (start - r).toFixed(3);
    const b = (end + DUCK_HOLD_AFTER_SECONDS + r).toFixed(3);
    return `clip((t-${a})/${r},0,1)*clip((${b}-t)/${r},0,1)`;
  });
  const depth = bumps.reduce((acc, bump) => `max(${acc},${bump})`);
  return `1-${(1 - DUCK_GAIN).toFixed(4)}*${depth}`;
}

export interface MixOutputs {
  describedMp4: string;
  narrationWav: string;
  narrationGainDb: number;
}

/**
 * Writes the narration stem at dialogue loudness and the described film: original picture, film audio
 * ducked under each line, narration on top.
 */
export async function mixDescribedFilm(input: {
  clipFile: string;
  rawNarrationWav: string;
  spans: { start: number; end: number }[];
  describedMp4: string;
  narrationWav: string;
}): Promise<MixOutputs> {
  const measured = await integratedLufs(input.rawNarrationWav);
  const gainDb = NARRATION_TARGET_LUFS - measured;
  await runFfmpeg([
    "-y",
    "-i",
    input.rawNarrationWav,
    "-af",
    `volume=${gainDb.toFixed(2)}dB,alimiter=limit=0.95`,
    "-c:a",
    "pcm_s16le",
    input.narrationWav,
  ]);
  const graph = [
    `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,` +
      `volume='${duckExpression(input.spans)}':eval=frame[film]`,
    `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[voice]`,
    `[film][voice]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.97[out]`,
  ].join(";");
  const scriptFile = `${input.describedMp4}.filter.txt`;
  await writeFile(scriptFile, graph);
  await runFfmpeg([
    "-y",
    "-i",
    input.clipFile,
    "-i",
    input.narrationWav,
    "-filter_complex_script",
    scriptFile,
    "-map",
    "0:v",
    "-map",
    "[out]",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    input.describedMp4,
  ]);
  return {
    describedMp4: input.describedMp4,
    narrationWav: input.narrationWav,
    narrationGainDb: gainDb,
  };
}

function vttTime(seconds: number): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rest = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(rest, 3)}`;
}

/** WebVTT "descriptions" track: the same lines as text, for screen readers and extended AD players. */
export function describedVtt(lines: { start: number; end: number; text: string }[]): string {
  const body = lines
    .map((l, i) => `${i + 1}\n${vttTime(l.start)} --> ${vttTime(l.end)}\n${l.text}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}
