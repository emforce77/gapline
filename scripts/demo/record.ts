/**
 * Records the app scenes (beats.ts) in Chrome at 2× device scale (2880×1320 frames from a 1440×660
 * viewport), in the film's language (the scene_lang cookie), timed by the caption plan for that
 * language. Requests that would start a paid run or edit are aborted; if any was attempted the
 * recording fails.
 *
 * A scene that plays the film keeps the page's media log and the box of the film's picture in the
 * player: the builder lays the film itself over that box from the moment the page showed its first
 * frame. Playback that stalls (presented frames more than 0.15 s apart) fails the recording unless
 * that laid film covers the stretch; then it is only reported.
 *
 * Output: runtime/demo-v3/<lang>/rec/{frames/*.jpg, frames.json, beats.json}
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { probeMedia } from "../../src/lib/media/ffmpeg";
import type { Language } from "../../src/lib/pipeline/schemas";
import { SCRIPTS } from "./beats";
import { BASE_URL, CHROME_PATH, DEVICE_SCALE, PROJECT_ID, SAMPLE_RUN, VIEWPORT } from "./config";
import {
  BeatClock,
  CURSOR_SCRIPT,
  type BeatRecord,
  type Frame,
  type MediaEvent,
  type PlayerPicture,
} from "./recorder-kit";
import type { Scene } from "./storyboard";
import { planScene } from "./timing";

const PAID = /\/(runs|edits)(\/|$|\?)/;
const JPEG_QUALITY = 88;
/** How long a scene that starts on its next frame waits for one. */
const NEXT_FRAME_TIMEOUT_MS = 3000;
const FRAME_POLL_MS = 10;
/** Presented frames further apart than this during playback are a stall (the film runs at 24 fps). */
export const MAX_FRAME_GAP_S = 0.15;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Stops before recording anything when the service does not hold the sample run. */
async function checkPinnedRuns(): Promise<void> {
  const response = await fetch(`${BASE_URL}/api/projects/${PROJECT_ID}/runs`);
  if (!response.ok) throw new Error(`${BASE_URL}: runs HTTP ${response.status}`);
  const ids = ((await response.json()) as { runs: { runId: string }[] }).runs.map((r) => r.runId);
  if (!ids.includes(SAMPLE_RUN)) throw new Error(`${BASE_URL} does not have run ${SAMPLE_RUN}`);
}

/**
 * Stops before recording anything when a live run could not start on the service: the workspace
 * would show its spent-allowance notice in the upload card, under Generate and above the stage
 * list. Record from a DATA_DIR without budget/ (MODULE.md, Production).
 */
async function checkLiveAllowance(): Promise<LiveAllowance> {
  const response = await fetch(`${BASE_URL}/api/live-status`);
  if (!response.ok) throw new Error(`${BASE_URL}: live-status HTTP ${response.status}`);
  const status = (await response.json()) as LiveAllowance;
  if (!status.canStart)
    throw new Error(`live allowance ${status.reason}: record from a DATA_DIR without budget/`);
  return status;
}

/** What /api/live-status said before the recording (kept in source.json for the check note). */
export interface LiveAllowance {
  canStart: boolean;
  reason: string | null;
}

/**
 * The stamp of the first screencast frame stamped after wall time `after`. A frame stamped just
 * before can still show the page as it was: in the 2026-09-23 recording, the frame stamped 7 ms
 * before the replay's setup returned (two animation frames after the reset stage list was
 * committed) still showed the finished run, and the next one, stamped 63 ms after, the reset list.
 */
export async function frameAfter(frames: Frame[], after: number): Promise<number> {
  const until = Date.now() + NEXT_FRAME_TIMEOUT_MS;
  for (;;) {
    const next = frames.find((f) => f.t > after);
    if (next) return next.t;
    if (Date.now() > until) throw new Error(`no screencast frame came after ${after.toFixed(3)}`);
    await new Promise((r) => setTimeout(r, FRAME_POLL_MS));
  }
}

/** Stretches between presented frames longer than MAX_FRAME_GAP_S, in wall seconds. */
export function frameGaps(presented: MediaEvent[]): { wall: number; seconds: number }[] {
  const gaps: { wall: number; seconds: number }[] = [];
  for (let i = 1; i < presented.length; i++) {
    const seconds = presented[i].wall - presented[i - 1].wall;
    if (seconds > MAX_FRAME_GAP_S) gaps.push({ wall: presented[i - 1].wall, seconds });
  }
  return gaps;
}

/**
 * The film's playback in a scene, from the page's media log: when its first frame reached the
 * screen, and the stretches where the page's playback stalled. The film laid over the player covers
 * everything from its first frame on; a stall outside that fails the recording.
 */
export function readPlayback(rec: BeatRecord, media: MediaEvent[], player?: PlayerPicture): void {
  const playing = media.find((e) => e.type === "playing");
  if (!playing) return;
  const paused = media.find((e) => e.type === "pause" && e.wall > playing.wall);
  const stop = paused?.wall ?? rec.wallEnd;
  // The picture reaches the screen after 'playing' fires: the presented frames place the sound.
  const presented = media.filter(
    (e) => e.type === "frame" && e.wall >= playing.wall && e.wall <= stop,
  );
  if (!presented.length) throw new Error(`${rec.beat}: the film played but presented no frames`);
  if (!player)
    throw new Error(`${rec.beat}: the film played but the player's picture was not measured`);
  const offset = median(presented.map((f) => f.wall - f.media));
  rec.playback = {
    wall: playing.media + offset,
    media: playing.media,
    until: Math.max(...presented.map((f) => f.media)) + offset,
    ...player,
  };
  const gaps = frameGaps(presented);
  rec.stalls = gaps;
  const covered = (g: { wall: number }) => g.wall >= presented[0].wall;
  const open = gaps.filter((g) => !covered(g));
  if (open.length)
    throw new Error(
      `${rec.beat}: the film's playback stalled where nothing covers it: ${open.map((g) => `${g.seconds.toFixed(2)} s`).join(", ")}`,
    );
  const hitches = media.filter(
    (e) =>
      (e.type === "waiting" || e.type === "stalled") && e.wall >= playing.wall && e.wall <= stop,
  );
  if (gaps.length || hitches.length)
    console.warn(
      `record ${rec.beat}: the page's own playback stalled (${gaps.length} frame gaps over ${MAX_FRAME_GAP_S} s, longest ${Math.max(0, ...gaps.map((g) => g.seconds)).toFixed(2)} s; ${hitches.length} waiting/stalled events); the film laid over the player covers it`,
    );
}

export async function recordApp(input: {
  scenes: Scene[];
  lang: Language;
  outDir: string;
}): Promise<void> {
  await checkPinnedRuns();
  const liveAllowance = await checkLiveAllowance();
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
    await context.addCookies([{ name: "scene_lang", value: input.lang, url: BASE_URL }]);
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
    // Frames still arriving once the screencast is stopped are neither kept nor acknowledged: an
    // acknowledgement sent then can outlive the browser and fail the process (seen in a dry run).
    let stopped = false;
    cdp.on("Page.screencastFrame", (frame) => {
      if (stopped) return;
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
      const plan = planScene(scene, input.lang);
      await SCRIPTS[beat].before(page, input.lang);
      const clock = new BeatClock(
        page,
        beat,
        plan.seconds,
        SCRIPTS[beat].fromNextFrame ? await frameAfter(frames, Date.now() / 1000) : undefined,
      );
      await SCRIPTS[beat].run(page, clock, plan, input.lang);
      const rec = clock.end();
      const media = (
        await page.evaluate(() => (window as unknown as { __mediaLog: MediaEvent[] }).__mediaLog)
      ).filter((e) => e.wall >= rec.wallStart && e.wall <= rec.wallEnd);
      rec.media = media;
      readPlayback(rec, media, clock.player);
      beats.push(rec);
      const shown = frames.filter((f) => f.t >= rec.wallStart && f.t < rec.wallEnd).length;
      console.log(
        `record ${beat}: ${(rec.wallEnd - rec.wallStart).toFixed(1)} s wall, ${rec.seconds.toFixed(1)} s in film, ${shown} frames` +
          (rec.late.length
            ? `, off plan: ${rec.late.map((l) => `${l.what} ${l.by >= 0 ? "+" : ""}${l.by.toFixed(1)} s`).join("; ")}`
            : ""),
      );
    }
    stopped = true;
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
      JSON.stringify(
        {
          baseUrl: BASE_URL,
          lang: input.lang,
          recordedAt: new Date().toISOString(),
          liveAllowance,
        },
        null,
        2,
      ),
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
