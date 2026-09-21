import { spawn } from "node:child_process";

/** Resolved once: a static build locally (FFMPEG_PATH), the apt package in the container. */
export function ffmpegPath(): string {
  return process.env.FFMPEG_PATH || "ffmpeg";
}

export interface FfmpegResult {
  stderr: string;
  stdout: Buffer;
}

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
      reject(new Error(`ffmpeg exited ${code}: ${stderr.split("\n").slice(-8).join("\n")}`));
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
