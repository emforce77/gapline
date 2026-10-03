import assert from "node:assert/strict";
import { it } from "node:test";
import { access, copyFile, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UploadError } from "../src/lib/errors";
import { probeMedia, runFfmpeg } from "../src/lib/media/ffmpeg";
import { filmLoudness, mixDescribedFilm, momentaryLoudness } from "../src/lib/media/mix";
import { createProject } from "../src/lib/store/ingest";
import { projectDir } from "../src/lib/store/projects";

/** True peak (dBTP) of a file's sound, from ebur128's oversampled peak meter. */
async function truePeak(file: string): Promise<number> {
  const { stderr } = await runFfmpeg([
    "-nostats",
    "-i",
    file,
    "-vn",
    "-af",
    "ebur128=peak=true",
    "-f",
    "null",
    "-",
  ]);
  const summary = stderr.slice(stderr.lastIndexOf("Summary:"));
  return Number(summary.match(/True peak:\s+Peak:\s+(-?\d+(?:\.\d+)?)/)![1]);
}

/** The stream lines ffmpeg prints for a file. */
async function streamLines(file: string): Promise<string[]> {
  const { stderr } = await runFfmpeg(["-i", file, "-f", "null", "-t", "0", "-"]);
  return stderr
    .split(/^Output #0/m)[0]
    .split("\n")
    .filter((line) => /^\s*Stream #/.test(line));
}

async function sources() {
  const src = await mkdtemp(join(tmpdir(), "scene-media-src-"));
  return {
    src,
    make: async (name: string, args: string[]) => {
      await runFfmpeg(["-y", ...args, join(src, name)]);
      return join(src, name);
    },
  };
}

const LINES = [
  { start: 2, end: 4, text: "A man waves." },
  { start: 7, end: 9, text: "R&D <Lab>\n\nentrance." },
];

it("mixes a hot film under −1 dBTP, tagged as English audio description", async () => {
  const { src, make } = await sources();
  // Pink noise pushed into the ceiling, like a trailer's opening (Sintel's source is +0.9 dBTP).
  const film = await make("film.mp4", [
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=160x90:r=10:d=12",
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=color=pink:amplitude=1:r=48000:d=12,volume=6dB",
    "-ac",
    "2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
  ]);
  assert.ok((await truePeak(film)) > -1);
  const raw = await make("narration.raw.wav", [
    "-f",
    "lavfi",
    "-i",
    "sine=f=220:r=24000:d=12",
    "-af",
    "volume='if(between(t,2,4)+between(t,7,9),0.5,0)':eval=frame",
    "-c:a",
    "pcm_s16le",
  ]);
  const out = await mkdtemp(join(tmpdir(), "scene-media-run-"));
  const mixed = await mixDescribedFilm({
    clipFile: film,
    rawNarrationWav: raw,
    spans: LINES,
    language: "en",
    describedMp4: join(out, "described.mp4"),
    narrationWav: join(out, "narration.wav"),
  });

  assert.ok((await truePeak(mixed.narrationWav)) <= -1);
  assert.ok((await truePeak(mixed.describedMp4)) <= -1);
  // Over a loud film each line sits at the ceiling, and the film goes down under it.
  for (const line of mixed.lines) {
    assert.equal(line.narrationLufs, -16);
    assert.ok(Math.abs(line.voiceLufs + 16) < 1.5, `voice ${line.voiceLufs}`);
    assert.ok(line.maxDuckDb >= 3 && line.maxDuckDb <= 20, `dip ${line.maxDuckDb}`);
  }
  const streams = await streamLines(mixed.describedMp4);
  const audio = streams.find((s) => s.includes("Audio:"))!;
  assert.match(audio, /\(eng\)/);
  assert.match(audio, /\(visual impaired\)/);
  // No text track: the MP4 muxer would enable it, and the text is in descriptions.vtt.
  assert.equal(streams.filter((s) => s.includes("Subtitle:")).length, 0);
  // Only the two deliverables land in the run folder; ffmpeg's scratch files stay local.
  assert.deepEqual((await readdir(out)).sort(), ["described.mp4", "narration.wav"]);
  // The film's loudness is kept beside the clip, as measured, for the next run or edit.
  const kept = (await readdir(src)).filter((name) => name.startsWith("loudness-"));
  assert.equal(kept.length, 1);
  assert.deepEqual(await filmLoudness(film), await momentaryLoudness(film));
});

it("mixes a run without lines: the film alone, no text track", async () => {
  const { make } = await sources();
  const film = await make("film.mp4", [
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=160x90:r=10:d=5",
    "-f",
    "lavfi",
    "-i",
    "sine=f=440:r=48000:d=5",
    "-ac",
    "2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
  ]);
  const raw = await make("narration.raw.wav", [
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=24000:cl=mono",
    "-t",
    "5",
    "-c:a",
    "pcm_s16le",
  ]);
  const out = await mkdtemp(join(tmpdir(), "scene-media-run-"));
  const mixed = await mixDescribedFilm({
    clipFile: film,
    rawNarrationWav: raw,
    spans: [],
    language: "ko",
    describedMp4: join(out, "described.mp4"),
    narrationWav: join(out, "narration.wav"),
  });
  assert.deepEqual(mixed.lines, []);
  const streams = await streamLines(mixed.describedMp4);
  assert.equal(streams.filter((s) => s.includes("Subtitle:")).length, 0);
  assert.match(
    streams.find((s) => s.includes("Audio:"))!,
    /\(kor\)/,
  );
});

it("copies web-ready H.264 up to 1080p, converts 1080p60, fills the strip to its last tile, and refuses stills", async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-media-data-"));
  const { src, make } = await sources();
  const upload = (id: string, sourceFile: string) =>
    createProject({
      id,
      title: id,
      kind: "upload",
      sourceFile,
      alreadyNormalised: false,
      filmLanguageCode: "auto",
      attribution: "",
      license: "",
    });
  const pictureMd5 = async (file: string) =>
    (
      await runFfmpeg(["-i", file, "-map", "0:v", "-c", "copy", "-f", "md5", "-"])
    ).stdout.toString();

  const web = await make("web.mp4", [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=640x360:r=24:d=6",
    "-f",
    "lavfi",
    "-i",
    "sine=f=440:r=44100:d=6",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
  ]);
  await upload("u-web", web);
  const webClip = join(projectDir("u-web"), "clip.mp4");
  assert.equal(await pictureMd5(webClip), await pictureMd5(web));
  assert.match(
    (await streamLines(webClip)).find((s) => s.includes("Audio:"))!,
    /48000 Hz, stereo/,
  );

  const full = await make("full.mp4", [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=1920x1080:r=30:d=3",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
  ]);
  await upload("u-full", full);
  assert.equal(await pictureMd5(join(projectDir("u-full"), "clip.mp4")), await pictureMd5(full));

  const fast = await make("fast.mp4", [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=1920x1080:r=60:d=3",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
  ]);
  await upload("u-fast", fast);
  const fastClip = await probeMedia(join(projectDir("u-fast"), "clip.mp4"));
  assert.deepEqual([fastClip.width, fastClip.height, fastClip.video.fps], [1280, 720, 30]);

  // The sound outlasts the picture by 1.7 s: the last tiles repeat its last frame, not black.
  const tail = await make("tail.mp4", [
    "-f",
    "lavfi",
    "-i",
    "color=c=white:s=320x180:r=10:d=5.3",
    "-f",
    "lavfi",
    "-i",
    "sine=f=440:r=48000:d=7",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
  ]);
  const project = await upload("u-tail", tail);
  const strip = join(projectDir("u-tail"), "strip.jpg");
  const tiles = Math.ceil(project.clipSeconds / project.stripStepSeconds!);
  const { width, height } = await probeMedia(strip);
  assert.deepEqual([width, height], [tiles * 128, 72]);
  const last = await runFfmpeg([
    "-i",
    strip,
    "-vf",
    `crop=128:72:${width! - 128}:0,format=gray`,
    "-f",
    "rawvideo",
    "-",
  ]);
  const mean = last.stdout.reduce((sum, v) => sum + v, 0) / last.stdout.length;
  assert.ok(mean > 200, `last tile mean ${mean}`);

  const portrait = await make("portrait.mp4", [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=360x640:r=10:d=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
  ]);
  const upright = await upload("u-portrait", portrait);
  // 9:16 tiles, 72 px high: 40 px wide (40.5 rounded down to even).
  const portraitStrip = await probeMedia(join(projectDir("u-portrait"), "strip.jpg"));
  assert.deepEqual(
    [portraitStrip.width, portraitStrip.height],
    [Math.ceil(upright.clipSeconds / upright.stripStepSeconds!) * 40, 72],
  );

  const png = await make("still.png", [
    "-f",
    "lavfi",
    "-i",
    "color=c=red:s=320x240",
    "-frames:v",
    "1",
  ]);
  const still = join(src, "still.mp4");
  await copyFile(png, still);
  const short = await make("short.mp4", [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=320x180:r=24:d=2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
  ]);
  for (const [id, file] of [
    ["u-still", still],
    ["u-short", short],
  ]) {
    await assert.rejects(upload(id, file), (error: unknown) => {
      assert.ok(error instanceof UploadError);
      assert.equal(error.code, "too_short");
      return true;
    });
    await assert.rejects(access(projectDir(id)));
  }
});
