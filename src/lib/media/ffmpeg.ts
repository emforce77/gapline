import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";

/** Resolved once: a static build locally (FFMPEG_PATH), the apt package in the container. */
export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

export interface FfmpegResult {
  stderr: string;
  stdout: Buffer;
}

/** ffmpeg exited non-zero; the message carries the tail of its stderr (for logs, not for viewers). */
export class FfmpegError extends Error {}

/** Runs ffmpeg and throws with the tail of stderr when it exits non-zero. */
export function runFfmpeg(args: string[]): Promise<FfmpegResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ["-hide_banner", "-nostdin", ...args]);
    const out: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stderr, stdout: Buffer.concat(out) });
        return;
      }
      reject(new FfmpegError(`ffmpeg exited ${code}: ${stderr.split("\n").slice(-8).join("\n")}`));
    });
  });
}

/**
 * Runs work in a fresh local folder and removes it afterwards. ffmpeg writes its outputs there, not
 * on the data volume: the MP4 and WAV muxers seek back to patch their headers, and the GCS FUSE
 * mount accepts only appends (it logs OutOfOrderError and stages the whole file again).
 */
export async function withScratchDir<T>(work: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "scene-ff-"));
  try {
    return await work(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Copies a finished file in one front-to-back write. Not fs.copyFile (GCS FUSE has no
 * copy_file_range) and not rename (the scratch folder is on another device).
 */
export async function copyFileByStream(from: string, to: string): Promise<void> {
  await pipeline(createReadStream(from), createWriteStream(to));
}

/** Container duration in seconds, read from ffmpeg's own header dump (there is no ffprobe). */
export async function probeDurationSeconds(file: string): Promise<number> {
  const { stderr } = await runFfmpeg(["-i", file, "-f", "null", "-t", "0", "-"]);
  const match = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`No duration in ffmpeg header for ${file}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

/**
 * Presentation times in seconds of the first video stream's keyframes, sorted, from a pass that
 * reads the packets without decoding any (about 0.05 s for a 90 s 1080p clip).
 */
export async function keyframeTimes(file: string): Promise<number[]> {
  const { stdout } = await runFfmpeg([
    "-i",
    file,
    "-map",
    "0:v:0",
    "-c",
    "copy",
    "-f",
    "framecrc",
    "-",
  ]);
  return readKeyframeTimes(stdout.toString());
}

/**
 * Keyframe times from ffmpeg's framecrc listing: one line per packet (stream, dts, pts, duration,
 * size, hash), with flags appended (", F=0x…") only when they are not exactly "keyframe".
 */
export function readKeyframeTimes(listing: string): number[] {
  const base = listing.match(/^#tb 0: (\d+)\/(\d+)$/m);
  if (!base) throw new Error("No time base in ffmpeg's packet listing");
  const secondsPerTick = Number(base[1]) / Number(base[2]);
  return listing
    .split("\n")
    .filter((line) => line.startsWith("0,") && !line.includes("F="))
    .map((line) => Number(line.split(",")[2]) * secondsPerTick)
    .sort((a, b) => a - b);
}

export interface MediaProbe {
  /** Null when the container does not declare one (e.g. browser-recorded WebM). */
  durationSeconds: number | null;
  hasVideo: boolean;
  /** Stored frame size of the first video stream, when ffmpeg prints one. */
  width: number | null;
  height: number | null;
  hasAudio: boolean;
  /** The first video stream as ffmpeg names it (null for the parts it does not print). */
  video: {
    codec: string | null;
    /** e.g. "High", "Constrained Baseline". */
    profile: string | null;
    pixelFormat: string | null;
    /** Field order says "top first" or "bottom first". */
    interlaced: boolean;
    fps: number | null;
    /** A display matrix turns the picture (phone video stored on its side). */
    rotated: boolean;
  };
}

/** Splits a stream description at the commas between its fields, not those inside parentheses. */
function streamFields(description: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of description) {
    if (char === "(" || char === "[") depth++;
    if (char === ")" || char === "]") depth--;
    if (char === "," && depth === 0) {
      fields.push(current.trim());
      current = "";
    } else current += char;
  }
  fields.push(current.trim());
  return fields;
}

/** Streams and duration of an input file, from ffmpeg's own header dump (throws if unreadable). */
export async function probeMedia(file: string): Promise<MediaProbe> {
  const { stderr } = await runFfmpeg(["-i", file, "-f", "null", "-t", "0", "-"]);
  return readMediaProbe(stderr);
}

/** Reads streams and duration from what `ffmpeg -i` prints. */
export function readMediaProbe(stderr: string): MediaProbe {
  // Only the input section describes the file; the output section lists ffmpeg's own streams.
  const lines = stderr.split(/^Output #0/m)[0].split("\n");
  const duration = lines.join("\n").match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const isStream = (line: string) => /^\s*Stream #\d+:\d+/.test(line);
  const videoAt = lines.findIndex(
    (line) => isStream(line) && /: Video: /.test(line) && !line.includes("(attached pic)"),
  );
  const videoLine = videoAt === -1 ? undefined : lines[videoAt];
  // Side data (the display matrix) is printed under the stream, before the next one.
  const nextStream = lines.findIndex((line, i) => i > videoAt && isStream(line));
  const videoBlock =
    videoAt === -1 ? [] : lines.slice(videoAt + 1, nextStream === -1 ? undefined : nextStream);
  const size = videoLine?.match(/, (\d{1,5})x(\d{1,5})\b/);
  const fields = videoLine ? streamFields(videoLine.slice(videoLine.indexOf(": Video: ") + 9)) : [];
  const codec = fields[0]?.match(/^(\w+)/)?.[1] ?? null;
  // The first parenthesis after the codec is its profile, unless it is the codec tag ("avc1 / 0x…").
  const profile = fields[0]?.match(/^\w+ \(([^)/]+)\)/)?.[1] ?? null;
  const pixel = fields[1]?.match(/^(\w+)(?:\((.*)\))?/);
  const fps = fields.map((f) => f.match(/^(\d+(?:\.\d+)?) fps$/)).find(Boolean);
  const rotation = videoBlock
    .map((line) => line.match(/displaymatrix: rotation of (-?\d+(?:\.\d+)?) degrees/))
    .find(Boolean);
  return {
    durationSeconds: duration
      ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
      : null,
    hasVideo: videoLine !== undefined,
    width: size ? Number(size[1]) : null,
    height: size ? Number(size[2]) : null,
    hasAudio: lines.some((line) => isStream(line) && /: Audio: /.test(line)),
    video: {
      codec,
      profile,
      pixelFormat: pixel?.[1] ?? null,
      interlaced: pixel?.[2]?.includes("first") ?? false,
      fps: fps ? Number(fps[1]) : null,
      rotated: rotation ? Number(rotation[1]) % 360 !== 0 : false,
    },
  };
}

/** Decodes any media file to mono float32 PCM at the given rate (for analysis only). */
export async function decodeMonoPcm(file: string, sampleRate: number): Promise<Float32Array> {
  const { stdout } = await runFfmpeg([
    "-i",
    file,
    "-vn",
    "-ac",
    "1",
    "-ar",
    String(sampleRate),
    "-f",
    "f32le",
    "pipe:1",
  ]);
  // Copy so the view starts on a 4-byte boundary regardless of Buffer pooling.
  const bytes = stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + stdout.byteLength);
  return new Float32Array(bytes);
}
