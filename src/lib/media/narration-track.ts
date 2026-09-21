import { parseWav } from "./wav";

/** Below this level a sample counts as silence when trimming synthesized lines (-45 dBFS). */
const SILENCE_THRESHOLD = Math.round(32768 * 10 ** (-45 / 20));
/** Kept around the speech so consonant onsets and tails are not clipped. */
const TRIM_PAD_SECONDS = 0.04;

export interface TrimmedLine {
  pcm: Int16Array;
  sampleRate: number;
  seconds: number;
}

/** Cuts leading and trailing silence from a mono 16-bit WAV so its length is the spoken length. */
export function trimSilence(wav: Buffer): TrimmedLine {
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
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]) < SILENCE_THRESHOLD) first++;
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]) < SILENCE_THRESHOLD) last--;
  const pad = Math.round(TRIM_PAD_SECONDS * info.sampleRate);
  const pcm = samples.slice(Math.max(0, first - pad), Math.min(samples.length, last + pad + 1));
  return { pcm, sampleRate: info.sampleRate, seconds: pcm.length / info.sampleRate };
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
