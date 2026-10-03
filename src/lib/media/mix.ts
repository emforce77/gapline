import { randomBytes } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Language } from "../pipeline/schemas";
import { webVtt, type TimedText } from "../srt";
import { copyFileByStream, runFfmpeg, withScratchDir } from "./ffmpeg";

/*
 * Levels follow the film around each line, read from its EBU R128 momentary loudness (every
 * 100 ms). The narration sits a little above the film's usual level near the line, between a floor
 * and a ceiling. Under the line the film is lowered, moment by moment, until the narration is
 * SPEECH_OVER_FILM_LU louder than it. Fixed levels (−16 LUFS narration, −9 dB dip) buried the
 * sample's first line under the rocket launch and put the narration 14 LU over Big Buck Bunny's
 * meadow (QA, 2026-10-03).
 */
/** How far the narration sits above the film's usual level around its line. */
const NARRATION_OVER_FILM_LU = 4;
/** The loudest narration, the sample's dialogue level (−16.9 LUFS); louder lines hit the limiter. */
const NARRATION_MAX_LUFS = -16;
/** The quietest narration, for the quietest films (Big Buck Bunny's meadow measures about −30). */
const NARRATION_MIN_LUFS = -26;
/** A film with no sound at all has nothing to follow; the narration speaks at dialogue level. */
const NARRATION_ALONE_LUFS = -16;
/** Change it with the loudness measurement, so readings kept from an older one are not reused. */
const FILM_LOUDNESS_VERSION = "loudness-v1";
/** The film's usual level near a line is read over the line and this long before it. */
const CONTEXT_BEFORE_SECONDS = 3;
/** Under a line the film is lowered until the narration is this much louder than it. */
const SPEECH_OVER_FILM_LU = 10;
/** Every line lowers the film at least this much, and never more than the maximum. */
const MIN_DUCK_DB = 3;
const MAX_DUCK_DB = 20;
/** The film's level at a moment is read from this long either side of it. */
const FILM_LEVEL_SPREAD_SECONDS = 0.5;
/** The dip starts this early, so it is in place when the line (or a swell under it) starts. */
const DUCK_ATTACK_SECONDS = 0.3;
/** After a line the film stays down this long, then comes back at DUCK_RELEASE_DB_PER_SECOND. */
const DUCK_HOLD_SECONDS = 0.1;
const DUCK_RELEASE_DB_PER_SECOND = 20;
/** Between lines closer than this the film stays down, so it does not bob up for a moment. */
const DUCK_BRIDGE_SECONDS = 2;
/** Points per second of the film's gain curve; ffmpeg resamples it to the audio rate. */
const ENVELOPE_RATE = 100;
/**
 * Sample-peak ceilings with auto level off (alimiter's default scales its output back up to
 * 0 dBFS), so true peaks stay under −1 dBTP: the stem measures −1.25. The AAC encode adds up to
 * about 2 dB over the mix's ceiling on a loud master: Sintel's opening reached −0.98 dBTP at 0.8,
 * and Sintel brick-walled to −6.8 LUFS −0.3 dBTP at 0.75, −2.2 at 0.7 (review, 2026-10-03).
 */
const STEM_LIMIT = 0.85;
const MIX_LIMIT = 0.7;
/** The narration's gain is applied every 10 ms (240 samples at 24 kHz), not per decoded frame. */
const GAIN_STEP_SAMPLES = 240;
/** EBU R128 gates (ITU-R BS.1770-4). */
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_LU = -10;
/**
 * Readings this far under a stretch's mean are the silence between its sounds, not its level (the
 * gate EBU Tech 3342 uses for loudness range). Without it, the silence before Sintel's opening put
 * its first line 7 LU under the film and lowered the film 20 dB to make up for it (QA, 2026-10-03).
 */
const USUAL_LEVEL_GATE_LU = -20;
/** ebur128 prints one momentary reading per 100 ms, over the 400 ms that end there. */
const MOMENTARY_WINDOW_SECONDS = 0.4;

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

/** Momentary loudness of the 400 ms that end at t. */
export interface LoudnessReading {
  t: number;
  lufs: number;
}

/** Every momentary reading of a file's sound, from ffmpeg's ebur128 frame log. */
export async function momentaryLoudness(file: string): Promise<LoudnessReading[]> {
  const { stderr } = await runFfmpeg([
    "-nostats",
    "-i",
    file,
    "-vn",
    "-af",
    "ebur128=framelog=info",
    "-f",
    "null",
    "-",
  ]);
  const readings: LoudnessReading[] = [];
  for (const m of stderr.matchAll(/ t: *(\d+(?:\.\d+)?) +TARGET:.*? M: *(-?\d+(?:\.\d+)?|-inf)/g))
    readings.push({ t: Number(m[1]), lufs: m[2] === "-inf" ? -Infinity : Number(m[2]) });
  if (readings.length === 0) throw new Error(`No momentary loudness in ebur128 output for ${file}`);
  return readings;
}

/**
 * The film's momentary loudness, measured once and kept beside the clip: every run and edit of a
 * project mixes the same film. ebur128 took 0.3 s on the sample but 2.6 s on a 90 s upload whose
 * last 61 s are digital silence, where decoding takes 0.15 s (ffmpeg 5.1, 2 cores, review
 * 2026-10-03). Named after the clip's size and modification time, like its watching copy
 * (proxies.ts), so a clip prepared again is measured again. JSON has no −Infinity: silence is kept
 * as null.
 */
export async function filmLoudness(clipFile: string): Promise<LoudnessReading[]> {
  const { size, mtimeMs } = await stat(clipFile);
  const file = join(
    dirname(clipFile),
    `${FILM_LOUDNESS_VERSION}-${size}-${Math.trunc(mtimeMs)}.json`,
  );
  try {
    const kept: [number, number | null][] = JSON.parse(await readFile(file, "utf8"));
    return kept.map(([t, lufs]) => ({ t, lufs: lufs ?? -Infinity }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const readings = await momentaryLoudness(clipFile);
  const partial = `${file}.${randomBytes(4).toString("hex")}.part`;
  await writeFile(
    partial,
    JSON.stringify(readings.map(({ t, lufs }) => [t, lufs === -Infinity ? null : lufs])),
  );
  await rename(partial, file);
  return readings;
}

/** The audible readings whose 400 ms window lies at least half inside [start, end]. */
function readingsWithin(readings: LoudnessReading[], start: number, end: number): number[] {
  const half = MOMENTARY_WINDOW_SECONDS / 2;
  return readings
    .filter((r) => r.t >= start + half && r.t <= end + half && r.lufs > ABSOLUTE_GATE_LUFS)
    .map((r) => r.lufs);
}

const energyMean = (values: number[]) =>
  10 * Math.log10(values.reduce((sum, l) => sum + 10 ** (l / 10), 0) / values.length);

/** Gated loudness (BS.1770) of [start, end]; −Infinity when that stretch is silent. */
export function stretchLoudness(readings: LoudnessReading[], start: number, end: number): number {
  const inside = readingsWithin(readings, start, end);
  if (inside.length === 0) return -Infinity;
  const gate = energyMean(inside) + RELATIVE_GATE_LU;
  return energyMean(inside.filter((l) => l > gate));
}

/**
 * The film's usual level over [start, end]: the median reading that is not silence, which a swell
 * does not move. −Infinity when the stretch is silent.
 */
export function usualLoudness(readings: LoudnessReading[], start: number, end: number): number {
  const inside = readingsWithin(readings, start, end);
  if (inside.length === 0) return -Infinity;
  const gate = energyMean(inside) + USUAL_LEVEL_GATE_LU;
  const heard = inside.filter((l) => l > gate).sort((a, b) => a - b);
  return heard[Math.floor(heard.length / 2)];
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export interface NarrationLevel extends TimedText {
  /** The film's usual level around the line (−Infinity when silent). */
  filmAroundLufs: number;
  /** The level the line is set to, and the gain that takes the synthesized voice there. */
  narrationLufs: number;
  gainDb: number;
}

/**
 * Each line's narration level, from the film's and the raw narration's momentary loudness. Pure,
 * like duckEnvelope, so the rules are tested without ffmpeg.
 */
export function planNarration(input: {
  film: LoudnessReading[];
  narration: LoudnessReading[];
  lines: TimedText[];
}): NarrationLevel[] {
  // A line over a silent stretch follows the film's usual level over the whole clip. Following its
  // silent surroundings put it at the floor, 10 LU under the film's other lines (review, 2026-10-03).
  const filmUsualLufs = usualLoudness(input.film, 0, Infinity);
  return input.lines.map((line) => {
    const spoken = stretchLoudness(input.narration, line.start, line.end);
    if (spoken === -Infinity)
      throw new Error(`Narration is silent at ${line.start.toFixed(2)} s: "${line.text}"`);
    const filmAroundLufs = usualLoudness(input.film, line.start - CONTEXT_BEFORE_SECONDS, line.end);
    const followed = filmAroundLufs === -Infinity ? filmUsualLufs : filmAroundLufs;
    const narrationLufs =
      followed === -Infinity
        ? NARRATION_ALONE_LUFS
        : clamp(followed + NARRATION_OVER_FILM_LU, NARRATION_MIN_LUFS, NARRATION_MAX_LUFS);
    return { ...line, filmAroundLufs, narrationLufs, gainDb: narrationLufs - spoken };
  });
}

/**
 * How far the film is lowered (dB) at each 1/ENVELOPE_RATE s up to `seconds`. Under each line,
 * and between lines too close to come back up, the film goes down until the voice (its measured
 * loudness on the line) is SPEECH_OVER_FILM_LU above the film's level at that moment, at least
 * MIN_DUCK_DB and at most MAX_DUCK_DB. The dip changes linearly in dB: it starts going down
 * DUCK_ATTACK_SECONDS ahead, fast enough to be in place, and comes back at
 * DUCK_RELEASE_DB_PER_SECOND.
 */
export function duckEnvelope(input: {
  film: LoudnessReading[];
  lines: { start: number; end: number; voiceLufs: number }[];
  seconds: number;
}): Float32Array {
  const n = Math.ceil(input.seconds * ENVELOPE_RATE) + 1;
  const at = (seconds: number) => clamp(Math.round(seconds * ENVELOPE_RATE), 0, n);
  // The film's loudness around each point: the energy mean of the readings (centred on t − 0.2 s)
  // within FILM_LEVEL_SPREAD_SECONDS, so the dip rides swells but not every flicker.
  const energy = new Float64Array(n);
  const count = new Float64Array(n);
  for (const r of input.film) {
    const centre = r.t - MOMENTARY_WINDOW_SECONDS / 2;
    for (
      let k = at(centre - FILM_LEVEL_SPREAD_SECONDS);
      k < at(centre + FILM_LEVEL_SPREAD_SECONDS);
      k++
    ) {
      energy[k] += 10 ** (r.lufs / 10);
      count[k]++;
    }
  }
  const filmLevel = (k: number) =>
    count[k] === 0 ? -Infinity : 10 * Math.log10(energy[k] / count[k]);
  const wanted = new Float32Array(n);
  const sorted = [...input.lines].sort((a, b) => a.start - b.start);
  sorted.forEach((line, i) => {
    const before = sorted[i - 1];
    const after = sorted[i + 1];
    const from =
      before && line.start - before.end < DUCK_BRIDGE_SECONDS
        ? (before.end + line.start) / 2
        : line.start;
    const until =
      after && after.start - line.end < DUCK_BRIDGE_SECONDS
        ? (line.end + after.start) / 2
        : line.end + DUCK_HOLD_SECONDS;
    for (let k = at(from); k < at(until); k++)
      wanted[k] = clamp(
        filmLevel(k) + SPEECH_OVER_FILM_LU - line.voiceLufs,
        MIN_DUCK_DB,
        MAX_DUCK_DB,
      );
  });
  // Backwards, the dip starts early enough to reach each depth in DUCK_ATTACK_SECONDS; forwards,
  // it comes back no faster than the release. It is never shallower than wanted.
  const down = MAX_DUCK_DB / (DUCK_ATTACK_SECONDS * ENVELOPE_RATE);
  const up = DUCK_RELEASE_DB_PER_SECOND / ENVELOPE_RATE;
  const depth = new Float32Array(n);
  for (let k = n - 1; k >= 0; k--)
    depth[k] = Math.max(wanted[k], k === n - 1 ? 0 : depth[k + 1] - down);
  for (let k = 1; k < n; k++) depth[k] = Math.max(depth[k], depth[k - 1] - up);
  return depth;
}

/** The narration's gain: each line's own, switching halfway through the silence between lines. */
function narrationGainExpression(lines: NarrationLevel[]): string {
  const sorted = [...lines].sort((a, b) => a.start - b.start);
  if (sorted.length === 0) return "1";
  const gain = (line: NarrationLevel) => (10 ** (line.gainDb / 20)).toFixed(5);
  return sorted
    .slice(0, -1)
    .reduceRight(
      (rest, line, i) =>
        `if(lt(t,${((line.end + sorted[i + 1].start) / 2).toFixed(3)}),${gain(line)},${rest})`,
      gain(sorted.at(-1)!),
    );
}

/** ISO 639-2 tags and names for the described film's streams. */
const TRACK_LANGUAGE: Record<Language, { iso: string; name: string }> = {
  en: { iso: "eng", name: "English" },
  ko: { iso: "kor", name: "Korean" },
};

export interface MixLine extends NarrationLevel {
  /** The voice's measured loudness in the stem, and the deepest the film went under it. */
  voiceLufs: number;
  maxDuckDb: number;
}

export interface MixOutputs {
  describedMp4: string;
  narrationWav: string;
  lines: MixLine[];
}

/**
 * Writes the narration stem and the described film: original picture, film audio lowered under
 * each line, narration on top. Audio is tagged with the narration language and marked as audio
 * description. The lines are not muxed as a text track: the MP4 muxer always enables the only
 * subtitle track (even with `-disposition:s:0 0`), so players that show enabled text tracks could
 * put the descriptions on screen for everyone, and that was not checked in QuickTime, VLC or
 * Safari (QA and review, 2026-10-03). The WebVTT file carries the text. ffmpeg writes into a local
 * folder; each finished file is then copied to its place in one pass (see withScratchDir).
 */
export async function mixDescribedFilm(input: {
  clipFile: string;
  rawNarrationWav: string;
  /** The shipped lines: where each is heard. */
  spans: TimedText[];
  language: Language;
  describedMp4: string;
  narrationWav: string;
}): Promise<MixOutputs> {
  const film = await filmLoudness(input.clipFile);
  const levels =
    input.spans.length === 0
      ? []
      : planNarration({
          film,
          narration: await momentaryLoudness(input.rawNarrationWav),
          lines: input.spans,
        });
  const track = TRACK_LANGUAGE[input.language];
  const lines = await withScratchDir(async (local) => {
    const narrationWav = join(local, "narration.wav");
    const describedMp4 = join(local, "described.mp4");
    await runFfmpeg([
      "-y",
      "-i",
      input.rawNarrationWav,
      "-af",
      `asetnsamples=n=${GAIN_STEP_SAMPLES}:p=0,` +
        `volume='${narrationGainExpression(levels)}':eval=frame,` +
        `alimiter=limit=${STEM_LIMIT}:level=false`,
      "-c:a",
      "pcm_s16le",
      narrationWav,
    ]);
    // The dip follows the voice as rendered: the limiter can take a little off a loud line.
    const stem = levels.length === 0 ? [] : await momentaryLoudness(narrationWav);
    const voiced = levels.map((line) => ({
      ...line,
      voiceLufs: stretchLoudness(stem, line.start, line.end),
    }));
    const depth = duckEnvelope({ film, lines: voiced, seconds: film.at(-1)!.t + 1 });
    const gainFile = join(local, "film-gain.f32");
    await writeFile(gainFile, Buffer.from(depth.map((db) => 10 ** (-db / 20)).buffer));
    const graph = [
      `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[film]`,
      `[2:a]aresample=48000,pan=stereo|c0=c0|c1=c0,aformat=sample_fmts=fltp[gain]`,
      `[film][gain]amultiply[ducked]`,
      `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[voice]`,
      `[ducked][voice]amix=inputs=2:duration=first:normalize=0,` +
        `alimiter=limit=${MIX_LIMIT}:level=false,afade=t=in:d=0.02[out]`,
    ].join(";");
    const scriptFile = join(local, "mix.filter.txt");
    await writeFile(scriptFile, graph);
    await runFfmpeg([
      "-y",
      "-i",
      input.clipFile,
      "-i",
      narrationWav,
      "-f",
      "f32le",
      "-ar",
      String(ENVELOPE_RATE),
      "-ac",
      "1",
      "-i",
      gainFile,
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
      "-metadata:s:a:0",
      `language=${track.iso}`,
      "-metadata:s:a:0",
      `handler_name=Film with ${track.name} audio description`,
      "-disposition:a:0",
      "default+visual_impaired",
      "-movflags",
      "+faststart",
      describedMp4,
    ]);
    await copyFileByStream(narrationWav, input.narrationWav);
    await copyFileByStream(describedMp4, input.describedMp4);
    return voiced.map((line) => ({
      ...line,
      maxDuckDb: Math.max(
        ...depth.subarray(
          Math.floor(line.start * ENVELOPE_RATE),
          Math.ceil(line.end * ENVELOPE_RATE) + 1,
        ),
      ),
    }));
  });
  return { describedMp4: input.describedMp4, narrationWav: input.narrationWav, lines };
}

/** WebVTT "descriptions" track: the same lines as text, for screen readers and extended AD players. */
export function describedVtt(lines: TimedText[]): string {
  return webVtt(lines);
}
