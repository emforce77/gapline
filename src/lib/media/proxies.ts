import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpeg } from "./ffmpeg";

/**
 * Small H.264 copy for watching. Gemini samples about one frame per second at reduced
 * resolution, so a 360-line proxy keeps the request small without changing what it sees.
 * Written to a real file (not a pipe): a piped, fragmented MP4 has no duration in its header,
 * and on the sample clip Gemini then stretched a 65 s timeline to 105 s. "ultrafast": on Cloud Run's 2 vCPU
 * the "veryfast" preset took 13 s for 65 s of video, all before the first stage could start.
 */
export async function encodeWatchingVideo(file: string): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "scene-watch-"));
  const out = join(dir, "watch.mp4");
  try {
    await runFfmpeg([
      "-y",
      "-i",
      file,
      "-vf",
      "scale=-2:360",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "30",
      "-c:a",
      "aac",
      "-b:a",
      "48k",
      "-ac",
      "1",
      "-movflags",
      "+faststart",
      out,
    ]);
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
