/**
 * Records the app scenes (beats.ts) in Chrome at 2× device scale (2880×1440 frames from a 1440×720
 * viewport), in the English interface, timed by the presenter's plan for the film's language.
 * Requests that would start a paid run or edit are aborted; if any was attempted the recording fails.
 *
 * Output: runtime/demo-v3/<lang>/rec/{frames/*.jpg, frames.json, beats.json}
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { probeMedia } from "../../src/lib/media/ffmpeg";
import { SCRIPTS } from "./beats";
import {
  BASE_URL,
  CHROME_PATH,
  DEVICE_SCALE,
  EDIT_CHILD_RUN,
  EDIT_PARENT_RUN,
  ORIGINAL_RUN,
  PROJECT_ID,
  VIEWPORT,
} from "./config";
import { BeatClock, CURSOR_SCRIPT, type BeatRecord, type Frame } from "./recorder-kit";
import type { Scene } from "./storyboard";
import { planScene, type VoicedSentence } from "./voice";

const PAID = /\/(runs|edits)(\/|$|\?)/;
const JPEG_QUALITY = 88;

/** Stops before recording anything when the service does not hold the pinned runs. */
async function checkPinnedRuns(): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/projects/${PROJECT_ID}/runs`);
  if (!response.ok) throw new Error(`${BASE_URL}: runs HTTP ${response.status}`);
  const ids = ((await response.json()) as { runs: { runId: string }[] }).runs.map((r) => r.runId);
  for (const id of [ORIGINAL_RUN, EDIT_PARENT_RUN, EDIT_CHILD_RUN])
    if (!ids.includes(id)) throw new Error(`${BASE_URL} does not have run ${id}`);
}

export async function recordApp(input: {
  scenes: Scene[];
  voiced: VoicedSentence[];
  outDir: string;
}): Promise<void> {
  await checkPinnedRuns();
  const framesDir = join(input.outDir, "frames");
  await rm(framesDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      "--hide-scrollbars",
      `--force-device-scale-factor=${DEVICE_SCALE}`,
    ],
  });
  const frames: Frame[] = [];
  const writes: Promise<void>[] = [];
  const beats: BeatRecord[] = [];
  const blocked: string[] = [];
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE,
    });
    await context.addCookies([{ name: "scene_lang", value: "en", url: BASE_URL }]);
    await context.addInitScript(CURSOR_SCRIPT);
    await context.route("**/*", (route) => {
      const req = route.request();
      if (req.method() !== "GET" && PAID.test(req.url())) {
        blocked.push(`${req.method()} ${req.url()}`);
        return route.abort();
      }
      return route.continue();
    });
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    const cdp = await context.newCDPSession(page);
    cdp.on("Page.screencastFrame", (frame) => {
      const file = join(framesDir, `${String(frames.length).padStart(6, "0")}.jpg`);
      frames.push({ file, t: frame.metadata.timestamp ?? Date.now() / 1000 });
      writes.push(writeFile(file, Buffer.from(frame.data, "base64")));
      void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: JPEG_QUALITY,
      maxWidth: VIEWPORT.width * DEVICE_SCALE,
      maxHeight: VIEWPORT.height * DEVICE_SCALE,
      everyNthFrame: 1,
    });
    for (const scene of input.scenes) {
      if (!("beat" in scene.show)) continue;
      const beat = scene.show.beat;
      const plan = planScene(scene, input.voiced);
      await SCRIPTS[beat].before(page);
      const clock = new BeatClock(page, beat, plan.seconds);
      await SCRIPTS[beat].run(page, clock, plan);
      const rec = clock.end();
      const media = (
        await page.evaluate(
          () =>
            (window as unknown as { __mediaLog: { type: string; wall: number; media: number }[] })
              .__mediaLog,
        )
      ).filter((e) => e.wall >= rec.wallStart && e.wall <= rec.wallEnd);
      const playing = media.find((e) => e.type === "playing");
      if (playing) {
        const paused = media.find((e) => e.type === "pause" && e.wall > playing.wall);
        rec.playback = {
          wall: playing.wall,
          media: playing.media,
          until: paused?.wall ?? rec.wallEnd,
        };
      }
      beats.push(rec);
      const shown = frames.filter((f) => f.t >= rec.wallStart && f.t < rec.wallEnd).length;
      console.log(
        `record ${beat}: ${(rec.wallEnd - rec.wallStart).toFixed(1)} s wall, ${rec.seconds.toFixed(1)} s in film, ${shown} frames` +
          (rec.late.length
            ? `, late: ${rec.late.map((l) => `${l.what} +${l.by.toFixed(1)} s`).join("; ")}`
            : ""),
      );
    }
    await cdp.send("Page.stopScreencast");
  } finally {
    await Promise.all(writes);
    await writeFile(
      join(input.outDir, "frames.json"),
      JSON.stringify(frames.sort((a, b) => a.t - b.t)),
    );
    await writeFile(join(input.outDir, "beats.json"), JSON.stringify(beats, null, 2));
    await writeFile(
      join(input.outDir, "source.json"),
      JSON.stringify({ baseUrl: BASE_URL, recordedAt: new Date().toISOString() }, null, 2),
    );
    await browser.close();
  }
  if (blocked.length)
    throw new Error(`paid requests were attempted and blocked: ${blocked.join(", ")}`);
  const size = await probeMedia(frames[0].file);
  if (
    size.width !== VIEWPORT.width * DEVICE_SCALE ||
    size.height !== VIEWPORT.height * DEVICE_SCALE
  )
    throw new Error(
      `frames are ${size.width}×${size.height}, not ${VIEWPORT.width * DEVICE_SCALE}×${VIEWPORT.height * DEVICE_SCALE}`,
    );
}
