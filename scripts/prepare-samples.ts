/**
 * Cuts the shipped sample clips from openly licensed films.
 *
 * In:  runtime/source/<film> (downloaded here when missing) and its English .srt
 * Out: runtime/samples/<id>/clip.mp4           H.264 + AAC, the clip the app analyses
 *      runtime/samples/<id>/dialogue-truth.json subtitle cues shifted to clip time;
 *                                               used only to score gap detection
 */
import { mkdir, writeFile, access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { SAMPLE_CLIPS } from "../src/lib/samples";
import { parseSrt } from "../src/lib/srt";
import { runFfmpeg, probeDurationSeconds } from "../src/lib/media/ffmpeg";

const SOURCE_DIR = "runtime/source";
const SAMPLE_DIR = "runtime/samples";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url: string, target: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download failed ${response.status}: ${url}`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}

async function main(): Promise<void> {
  await mkdir(SOURCE_DIR, { recursive: true });
  for (const clip of SAMPLE_CLIPS) {
    const film = join(SOURCE_DIR, clip.sourceFile);
    const subtitles = `${film}.en.srt`;
    if (!(await exists(film))) await download(clip.sourceUrl, film);
    if (!(await exists(subtitles))) await download(clip.subtitleUrl, subtitles);

    const outDir = join(SAMPLE_DIR, clip.id);
    await mkdir(outDir, { recursive: true });
    const clipFile = join(outDir, "clip.mp4");
    await runFfmpeg([
      "-y",
      "-ss",
      String(clip.startSeconds),
      "-i",
      film,
      "-t",
      String(clip.durationSeconds),
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-ac",
      "2",
      "-ar",
      "48000",
      "-movflags",
      "+faststart",
      clipFile,
    ]);

    const clipEnd = clip.startSeconds + clip.durationSeconds;
    const cues = parseSrt(await readFile(subtitles, "utf8"))
      .filter((c) => c.end > clip.startSeconds && c.start < clipEnd)
      .map((c) => ({
        start: Math.max(0, c.start - clip.startSeconds),
        end: Math.min(clip.durationSeconds, c.end - clip.startSeconds),
        text: c.text,
      }));
    await writeFile(
      join(outDir, "dialogue-truth.json"),
      JSON.stringify({ source: clip.subtitleUrl, clipId: clip.id, cues }, null, 2),
    );
    const duration = await probeDurationSeconds(clipFile);
    console.log(`${clip.id}: ${duration.toFixed(2)} s, ${cues.length} subtitle cues`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
