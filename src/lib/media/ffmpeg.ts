import { spawn } from "node:child_process";

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

/** Container duration in seconds, read from ffmpeg's own header dump (there is no ffprobe). */
export async function probeDurationSeconds(file: string): Promise<number> {
  const { stderr } = await runFfmpeg(["-i", file, "-f", "null", "-t", "0", "-"]);
  const match = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) throw new Error(`No duration in ffmpeg header for ${file}`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export interface MediaProbe {
  /** Null when the container does not declare one (e.g. browser-recorded WebM). */
  durationSeconds: number | null;
  hasVideo: boolean;
  /** Stored frame size of the first video stream, when ffmpeg prints one. */
  width: number | null;
  height: number | null;
  hasAudio: boolean;
}

/** Streams and duration of an input file, from ffmpeg's own header dump (throws if unreadable). */
export async function probeMedia(file: string): Promise<MediaProbe> {
  const { stderr } = await runFfmpeg(["-i", file, "-f", "null", "-t", "0", "-"]);
  // Only the input section describes the file; the output section lists ffmpeg's own streams.
  const input = stderr.split(/^Output #0/m)[0];
  const duration = input.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const streams = input.split("\n").filter((line) => /^\s*Stream #\d+:\d+/.test(line));
  const videoLine = streams.find(
    (line) => /: Video: /.test(line) && !line.includes("(attached pic)"),
  );
  const size = videoLine?.match(/, (\d{1,5})x(\d{1,5})\b/);
  return {
    durationSeconds: duration
      ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
      : null,
    hasVideo: videoLine !== undefined,
    width: size ? Number(size[1]) : null,
    height: size ? Number(size[2]) : null,
    hasAudio: streams.some((line) => /: Audio: /.test(line)),
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
