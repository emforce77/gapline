import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { runFfmpeg } from "./ffmpeg";

/** Change it with the encode settings below, so copies made with the old ones are not reused. */
const WATCHING_COPY_VERSION = "watch-v1";

/**
 * Where the watching copy of a clip is kept: beside it, named after the clip's size and modification
 * time. A sample prepared again rewrites its clip.mp4 in place (ingest.ts), and a copy named only
 * after the version then went on showing writer and reviewer the old picture while hearing and the
 * mix used the new clip (review, 2026-10-03). A stat is enough to tell: hashing the clip would read
 * all of it from Cloud Storage before every run and edit.
 */
export async function watchingCopyFile(clipFile: string): Promise<string> {
  const { size, mtimeMs } = await stat(clipFile);
  return join(dirname(clipFile), `${WATCHING_COPY_VERSION}-${size}-${Math.trunc(mtimeMs)}.mp4`);
}

/**
 * The watching copy of a project's clip: read from beside the clip, or encoded once and kept there.
 * Re-encoding it took 5–22 s before every run and edit on Cloud Run (QA, 2026-10-03). The encode is
 * deterministic, so two first runs that both write it write the same bytes; each writes a file of
 * its own and renames it into place, so no reader sees half of one. Copies of an earlier clip, or
 * from earlier encode settings, are removed once the new one is in place.
 */
export async function watchingVideoFor(clipFile: string): Promise<Buffer> {
  const file = await watchingCopyFile(clipFile);
  try {
    return await readFile(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const video = await encodeWatchingVideo(clipFile);
  const partial = `${file}.${randomBytes(4).toString("hex")}.part`;
  await writeFile(partial, video);
  await rename(partial, file);
  const dir = dirname(file);
  for (const name of await readdir(dir))
    if (name.startsWith("watch-") && name.endsWith(".mp4") && name !== basename(file))
      await rm(join(dir, name), { force: true });
  return video;
}

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
