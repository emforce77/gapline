import { access, copyFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { MAX_UPLOAD_SECONDS, MIN_UPLOAD_SECONDS } from "../api-contract";
import { UploadError } from "../errors";
import {
  copyFileByStream,
  FfmpegError,
  keyframeTimes,
  probeDurationSeconds,
  probeMedia,
  runFfmpeg,
  withScratchDir,
  type MediaProbe,
} from "../media/ffmpeg";
import { projectDir, writeProject, type Project } from "./projects";

/** The timeline strip shows at most this many thumbnails, whatever the clip length. */
const MAX_THUMBNAILS = 60;
const THUMB_HEIGHT = 72;
/** Poster frame position as a share of the clip; past the opening titles in most films. */
const POSTER_AT = 0.45;
/** Container durations are rounded; a clip this far over the limit still counts as within it. */
const DURATION_SLACK_SECONDS = 0.5;
/** Longest side of a re-encoded clip: 1280 px keeps landscape at 720p and portrait at 720×1280. */
const MAX_CLIP_SIDE = 1280;
/**
 * Longest side of a picture copied as it is. Copying 1080p instead of re-encoding it to 720p took
 * a 90 s upload from 27.1 to 5.4 s on 2 pinned cores with the deployed ffmpeg 5.1, and its first
 * run's watching copy from 9.5 to 17.8 s; the clip and the described film are about 4× larger,
 * within the 30 MB upload limit (review, 2026-10-03). The writer and reviewer watch a 360-line copy
 * either way (proxies.ts).
 */
const MAX_COPIED_SIDE = 1920;
/** Frame rate cap of the analysed clip: 60 fps phone video doubles the encode and adds nothing. */
const MAX_CLIP_FPS = 30;
/** ffmpeg prints rates rounded (29.97, 30.01); this much over the cap still counts as within it. */
const FPS_SLACK = 0.5;
/** H.264 profiles every browser plays. */
const BROWSER_H264_PROFILES = ["Constrained Baseline", "Baseline", "Main", "High"];
/**
 * At most 30 fps, both sides capped keeping the aspect ratio, even dimensions (libx264 with yuv420p
 * rejects odd ones, e.g. 853×480 or 1179×2556). Bilinear: on 1080p sources it scales at about twice
 * the speed of the default bicubic, and the clip is only watched at 1280 px or less.
 */
const SCALE_FILTER =
  `fps=fps='min(${MAX_CLIP_FPS},source_fps)',` +
  `scale=w='min(${MAX_CLIP_SIDE},iw)':h='min(${MAX_CLIP_SIDE},ih)'` +
  ":force_original_aspect_ratio=decrease:force_divisible_by=2:flags=bilinear";
/**
 * The film's first 20 ms fade in. A clip that starts loud otherwise opens with an AAC overshoot
 * of up to +2 dBFS in the first frame after the encoder's priming (QA, 2026-10-03).
 */
const AUDIO_FADE_IN = "afade=t=in:d=0.02";

/** Whether every thumbnail's span holds a keyframe, so a strip of keyframes alone shows each span. */
export function keyframeInEverySpan(keyframes: number[], step: number, count: number): boolean {
  for (let i = 0; i < count; i++)
    if (!keyframes.some((t) => t >= i * step && t < (i + 1) * step)) return false;
  return true;
}

/**
 * One row of ceil(clip / step) thumbnails at the clip's own shape; the timeline's picture lane
 * places tile i at i × step. The last frame is repeated past the end of the video, so a clip that
 * ends a fraction of a step after its last tile (or whose sound outlasts its picture) still fills
 * every tile instead of ending in a black one; ffmpeg stops as soon as the row is full.
 *
 * Thumbnails 72 px high need neither every frame nor the deblocking filter. When every tile's span
 * holds a keyframe (phone and stream clips, keyframes every 1–2 s), only keyframes are decoded, and
 * each tile is the last keyframe of its span (round=down; rounding to the nearest frame put 10 of
 * 45 tiles up to 1 s before their span). A 90 s 1080p phone-style upload took 1.2 s (0.13 s to list
 * its keyframes, 1.1 s to decode them) instead of 4.2 s, on 2 cores with the deployed ffmpeg 5.1
 * (2026-10-04). Otherwise (x264's default of a keyframe every 250
 * frames, for one) frames nothing refers to are skipped: about 3× faster than decoding every frame
 * (city-45s: 4.3 → 1.3 s on 2 vCPU), within a frame or two of the same moments.
 */
async function writeStrip(clipFile: string, outFile: string, clipSeconds: number): Promise<number> {
  const step = Math.max(1, Math.ceil(clipSeconds / MAX_THUMBNAILS));
  const count = Math.ceil(clipSeconds / step);
  const keyframesOnly = keyframeInEverySpan(await keyframeTimes(clipFile), step, count);
  await runFfmpeg([
    "-y",
    "-skip_frame",
    keyframesOnly ? "nokey" : "noref",
    "-skip_loop_filter",
    "all",
    "-i",
    clipFile,
    "-vf",
    `tpad=stop_mode=clone:stop_duration=${clipSeconds.toFixed(2)},` +
      `fps=1/${step}${keyframesOnly ? ":round=down" : ""},` +
      `scale=-2:${THUMB_HEIGHT},tile=${count}x1`,
    "-frames:v",
    "1",
    "-q:v",
    "4",
    outFile,
  ]);
  return step;
}

/**
 * True when the source's picture can go into clip.mp4 as it is: H.264 that browsers play, at most
 * 1080p and 30 fps, progressive and upright. Copying it skips a full decode and re-encode
 * (city-45s: 12.9 → 3.9 s on 2 vCPU, QA 2026-10-03); the described film copies it again.
 */
export function playsAsIs(media: MediaProbe): boolean {
  const { video, width, height } = media;
  return (
    video.codec === "h264" &&
    BROWSER_H264_PROFILES.includes(video.profile ?? "") &&
    video.pixelFormat === "yuv420p" &&
    !video.interlaced &&
    !video.rotated &&
    video.fps !== null &&
    video.fps <= MAX_CLIP_FPS + FPS_SLACK &&
    width !== null &&
    height !== null &&
    Math.max(width, height) <= MAX_COPIED_SIDE
  );
}

/**
 * Normalises any input video into the project's clip.mp4 (H.264 at ≤30 fps, 48 kHz stereo AAC).
 * A picture that browsers play at up to 1080p is copied; any other is re-encoded to ≤1280 px on
 * the long side, with even dimensions. A clip without sound gets a silent track, so hearing, mixing
 * and playback always have one. maxSeconds bounds the work when a header understates the length.
 */
export async function transcodeToClip(
  input: string,
  output: string,
  options: { addSilentAudio: boolean; copyVideo: boolean; maxSeconds?: number },
): Promise<void> {
  const inputs = options.addSilentAudio
    ? ["-i", input, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"]
    : ["-i", input];
  // 0:V skips cover art; with an added silent track, the output ends with the picture.
  const maps = options.addSilentAudio
    ? ["-map", "0:V:0", "-map", "1:a:0", "-shortest"]
    : ["-map", "0:V:0", "-map", "0:a:0"];
  const limit = options.maxSeconds === undefined ? [] : ["-t", String(options.maxSeconds)];
  const video = options.copyVideo
    ? ["-c:v", "copy"]
    : [
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
      ];
  await runFfmpeg([
    "-y",
    ...inputs,
    ...maps,
    ...limit,
    ...video,
    "-af",
    AUDIO_FADE_IN,
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
async function inspectUpload(sourceFile: string): Promise<MediaProbe> {
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
  return media;
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
  const media = upload ? await inspectUpload(input.sourceFile) : await probeMedia(input.sourceFile);
  const copyVideo = playsAsIs(media);
  console.info(`ingest ${input.id}: ${copyVideo ? "copying" : "re-encoding"} the picture`, {
    ...media.video,
    width: media.width,
    height: media.height,
  });
  try {
    await transcodeToClip(input.sourceFile, clipFile, {
      addSilentAudio: !media.hasAudio,
      copyVideo,
      // One second over the limit is enough to tell "too long" apart after the transcode.
      ...(upload ? { maxSeconds: MAX_UPLOAD_SECONDS + 1 } : {}),
    });
  } catch (error) {
    if (upload && error instanceof FfmpegError) throw new UploadError("unreadable", error.message);
    throw error;
  }
}

/** The clip, its strip and its poster, made in a local folder; returns the measured length. */
async function writeClipFiles(
  input: Parameters<typeof createProject>[0],
  local: string,
): Promise<{ clipSeconds: number; stripStepSeconds: number }> {
  const clipFile = join(local, "clip.mp4");
  await writeClip(input, clipFile);
  const clipSeconds = await probeDurationSeconds(clipFile);
  if (input.kind === "upload" && clipSeconds > MAX_UPLOAD_SECONDS + DURATION_SLACK_SECONDS) {
    throw new UploadError(
      "too_long",
      `Clip is ${clipSeconds.toFixed(1)} s; the limit is ${MAX_UPLOAD_SECONDS} s`,
    );
  }
  // Measured on the converted clip: a still picture and some WebM files declare no length.
  if (input.kind === "upload" && clipSeconds < MIN_UPLOAD_SECONDS) {
    throw new UploadError(
      "too_short",
      `Clip is ${clipSeconds.toFixed(2)} s; the minimum is ${MIN_UPLOAD_SECONDS} s`,
    );
  }
  const stripStepSeconds = await writeStrip(clipFile, join(local, "strip.jpg"), clipSeconds);
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
    join(local, "poster.jpg"),
  ]);
  return { clipSeconds, stripStepSeconds };
}

async function buildProject(input: Parameters<typeof createProject>[0], dir: string) {
  await mkdir(dir, { recursive: true });
  const { clipSeconds, stripStepSeconds } = await withScratchDir(async (local) => {
    const made = await writeClipFiles(input, local);
    for (const name of ["clip.mp4", "strip.jpg", "poster.jpg"])
      await copyFileByStream(join(local, name), join(dir, name));
    return made;
  });
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

/** Upload titles stop at this many characters; the page wraps them and clamps past two lines. */
const MAX_TITLE_CHARACTERS = 80;
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const WORDS = new Intl.Segmenter(undefined, { granularity: "word" });

/**
 * A cut after a whole word must keep at least this share of the room; a name of few or no spaces
 * ("Trailer 4K_The_Lord_of_the_Rings_….mp4", underscores join words) would otherwise shrink to
 * its first word (review, 2026-10-03).
 */
const MIN_WORD_CUT_SHARE = 0.6;

/**
 * Direction overrides, embeddings, isolates and marks: a file name must not reverse or hide how its
 * title reads ("\u202Egnp.exe\u202C clip" showed as "exe.png clip"; QA 2026-10-03).
 */
const BIDI_CONTROLS = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/gu;
/**
 * A name of only controls, format characters (zero-width space, word joiner, soft hyphen),
 * separators, default-ignorable marks (variation selectors, the combining grapheme joiner, Hangul
 * fillers, Khmer and Mongolian invisible signs) or the blank Braille pattern shows nothing, so the
 * clip gets the fallback title ("\uFE0F\uFE0F.mp4" was stored as an invisible title; review,
 * 2026-10-04). They are not removed from a visible name: a zero-width joiner or a variation selector
 * holds an emoji sequence together.
 */
const NOTHING_VISIBLE = /^[\p{Cc}\p{Cf}\p{Z}\p{Default_Ignorable_Code_Point}\u2800]*$/u;

/**
 * The clip's title: its file name without the extension. A longer name is cut after the last
 * whole word that fits and ends in "…", or inside a word when that keeps too little of it.
 * Characters are counted as the reader sees them, so an emoji or an accented letter is never split.
 */
export function uploadTitle(fileName: string): string {
  const name = fileName
    .replace(/\.[^.]+$/, "")
    .replace(BIDI_CONTROLS, "")
    .trim();
  if (NOTHING_VISIBLE.test(name)) return "Untitled clip";
  const characters = (text: string) => [...GRAPHEMES.segment(text)].length;
  if (characters(name) <= MAX_TITLE_CHARACTERS) return name;
  const room = MAX_TITLE_CHARACTERS - 1;
  let kept = "";
  for (const { segment } of WORDS.segment(name)) {
    if (characters(kept + segment) > room) break;
    kept += segment;
  }
  // Ends on a word, not on the space or punctuation after it.
  const words = [...WORDS.segment(kept)];
  while (words.length > 0 && !words.at(-1)!.isWordLike) words.pop();
  const cut = words.map((w) => w.segment).join("");
  const title =
    characters(cut) >= room * MIN_WORD_CUT_SHARE
      ? cut
      : [...GRAPHEMES.segment(name)]
          .slice(0, room)
          .map((g) => g.segment)
          .join("")
          .trimEnd();
  return `${title}…`;
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
