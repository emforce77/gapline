import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { extractStill } from "../src/lib/media/extract-still";
import { FfmpegError, runFfmpeg, withScratchDir } from "../src/lib/media/ffmpeg";
import { extractLineStills } from "../src/lib/pipeline/line-stills";

it("extracts the blue opening and red closing pictures; sampling after EOF fails", async () => {
  await withScratchDir(async (dir) => {
    const clip = join(dir, "cut.mp4");
    await runFfmpeg([
      "-f",
      "lavfi",
      "-i",
      "color=blue:s=64x48:r=10:d=1",
      "-f",
      "lavfi",
      "-i",
      "color=red:s=64x48:r=10:d=1",
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0",
      "-c:v",
      "libx264",
      clip,
    ]);
    const stills = await extractLineStills(clip, [
      { id: "L1", start: 0, seconds: 1.6, windowEnd: 2 },
    ]);
    const pair = stills.get("L1")!;
    assert.deepEqual(
      pair.map(({ at }) => at),
      [0.5, 1.5],
    );
    for (const [index, frame] of pair.entries()) {
      const jpeg = join(dir, frame.moment + ".jpg");
      await writeFile(jpeg, frame.jpeg);
      const { stdout: pixel } = await runFfmpeg([
        "-i",
        jpeg,
        "-vf",
        "scale=1:1",
        "-pix_fmt",
        "rgb24",
        "-threads",
        "1",
        "-f",
        "rawvideo",
        "pipe:1",
      ]);
      assert.equal(pixel.length, 3);
      assert.ok(index === 0 ? pixel[2] > 240 && pixel[0] < 10 : pixel[0] > 240 && pixel[2] < 10);
    }
    await assert.rejects(extractStill(clip, 2.5), FfmpegError);
  });
});
