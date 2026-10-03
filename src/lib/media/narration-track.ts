import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpeg } from "./ffmpeg";
import { parseWav } from "./wav";

/**
 * Chirp 3 HD takes open (and often close) with 0.1–0.7 s of inaudible drift below 60 Hz plus a DC
 * offset, peaking at −43 to −33 dBFS. Edges are therefore found on a copy with everything below
 * this cut-off removed, and that copy is what is kept, so the drift never reaches the narration.
 */
const HIGH_PASS_HZ = 80;
/** Loudness is measured over windows of this length. */
const WINDOW_SECONDS = 0.01;
/** A window counts as sound above this RMS level (−50 dBFS). */
const SOUND_RMS = 32768 * 10 ** (-50 / 20);
/** Speech starts with, and ends after, this many sounding windows in a row (30 ms). */
const MIN_SOUND_WINDOWS = 3;
/**
 * A shorter sound this close to the speech belongs to it: a final stop's release comes after a
 * closure of silence (5 of 74 stored takes had one 20–70 ms after the last longer stretch).
 */
const ATTACHED_SOUND_SECONDS = 0.15;
/** Kept around the speech so consonant onsets and tails are not clipped. */
const TRIM_PAD_SECONDS = 0.04;

export interface TrimmedLine {
  pcm: Int16Array;
  sampleRate: number;
  seconds: number;
}

function monoSamples(wav: Buffer): { samples: Int16Array; sampleRate: number } {
  const info = parseWav(wav);
  if (info.channels !== 1 || info.bitsPerSample !== 16) {
    throw new Error(
      `Expected mono 16-bit narration, got ${info.channels} ch / ${info.bitsPerSample} bit`,
    );
  }
  const samples = new Int16Array(
    wav.buffer.slice(
      wav.byteOffset + info.dataOffset,
      wav.byteOffset + info.dataOffset + info.dataLength,
    ),
  );
  return { samples, sampleRate: info.sampleRate };
}

/** One-pole high-pass at HIGH_PASS_HZ, rounded back to 16-bit samples. */
function highPass(samples: Int16Array, sampleRate: number): Int16Array {
  const k = 1 / (1 + (2 * Math.PI * HIGH_PASS_HZ) / sampleRate);
  const out = new Int16Array(samples.length);
  let y = 0;
  for (let n = 0; n < samples.length; n++) {
    y = k * (y + samples[n] - (n > 0 ? samples[n - 1] : samples[0]));
    out[n] = Math.max(-32768, Math.min(32767, Math.round(y)));
  }
  return out;
}

/**
 * Cuts leading and trailing silence from a mono 16-bit WAV so its length is the spoken length:
 * speech runs from the first to the last stretch of at least 30 ms above −50 dBFS, measured after
 * the drift below 80 Hz is removed. A take with no such stretch is an error.
 */
export function trimSilence(wav: Buffer): TrimmedLine {
  const { samples, sampleRate } = monoSamples(wav);
  return trimPcm(highPass(samples, sampleRate), sampleRate);
}

function trimPcm(filtered: Int16Array, sampleRate: number): TrimmedLine {
  const size = Math.round(WINDOW_SECONDS * sampleRate);
  const count = Math.floor(filtered.length / size);
  const loud: boolean[] = [];
  for (let w = 0; w < count; w++) {
    let sum = 0;
    for (let i = w * size; i < (w + 1) * size; i++) sum += filtered[i] * filtered[i];
    loud.push(Math.sqrt(sum / size) > SOUND_RMS);
  }
  let first = -1;
  let last = -1;
  for (let w = 0, run = 0; w < count; w++) {
    run = loud[w] ? run + 1 : 0;
    if (run < MIN_SOUND_WINDOWS) continue;
    if (first < 0) first = w - MIN_SOUND_WINDOWS + 1;
    last = w;
  }
  if (first < 0) throw new Error("The synthesized line has no audible speech");
  const reach = Math.round(ATTACHED_SOUND_SECONDS / WINDOW_SECONDS);
  for (let w = first - 1; w >= 0 && first - w <= reach; w--) if (loud[w]) first = w;
  for (let w = last + 1; w < count && w - last <= reach; w++) if (loud[w]) last = w;
  const pad = Math.round(TRIM_PAD_SECONDS * sampleRate);
  const pcm = filtered.slice(
    Math.max(0, first * size - pad),
    Math.min(filtered.length, (last + 1) * size + pad),
  );
  return { pcm, sampleRate, seconds: pcm.length / sampleRate };
}

/**
 * The same take spoken `tempo` times faster, pitch kept (FFmpeg atempo), and trimmed again. Used
 * for a take slightly longer than its room: a new Text-to-Speech take at a higher rate can come back
 * as long as the first (takes of one request vary by about 10%), a stretched one cannot.
 */
export async function speedUpLine(line: TrimmedLine, tempo: number): Promise<TrimmedLine> {
  const dir = await mkdtemp(join(tmpdir(), "scene-tempo-"));
  try {
    const input = join(dir, "take.wav");
    await writeFile(input, encodeWav(line.pcm, line.sampleRate));
    const { stdout } = await runFfmpeg([
      "-i",
      input,
      "-af",
      `atempo=${tempo}`,
      "-f",
      "s16le",
      "-ac",
      "1",
      "-ar",
      String(line.sampleRate),
      "pipe:1",
    ]);
    const bytes = stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength);
    return trimPcm(new Int16Array(bytes), line.sampleRate);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function encodeWav(pcm: Int16Array, sampleRate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]);
}

/** Lays every line at its start time on a silent track as long as the clip. */
export function buildNarrationTrack(
  lines: { start: number; line: TrimmedLine }[],
  clipSeconds: number,
  sampleRate: number,
): Buffer {
  const track = new Int16Array(Math.ceil(clipSeconds * sampleRate));
  for (const { start, line } of lines) {
    if (line.sampleRate !== sampleRate)
      throw new Error("Narration lines must share one sample rate");
    const offset = Math.round(start * sampleRate);
    const end = Math.min(track.length, offset + line.pcm.length);
    for (let i = offset; i < end; i++) {
      track[i] = Math.max(-32768, Math.min(32767, track[i] + line.pcm[i - offset]));
    }
  }
  return encodeWav(track, sampleRate);
}
