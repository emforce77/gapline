import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runFfmpeg, probeDurationSeconds } from "../media/ffmpeg";
import { projectDir, writeProject, type Project } from "./projects";

/** The timeline strip shows at most this many thumbnails, whatever the clip length. */
const MAX_THUMBNAILS = 60;
const THUMB_HEIGHT = 72;
/** Uploads are analysed as a short clip; longer films belong to the batch path, not the live demo. */
export const MAX_UPLOAD_SECONDS = 90;

/** One row of thumbnails, evenly spaced; the timeline scales it to its own width. */
async function writeStrip(clipFile: string, outFile: string, clipSeconds: number): Promise<number> {
  const step = Math.max(1, Math.ceil(clipSeconds / MAX_THUMBNAILS));
  const count = Math.ceil(clipSeconds / step);
  await runFfmpeg([
    "-y",
    "-i",
    clipFile,
    "-vf",
    `fps=1/${step},scale=-2:${THUMB_HEIGHT},tile=${count}x1`,
    "-frames:v",
    "1",
    "-q:v",
    "4",
    outFile,
  ]);
  return step;
}

/** Normalises any input video into the project's clip.mp4 (≤720p H.264, 48 kHz stereo AAC). */
export async function transcodeToClip(input: string, output: string): Promise<void> {
  await runFfmpeg([
    "-y",
    "-i",
    input,
    "-vf",
    "scale='min(1280,iw)':-2",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
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
    output,
  ]);
}

export async function createProject(input: {
  id: string;
  title: string;
  kind: Project["kind"];
  sourceFile: string;
  alreadyNormalised: boolean;
  filmLanguageCode: string;
  attribution: string;
  license: string;
}): Promise<Project> {
  const dir = projectDir(input.id);
  await mkdir(dir, { recursive: true });
  const clipFile = join(dir, "clip.mp4");
  if (input.alreadyNormalised) await copyFile(input.sourceFile, clipFile);
  else await transcodeToClip(input.sourceFile, clipFile);
  const clipSeconds = await probeDurationSeconds(clipFile);
  if (input.kind === "upload" && clipSeconds > MAX_UPLOAD_SECONDS + 0.5) {
    throw new Error(`Clip is ${clipSeconds.toFixed(0)} s; the limit is ${MAX_UPLOAD_SECONDS} s`);
  }
  const stripStepSeconds = await writeStrip(clipFile, join(dir, "strip.jpg"), clipSeconds);
  const project: Project = {
    id: input.id,
    title: input.title,
    kind: input.kind,
    clipSeconds,
    filmLanguageCode: input.filmLanguageCode,
    attribution: input.attribution,
    license: input.license,
    createdAt: new Date().toISOString(),
    stripStepSeconds,
  };
  await writeProject(project);
  return project;
}
