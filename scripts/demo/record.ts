/**
 * Records the deployed app the way a person would use it: open the sample, replay the run, open the
 * rewritten line, listen with eyes closed, switch to Brief. Each beat lasts at least as long as the
 * presenter needs for it (voice.ts plan), so the builder never has to freeze or cut the picture.
 *
 * Frames come from the Chrome DevTools screencast with their capture time; the page logs when the
 * film starts playing, so the builder can lay the film's own sound under the picture.
 *
 * Output: runtime/demo/<lang>/rec/{frames/*.jpg, frames.json, marks.json, media.json}
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";
import { dictionary } from "../../src/i18n";
import type { Language } from "../../src/lib/pipeline/schemas";
import { CHROME_PATH } from "./cards";
import { PROJECT_ID, SERVICE_URL, type DemoData } from "./demo-data";
import type { Beat, Scene } from "./storyboard";
import { featuredLine, LISTEN_FROM, LISTEN_TO } from "./storyboard";
import { planScene, type VoicedSentence } from "./voice";

/** 1440×720 CSS pixels at 4/3 fill the 1920×960 content area of the video. */
const VIEWPORT = { width: 1440, height: 720 };
const SCALE = 4 / 3;
const CURSOR_MOVE_MS = 650;
/** A frame of the sample that shows what the film is about (the man inspecting a brain). */
const POSTER_SECONDS = 57.5;

export interface Frame {
  file: string;
  /** Seconds since the epoch, as Chrome stamped the frame. */
  t: number;
}

export interface Mark {
  beat: Beat;
  start: number;
  end: number;
}

export interface MediaEvent {
  type: "playing" | "pause";
  wall: number;
  media: number;
}

/** A drawn cursor (headless Chrome paints none) that glides to its target and pulses on click. */
const CURSOR_SCRIPT = `
(() => {
  const install = () => {
    if (document.getElementById("demo-cursor")) return;
    const el = document.createElement("div");
    el.id = "demo-cursor";
    el.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M4 2 L4 22 L9.5 17 L13 25 L16.5 23.5 L13 15.5 L20.5 15.5 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg><span></span>';
    Object.assign(el.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none",
      transform: "translate(1100px, 520px)", transition: "transform 650ms cubic-bezier(.3,.7,.2,1)" });
    const ring = el.querySelector("span");
    Object.assign(ring.style, { position: "absolute", left: "-14px", top: "-14px", width: "32px", height: "32px",
      borderRadius: "50%", border: "2px solid #f1b54b", opacity: "0", transition: "transform 380ms ease, opacity 380ms ease" });
    document.documentElement.appendChild(el);
    window.__demoCursor = {
      move(x, y) { el.style.transform = "translate(" + x + "px, " + y + "px)"; },
      pulse() {
        ring.style.transition = "none"; ring.style.transform = "scale(0.4)"; ring.style.opacity = "1";
        requestAnimationFrame(() => { ring.style.transition = "transform 380ms ease, opacity 380ms ease";
          ring.style.transform = "scale(1.4)"; ring.style.opacity = "0"; });
      },
    };
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
  window.__mediaLog = [];
  const log = (type) => (e) => { if (e.target instanceof HTMLVideoElement)
    window.__mediaLog.push({ type, wall: Date.now() / 1000, media: e.target.currentTime }); };
  document.addEventListener("playing", log("playing"), true);
  document.addEventListener("pause", log("pause"), true);
})();
`;

async function glideTo(page: Page, target: Locator): Promise<{ x: number; y: number }> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`No box for ${target}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.evaluate(([px, py]) => (window as any).__demoCursor.move(px, py), [x, y]);
  await page.waitForTimeout(CURSOR_MOVE_MS + 80);
  return { x, y };
}

async function clickLike(page: Page, target: Locator): Promise<void> {
  const { x, y } = await glideTo(page, target);
  await page.evaluate(() => (window as any).__demoCursor.pulse());
  await page.mouse.click(x, y);
}

async function smoothScroll(page: Page, top: number): Promise<void> {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), top);
  await page.waitForTimeout(700);
}

/** Scrolls so the element's bottom sits just above the bottom of the viewport. */
async function scrollToBottomOf(page: Page, selector: string): Promise<void> {
  const top = await page.evaluate((sel) => {
    const el = document.querySelector(sel)!;
    const rect = el.getBoundingClientRect();
    return Math.max(0, window.scrollY + rect.bottom - window.innerHeight + 16);
  }, selector);
  await smoothScroll(page, top);
}

export async function recordApp(input: {
  lang: Language;
  data: DemoData;
  scenes: Scene[];
  voiced: VoicedSentence[];
  outDir: string;
}): Promise<{ frames: Frame[]; marks: Mark[]; media: MediaEvent[] }> {
  const { lang, data, scenes, voiced, outDir } = input;
  const t = dictionary(lang);
  const framesDir = join(outDir, "frames");
  await rm(outDir, { recursive: true, force: true });
  await mkdir(framesDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"],
  });
  const frames: Frame[] = [];
  const writes: Promise<void>[] = [];
  const marks: Mark[] = [];
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
    await context.addCookies([{ name: "scene_lang", value: lang, url: SERVICE_URL }]);
    await context.addInitScript(CURSOR_SCRIPT);
    const page = await context.newPage();
    await page.goto(SERVICE_URL, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);

    const cdp = await context.newCDPSession(page);
    cdp.on("Page.screencastFrame", (frame) => {
      const file = join(framesDir, `${String(frames.length).padStart(6, "0")}.jpg`);
      frames.push({ file, t: frame.metadata.timestamp ?? Date.now() / 1000 });
      writes.push(writeFile(file, Buffer.from(frame.data, "base64")));
      void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 92,
      maxWidth: VIEWPORT.width * SCALE,
      maxHeight: VIEWPORT.height * SCALE,
      everyNthFrame: 1,
    });
    await page.waitForTimeout(500);

    const beat = async (name: Beat, act: (start: number) => Promise<void>) => {
      const scene = scenes.find((s) => "beat" in s.show && s.show.beat === name)!;
      const minSeconds = planScene(scene, voiced).minSeconds;
      const start = Date.now() / 1000;
      await act(start);
      const left = minSeconds - (Date.now() / 1000 - start);
      if (left > 0) await page.waitForTimeout(left * 1000);
      marks.push({ beat: name, start, end: Date.now() / 1000 });
    };
    const untilOffset = async (start: number, offset: number) => {
      const wait = start + offset - Date.now() / 1000;
      if (wait > 0) await page.waitForTimeout(wait * 1000);
    };

    await beat("open", async () => {
      await page.waitForTimeout(1500);
      await clickLike(page, page.locator(".sample-card"));
      await page.waitForURL(`**/p/${PROJECT_ID}`);
      await page.locator(".metrics").waitFor();
      // Park the paused film on a telling frame instead of the black first frame.
      await page.evaluate((at) => {
        document.querySelector<HTMLVideoElement>(".player-frame video")!.currentTime = at;
      }, POSTER_SECONDS);
      await page.waitForTimeout(1200);
      await scrollToBottomOf(page, ".metrics");
      await glideTo(page, page.locator(".tl-dialogue").nth(4));
      await page.waitForTimeout(1300);
      await glideTo(page, page.locator(".tl-room").nth(1));
      await page.waitForTimeout(1300);
      await glideTo(page, page.locator(".tl-narration .cue").nth(1));
    });

    await beat("replay", async () => {
      await clickLike(page, page.getByRole("button", { name: t.workspace.replay }));
      await page.locator(".replay-badge").waitFor();
      await glideTo(page, page.locator(".stages"));
      await page.locator(".replay-badge").waitFor({ state: "detached", timeout: 60_000 });
    });

    const featured = featuredLine(data.standard);
    await beat("detail", async () => {
      await clickLike(page, page.locator(".tl-narration .cue", { hasText: featured.cue.id }));
      await page.locator(".versions").waitFor();
      await page.waitForTimeout(800);
      if (featured.loop === "review") {
        await glideTo(page, page.locator(".verdict.fail").first());
      } else {
        await glideTo(page, page.locator(".version").first());
        await page.waitForTimeout(2500);
        await glideTo(page, page.locator(".fit"));
      }
    });

    const listen = scenes.find((s) => s.id === "listen")!;
    const listenPlan = planScene(listen, voiced);
    await beat("listen", async (start) => {
      await clickLike(page, page.locator(".button.back"));
      await smoothScroll(page, 0);
      await clickLike(page, page.getByRole("button", { name: t.workspace.eyesClosed }));
      await page.evaluate((from) => {
        const video = document.querySelector<HTMLVideoElement>(".player-frame video")!;
        video.currentTime = from;
      }, LISTEN_FROM);
      await glideTo(page, page.locator(".button.play"));
      await untilOffset(start, listenPlan.film!.start);
      await clickLike(page, page.locator(".button.play"));
      // Stop on the film's own clock, so a late start never cuts the end of the stretch.
      await page.waitForFunction(
        (to) => document.querySelector<HTMLVideoElement>(".player-frame video")!.currentTime >= to,
        LISTEN_TO,
        { timeout: 60_000, polling: 50 },
      );
      await page.evaluate(() =>
        document.querySelector<HTMLVideoElement>(".player-frame video")!.pause(),
      );
    });

    await beat("brief", async () => {
      await clickLike(page, page.getByRole("button", { name: t.workspace.eyesOpen }));
      await scrollToBottomOf(page, ".timeline");
      await clickLike(page, page.getByRole("button", { name: t.workspace.densityBrief }));
      await page.locator(".tl-narration .cue").first().waitFor();
      await page.waitForTimeout(600);
    });

    await cdp.send("Page.stopScreencast");
    const media = (await page.evaluate(() => (window as any).__mediaLog)) as MediaEvent[];
    await Promise.all(writes);
    await writeFile(join(outDir, "frames.json"), JSON.stringify(frames));
    await writeFile(join(outDir, "marks.json"), JSON.stringify(marks, null, 2));
    await writeFile(join(outDir, "media.json"), JSON.stringify(media, null, 2));
    return { frames, marks, media };
  } finally {
    await browser.close();
  }
}
