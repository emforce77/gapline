import assert from "node:assert/strict";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { readMediaProbe } from "../src/lib/media/ffmpeg";
import {
  describedVtt,
  duckEnvelope,
  filmLoudness,
  planNarration,
  usualLoudness,
  type LoudnessReading,
} from "../src/lib/media/mix";
import { vttCueText, webVtt } from "../src/lib/srt";
import { playsAsIs, uploadTitle } from "../src/lib/store/ingest";

/** A reading every 100 ms up to `seconds`, at the level the function gives for that moment. */
function readings(seconds: number, level: (t: number) => number): LoudnessReading[] {
  return Array.from({ length: Math.round(seconds * 10) }, (_, i) => {
    const t = Number(((i + 1) / 10).toFixed(1));
    return { t, lufs: level(t) };
  });
}
const SILENT = -120.7;
/** Narration that speaks (at −22 LUFS) only inside its line. */
const voiceOn = (start: number, end: number) =>
  readings(30, (t) => (t > start && t <= end ? -22 : SILENT));
const line = (start: number, end: number) => ({ start, end, text: "A line." });

describe("narration level", () => {
  const level = (film: number) =>
    planNarration({
      film: readings(30, () => film),
      narration: voiceOn(5, 8),
      lines: [line(5, 8)],
    })[0];

  it("sits 4 LU over the film around it, and takes the voice there", () => {
    const planned = level(-25);
    assert.equal(planned.filmAroundLufs, -25);
    assert.equal(planned.narrationLufs, -21);
    assert.equal(planned.gainDb, 1);
  });

  it("stays between −26 LUFS over quiet films and −16 over loud ones", () => {
    assert.equal(level(-35).narrationLufs, -26);
    assert.equal(level(-10).narrationLufs, -16);
  });

  it("speaks at dialogue level over a film with no sound", () => {
    assert.equal(level(SILENT).narrationLufs, -16);
  });

  it("follows the whole film's usual level over a silent stretch, not the floor", () => {
    // Silent until 5 s, then −22 throughout (Sintel opens on silence; Tears of Steel ends on 61 s).
    const film = readings(30, (t) => (t <= 5 ? SILENT : -22));
    const [early, later] = planNarration({
      film,
      narration: readings(30, (t) => ((t > 1 && t <= 2) || (t > 20 && t <= 22) ? -22 : SILENT)),
      lines: [line(1, 2), line(20, 22)],
    });
    assert.equal(early.filmAroundLufs, -Infinity);
    assert.equal(early.narrationLufs, -18);
    assert.equal(later.narrationLufs, -18);
  });

  it("refuses a line whose narration is silent", () => {
    assert.throws(
      () =>
        planNarration({
          film: readings(30, () => -20),
          narration: voiceOn(5, 8),
          lines: [line(12, 14)],
        }),
      /Narration is silent at 12.00 s/,
    );
  });

  it("reads the film's usual level past the silence before it and through a swell", () => {
    // Near-silence (−60) until 4.5 s, then −25 with a one-second swell to −8.
    const film = readings(30, (t) => (t <= 4.5 ? -60 : t > 6 && t <= 7 ? -8 : -25));
    assert.equal(usualLoudness(film, 0.5, 5), -25);
    assert.equal(usualLoudness(film, 3, 8), -25);
    assert.equal(
      usualLoudness(
        readings(10, () => SILENT),
        2,
        5,
      ),
      -Infinity,
    );
  });
});

describe("film loudness kept beside the clip", () => {
  it("is read back from the kept readings, silence included, without measuring again", async () => {
    const dir = await mkdtemp(join(tmpdir(), "scene-loudness-"));
    const clip = join(dir, "clip.mp4");
    await writeFile(clip, "not a film: reading it with ffmpeg would fail");
    const { size, mtimeMs } = await stat(clip);
    await writeFile(
      join(dir, `loudness-v1-${size}-${Math.trunc(mtimeMs)}.json`),
      JSON.stringify([
        [0.1, null],
        [0.2, -23.5],
      ]),
    );
    assert.deepEqual(await filmLoudness(clip), [
      { t: 0.1, lufs: -Infinity },
      { t: 0.2, lufs: -23.5 },
    ]);
  });
});

describe("film dip under the narration", () => {
  const at = (depth: Float32Array, seconds: number) => depth[Math.round(seconds * 100)];

  it("lowers the film until the voice is 10 LU over it, between 3 and 20 dB", () => {
    const dip = (film: number, voiceLufs: number) =>
      at(
        duckEnvelope({
          film: readings(20, () => film),
          lines: [{ start: 10, end: 12, voiceLufs }],
          seconds: 20,
        }),
        11,
      );
    assert.ok(Math.abs(dip(-20, -16) - 6) < 1e-4);
    assert.equal(dip(-5, -16), 20);
    assert.equal(dip(-40, -26), 3);
  });

  it("goes deeper under a swell inside the line", () => {
    const depth = duckEnvelope({
      film: readings(20, (t) => (t > 11 && t <= 11.6 ? -8 : -20)),
      lines: [{ start: 10, end: 13, voiceLufs: -16 }],
      seconds: 20,
    });
    assert.ok(Math.abs(at(depth, 10.2) - 6) < 1e-4);
    assert.ok(at(depth, 11.2) > 15);
  });

  it("is in place when the line starts and comes back at 20 dB a second", () => {
    const depth = duckEnvelope({
      film: readings(20, () => -5),
      lines: [{ start: 10, end: 12, voiceLufs: -16 }],
      seconds: 20,
    });
    assert.equal(at(depth, 9.65), 0);
    assert.ok(at(depth, 9.85) > 0);
    assert.equal(at(depth, 10), 20);
    assert.equal(at(depth, 12.05), 20);
    assert.ok(Math.abs(at(depth, 12.6) - 9.8) < 1e-3);
    assert.equal(at(depth, 13.2), 0);
    for (let k = 1; k < depth.length; k++) assert.ok(depth[k - 1] - depth[k] <= 0.2 + 1e-4);
  });

  it("stays down between lines less than 2 s apart, and comes up between others", () => {
    const depth = (secondStart: number) =>
      duckEnvelope({
        film: readings(30, () => -20),
        lines: [
          { start: 10, end: 12, voiceLufs: -16 },
          { start: secondStart, end: secondStart + 2, voiceLufs: -16 },
        ],
        seconds: 30,
      });
    assert.ok(Math.abs(at(depth(13.5), 12.75) - 6) < 1e-4);
    assert.equal(at(depth(16), 14), 0);
  });
});

describe("WebVTT descriptions", () => {
  it("keeps each line's text on one line and escapes what cue text reads as markup", () => {
    assert.equal(vttCueText("She waves.\n\nHe leaves."), "She waves. He leaves.");
    assert.equal(vttCueText("  R&D <Lab> entrance. "), "R&amp;D &lt;Lab&gt; entrance.");
    assert.equal(vttCueText("An arrow --> points left."), "An arrow --&gt; points left.");
  });

  it("writes cues in time order with no blank line inside a cue", () => {
    const vtt = webVtt([
      { start: 61.25, end: 63.25, text: "Later." },
      { start: 11.2, end: 13.2, text: "First.\n\nThen 1 < 2 --> more." },
    ]);
    assert.equal(
      vtt,
      "WEBVTT\n\n1\n00:00:11.200 --> 00:00:13.200\nFirst. Then 1 &lt; 2 --&gt; more.\n\n" +
        "2\n00:01:01.250 --> 00:01:03.250\nLater.\n",
    );
    for (const block of vtt.trim().split("\n\n").slice(1))
      assert.equal(block.split("\n").length, 3);
    assert.equal(
      describedVtt([{ start: 1, end: 2, text: "A <b>" }]),
      webVtt([{ start: 1, end: 2, text: "A <b>" }]),
    );
  });
});

describe("upload title", () => {
  const graphemes = (text: string) => [...new Intl.Segmenter().segment(text)].length;

  it("is the file name without its extension", () => {
    assert.equal(uploadTitle("Sintel trailer.mp4"), "Sintel trailer");
    assert.equal(uploadTitle(".mp4"), "Untitled clip");
    assert.equal(uploadTitle(`${"a".repeat(80)}.mov`), "a".repeat(80));
  });

  it("cuts a long name after the last whole word that fits, with an ellipsis", () => {
    const name =
      "The quick brown fox jumps over the lazy dog, then naps in the warm afternoon sun by the river";
    const title = uploadTitle(`${name}.mp4`);
    assert.equal(
      title,
      "The quick brown fox jumps over the lazy dog, then naps in the warm afternoon…",
    );
    assert.ok(graphemes(title) <= 80);
    const korean = "한국어 제목이 아주 길게 이어지는 영상 파일 ".repeat(5);
    const cut = uploadTitle(`${korean}.mp4`);
    assert.ok(graphemes(cut) <= 80);
    assert.ok(cut.endsWith("…") && korean.startsWith(`${cut.slice(0, -1)} `));
  });

  it("never splits a character the reader sees as one, even inside a long word", () => {
    const family = "👨‍👩‍👧‍👦";
    assert.equal(uploadTitle(`${family.repeat(100)}.mp4`), `${family.repeat(79)}…`);
    assert.equal(uploadTitle(`${"x".repeat(200)}.mp4`), `${"x".repeat(79)}…`);
  });

  it("cuts inside a word when cutting after one would keep too little of the name", () => {
    const name =
      "Trailer 4K_The_Lord_of_the_Rings_The_Rings_of_Power_Season_Two_Official_Prime_Video_HD";
    assert.equal(uploadTitle(`${name}.mp4`), `${name.slice(0, 79)}…`);
    assert.equal(
      uploadTitle(`A ${"supercalifragilistic_".repeat(5)}forever.mp4`),
      `A ${"supercalifragilistic_".repeat(5)}forever`.slice(0, 79) + "…",
    );
  });
});

/** Header dumps as ffmpeg 5.1 (the deployed image) prints them, trimmed to the stream lines. */
const HEADERS = {
  portrait: `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'portrait-15s.mp4':
  Duration: 00:00:15.00, start: 0.000000, bitrate: 532 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 608x1080 [SAR 1:1 DAR 76:135], 421 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 101 kb/s (default)`,
  webm: `Input #0, matroska,webm, from 'format-webm-20s.webm':
  Duration: 00:00:20.01, start: -0.007000, bitrate: 1487 kb/s
  Stream #0:0(eng): Video: vp9 (Profile 0), yuv420p(tv, progressive), 1280x534, SAR 1:1 DAR 640:267, 24 fps, 24 tbr, 1k tbn (default)
  Stream #0:1(eng): Audio: opus, 48000 Hz, stereo, fltp (default)`,
  phone: `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'rot60.mp4':
  Duration: 00:00:04.00, start: 0.000000, bitrate: 27880 kb/s
  Stream #0:0[0x1](und): Video: h264 (Constrained Baseline) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 27876 kb/s, 60 fps, 60 tbr, 15360 tbn (default)
    Metadata:
      handler_name    : VideoHandler
    Side data:
      displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 101 kb/s (default)`,
  broadcast: `Input #0, mpegts, from 'news.ts':
  Duration: 00:00:30.00, start: 1.400000, bitrate: 4000 kb/s
  Stream #0:0[0x100]: Video: h264 (Main) ([27][0][0][0] / 0x001B), yuv420p(tv, bt709, top first), 720x576 [SAR 16:15 DAR 4:3], 25 fps, 50 tbr, 90k tbn`,
  hdr: `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'hdr.mov':
  Duration: 00:00:10.00, start: 0.000000, bitrate: 9000 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 1280x720, 8000 kb/s, 29.97 fps, 29.97 tbr, 600 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 160 kb/s (default)`,
  web1080: `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'en-tos-89s.mp4':
  Duration: 00:01:30.00, start: 0.000000, bitrate: 1243 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 1191 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 48000 Hz, stereo, fltp, 44 kb/s (default)`,
  web4k: `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from '4k.mp4':
  Duration: 00:00:20.00, start: 0.000000, bitrate: 12000 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 3840x2160 [SAR 1:1 DAR 16:9], 11800 kb/s, 30 fps, 30 tbr, 15360 tbn (default)`,
  ts: `Input #0, mpegts, from 'clip.ts':
  Duration: 00:00:12.00, start: 1.400000, bitrate: 2000 kb/s
  Stream #0:0[0x100]: Video: h264 (Main) ([27][0][0][0] / 0x001B), yuv420p(tv, bt709, progressive), 1280x720 [SAR 1:1 DAR 16:9], 29.97 fps, 29.97 tbr, 90k tbn`,
  song: `Input #0, mp3, from 'song.mp3':
  Duration: 00:03:00.00, start: 0.025057, bitrate: 320 kb/s
  Stream #0:0: Audio: mp3, 44100 Hz, stereo, fltp, 320 kb/s
  Stream #0:1: Video: mjpeg (Baseline), yuvj420p(pc, bt470bg/unknown/unknown), 600x600 [SAR 1:1 DAR 1:1], 90k tbr, 90k tbn (attached pic)`,
};

describe("reading ffmpeg's header dump", () => {
  it("reads the picture's codec, profile, pixel format, rate and rotation", () => {
    const portrait = readMediaProbe(HEADERS.portrait);
    assert.equal(portrait.durationSeconds, 15);
    assert.deepEqual([portrait.width, portrait.height, portrait.hasAudio], [608, 1080, true]);
    assert.deepEqual(portrait.video, {
      codec: "h264",
      profile: "High",
      pixelFormat: "yuv420p",
      interlaced: false,
      fps: 30,
      rotated: false,
    });
    assert.deepEqual(readMediaProbe(HEADERS.webm).video.profile, "Profile 0");
    const phone = readMediaProbe(HEADERS.phone).video;
    assert.deepEqual([phone.profile, phone.fps, phone.rotated], ["Constrained Baseline", 60, true]);
    assert.equal(readMediaProbe(HEADERS.broadcast).video.interlaced, true);
    assert.deepEqual(readMediaProbe(HEADERS.hdr).video.pixelFormat, "yuv420p10le");
    assert.equal(readMediaProbe(HEADERS.ts).video.fps, 29.97);
  });

  it("does not count cover art as a picture", () => {
    const song = readMediaProbe(HEADERS.song);
    assert.deepEqual([song.hasVideo, song.hasAudio, song.video.codec], [false, true, null]);
  });

  it("copies only H.264 that browsers play, up to 1080p and 30 fps, progressive and upright", () => {
    const copies = Object.fromEntries(
      Object.entries(HEADERS).map(([name, header]) => [name, playsAsIs(readMediaProbe(header))]),
    );
    assert.deepEqual(copies, {
      portrait: true,
      webm: false,
      phone: false,
      broadcast: false,
      hdr: false,
      web1080: true,
      web4k: false,
      ts: true,
      song: false,
    });
  });
});
