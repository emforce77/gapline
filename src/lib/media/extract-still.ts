import { FfmpegError, runFfmpeg } from "./ffmpeg";

/** One JPEG from the original video stream, at a time measured from the clip start. */
export async function extractStill(clipFile: string, at: number): Promise<Buffer> {
  if (!Number.isFinite(at) || at < 0) throw new FfmpegError("Invalid source frame time");
  const { stdout } = await runFfmpeg([
    "-ss",
    String(at),
    "-i",
    clipFile,
    "-map",
    "0:v:0",
    "-frames:v",
    "1",
    "-threads",
    "1",
    "-c:v",
    "mjpeg",
    "-q:v",
    "3",
    "-f",
    "image2pipe",
    "pipe:1",
  ], 60_000).catch((error: unknown) => {
    if (error instanceof FfmpegError) throw error;
    throw new FfmpegError("Could not start ffmpeg to extract a source frame", { cause: error });
  });
  if (
    stdout.length < 4 ||
    stdout.readUInt16BE(0) !== 0xffd8 ||
    stdout.readUInt16BE(stdout.length - 2) !== 0xffd9
  )
    throw new FfmpegError(`No complete JPEG at ${at} s`);
  return stdout;
}
