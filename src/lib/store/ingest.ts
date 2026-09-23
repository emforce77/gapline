import { access, copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { MAX_UPLOAD_SECONDS } from "../api-contract";
import { UploadError } from "../errors";
import { FfmpegError, probeMedia, runFfmpeg, probeDurationSeconds } from "../media/ffmpeg";
import { projectDir, writeProject, type Project } from "./projects";

/** The timeline strip shows at most this many thumbnails, whatever the clip length. */
const MAX_THUMBNAILS = 60;
const THUMB_HEIGHT = 72;
/** Poster frame position as a share of the clip; past the opening titles in most films. */
const POSTER_AT = 0.45;
/** Container durations are rounded; a clip this far over the limit still counts as within it. */
const DURATION_SLACK_SECONDS = 0.5;
/** Longest side of the analysed clip: 1280 px keeps landscape at 720p and portrait at 720×1280. */
const MAX_CLIP_SIDE = 1280;
/**
 * Even output dimensions (libx264 with yuv420p rejects odd ones, e.g. 853×480 or 1179×2556) and
 * both sides capped, keeping the aspect ratio.
 */
const SCALE_FILTER =
  `scale=w='min(${MAX_CLIP_SIDE},iw)':h='min(${MAX_CLIP_SIDE},ih)'` +
  ":force_original_aspect_ratio=decrease:force_divisible_by=2";

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

/**
 * Normalises any input video into the project's clip.mp4 (≤1280 px on the long side, even
 * dimensions, H.264, 48 kHz stereo AAC). A clip without sound gets a silent track, so hearing,
 * mixing and playback always have one. maxSeconds bounds the work when a header understates the length.
 */
export async function transcodeToClip(
  input: string,
  output: string,
  options: { addSilentAudio: boolean; maxSeconds?: number },
): Promise<void> {
  const inputs = options.addSilentAudio
    ? ["-i", input, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    : ["-i", input];
  const maps = options.addSilentAudio ? ["-map", "0:v:0", "-map", "1:a:0", "-shortest"] : [];
  const limit = options.maxSeconds === undefined ? [] : ["-t", String(options.maxSeconds)];
  await runFfmpeg([
    "-y",
    ...inputs,
    ...maps,
    ...limit,
    "-vf",
    SCALE_FILTER,
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

/** Checks an upload before the expensive transcode: readable, has a picture, not too long. */
async function inspectUpload(sourceFile: string): Promise<{ hasAudio: boolean }> {
  let media;
  try {
    media = await probeMedia(sourceFile);
  } catch (error) {
    if (error instanceof FfmpegError) throw new UploadError("unreadable", error.message);
    throw error;
  }
  if (!media.hasVideo) throw new UploadError("no_video_stream", "The file has no video stream");
  if (
    media.durationSeconds !== null &&
    media.durationSeconds > MAX_UPLOAD_SECONDS + DURATION_SLACK_SECONDS
  )
    throw new UploadError(
      "too_long",
      `Clip is ${media.durationSeconds.toFixed(1)} s; the limit is ${MAX_UPLOAD_SECONDS} s`,
      media.durationSeconds,
    );
  return { hasAudio: media.hasAudio };
}

async function writeClip(
  input: Parameters<typeof createProject>[0],
  clipFile: string,
): Promise<void> {
  if (input.alreadyNormalised) {
    await copyFile(input.sourceFile, clipFile);
    return;
  }
  const upload = input.kind === "upload";
  const { hasAudio } = upload
    ? await inspectUpload(input.sourceFile)
    : { hasAudio: (await probeMedia(input.sourceFile)).hasAudio };
  try {
    await transcodeToClip(input.sourceFile, clipFile, {
      addSilentAudio: !hasAudio,
      // One second over the limit is enough to tell "too long" apart after the transcode.
      ...(upload ? { maxSeconds: MAX_UPLOAD_SECONDS + 1 } : {}),
    });
  } catch (error) {
    if (upload && error instanceof FfmpegError) throw new UploadError("unreadable", error.message);
    throw error;
  }
}

async function buildProject(input: Parameters<typeof createProject>[0], dir: string) {
  await mkdir(dir, { recursive: true });
  const clipFile = join(dir, "clip.mp4");
  await writeClip(input, clipFile);
  const clipSeconds = await probeDurationSeconds(clipFile);
  if (input.kind === "upload" && clipSeconds > MAX_UPLOAD_SECONDS + DURATION_SLACK_SECONDS) {
    throw new UploadError(
      "too_long",
      `Clip is ${clipSeconds.toFixed(1)} s; the limit is ${MAX_UPLOAD_SECONDS} s`,
    );
  }
  const stripStepSeconds = await writeStrip(clipFile, join(dir, "strip.jpg"), clipSeconds);
  await runFfmpeg([
    "-y",
    "-ss",
    (clipSeconds * POSTER_AT).toFixed(2),
    "-i",
    clipFile,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    join(dir, "poster.jpg"),
  ]);
  const project: Project = {
    id: input.id,
    title: input.title,
    kind: input.kind,
    clipSeconds,
    filmLanguageCode: input.filmLanguageCode,
    attribution: input.attribution,
    license: input.license,
    createdAt: new Date().toISOString(),
    ...(input.ownerHash ? { ownerHash: input.ownerHash } : {}),
    stripStepSeconds,
  };
  await writeProject(project);
  return project;
}

/**
 * Creates a project from a source video. When the project folder is new and anything fails, the
 * folder is removed again, so a rejected upload leaves nothing behind.
 */
export async function createProject(input: {
  id: string;
  title: string;
  kind: Project["kind"];
  sourceFile: string;
  alreadyNormalised: boolean;
  filmLanguageCode: string;
  attribution: string;
  license: string;
  ownerHash?: string;
}): Promise<Project> {
  const dir = projectDir(input.id);
  const existed = await access(dir).then(
    () => true,
    () => false,
  );
  try {
    return await buildProject(input, dir);
  } catch (error) {
    if (!existed) await rm(dir, { recursive: true, force: true });
    throw error;
  }
}
