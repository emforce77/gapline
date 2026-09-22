/**
 * Records a real upload, the selected run's saved trace, review history, a paid human edit and
 * playback/download. The builder labels time compression; listening remains at normal speed.
 *
 * Frames come from the Chrome DevTools screencast with their capture time; the page logs when the
 * film starts playing, so the builder can lay the film's own sound under the picture.
 *
 * Output: runtime/demo-v2/<lang>/rec/{frames/*.jpg, frames.json, marks.json, media.json}
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, type Locator, type Page } from "playwright-core";
import { dictionary } from "../../src/i18n";
import type { Language } from "../../src/lib/pipeline/schemas";
import { CHROME_PATH } from "./cards";
import { PROJECT_ID, SERVICE_URL, loadRunById, saveEditedRun, type DemoData } from "./demo-data";
import type { Beat, Scene } from "./storyboard";
import { featuredLine, LISTEN_FROM, LISTEN_TO } from "./storyboard";
import { planScene, type VoicedSentence } from "./voice";

/** 1440×720 CSS pixels at 4/3 fill the 1920×960 content area of the video. */
const VIEWPORT = { width: 1440, height: 720 };
const SCALE = 4 / 3;
const CURSOR_MOVE_MS = 650;

export interface Frame {
  file: string;
  /** Seconds since the epoch, as Chrome stamped the frame. */
  t: number;
}

export interface Mark {
  beat: Beat;
  start: number;
  end: number;
  targetSeconds?: number;
  processingSeconds?: number;
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
  await mkdir(framesDir, { recursive: true });
  const resumeListen = process.env.DEMO_RECORD_LISTEN_ONLY === "1";
  if (resumeListen && data.edited.runId === data.editBase.runId)
    throw new Error("No completed edit to resume");
  const browser = await chromium.launch({
    executablePath: CHROME_PATH,
    args: ["--autoplay-policy=no-user-gesture-required", "--hide-scrollbars"],
  });
  const frames: Frame[] = resumeListen
    ? JSON.parse(await readFile(join(outDir, "frames.json"), "utf8"))
    : [];
  const writes: Promise<void>[] = [];
  const marks: Mark[] = resumeListen
    ? JSON.parse(await readFile(join(outDir, "marks.json"), "utf8")).filter(
        (m: Mark) => m.beat !== "listen",
      )
    : [];
  const captureId = Date.now().toString(36);
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: SCALE,
      acceptDownloads: true,
      storageState: resumeListen ? join(outDir, "session.json") : undefined,
    });
    await context.addCookies([{ name: "scene_lang", value: lang, url: SERVICE_URL }]);
    await context.addInitScript(CURSOR_SCRIPT);
    const page = await context.newPage();
    await page.goto(SERVICE_URL, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    const cdp = await context.newCDPSession(page);
    cdp.on("Page.screencastFrame", (frame) => {
      const file = join(framesDir, `${captureId}-${String(frames.length).padStart(6, "0")}.jpg`);
      frames.push({ file, t: frame.metadata.timestamp ?? Date.now() / 1000 });
      writes.push(writeFile(file, Buffer.from(frame.data, "base64")));
      void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
    });
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 90,
      maxWidth: 1920,
      maxHeight: 960,
      everyNthFrame: 1,
    });
    const beat = async (name: Beat, act: () => Promise<void>) => {
      const scene = scenes.find((s) => "beat" in s.show && s.show.beat === name)!;
      const target = planScene(scene, voiced).minSeconds;
      const start = Date.now() / 1000;
      try {
        await act();
        const left = target - (Date.now() / 1000 - start);
        if (left > 0) await page.waitForTimeout(left * 1000);
      } finally {
        marks.push({
          beat: name,
          start,
          end: Date.now() / 1000,
          targetSeconds: target,
          ...(name === "edit" ? { processingSeconds: data.edited.summary.wallSeconds } : {}),
        });
        await Promise.all(writes);
        await writeFile(
          join(outDir, "frames.json"),
          JSON.stringify([...frames].sort((a, b) => a.t - b.t)),
        );
        await writeFile(join(outDir, "marks.json"), JSON.stringify(marks, null, 2));
        await context.storageState({ path: join(outDir, "session.json") });
        await writeFile(
          join(outDir, "media.json"),
          JSON.stringify(await page.evaluate(() => (window as any).__mediaLog), null, 2),
        );
        console.log(`record ${name}: ${(Date.now() / 1000 - start).toFixed(1)} s captured`);
      }
    };
    const openRun = async (id: string) => {
      await page.goto(`${SERVICE_URL}/p/${PROJECT_ID}?run=${id}`, { waitUntil: "networkidle" });
      await page.locator(".metrics").waitFor();
      await page.waitForFunction((id) => {
        const v = document.querySelector<HTMLVideoElement>("video");
        return !!v && v.currentSrc.includes(id) && v.readyState >= 2;
      }, id);
      await page.locator("video").evaluate((v: HTMLVideoElement) => {
        v.currentTime = 57.5;
      });
      await page.waitForTimeout(300);
    };
    if (!resumeListen) {
      await beat("open", async () => {
        const uploaded = page.waitForResponse(
          (r) => r.url().endsWith("/api/projects") && r.request().method() === "POST",
          { timeout: 120000 },
        );
        await page.locator('input[type="file"]').setInputFiles(data.clipFile);
        const response = await uploaded;
        if (!response.ok())
          throw new Error(
            `Recorded upload failed: HTTP ${response.status()} ${await response.text()}`,
          );
        await page.waitForURL("**/p/u-*", { timeout: 120000 });
        await page.getByRole("button", { name: t.workspace.generate, exact: true }).waitFor();
      });
      await openRun(data.standard.runId);
      await beat("replay", async () => {
        await clickLike(page, page.getByRole("button", { name: t.workspace.replay, exact: false }));
        await page.locator(".replay-badge").waitFor();
        await page.locator(".replay-badge").waitFor({ state: "detached", timeout: 60000 });
      });
      await beat("detail", async () => {
        const featured = featuredLine(data.standard);
        await clickLike(
          page,
          page
            .locator(".tl-narration .cue")
            .filter({ hasText: new RegExp(`^${featured.cue.id}$`) }),
        );
        await page.locator(".versions").waitFor();
        await glideTo(page, page.locator(".verdict.fail").first());
        await page.waitForTimeout(6000);
        await glideTo(page, page.locator(".versions .version").last());
        await page.screenshot({ path: join(outDir, "review.png") });
      });
      if (process.env.DEMO_EDIT_CAPTURE) {
        const saved = JSON.parse(await readFile(process.env.DEMO_EDIT_CAPTURE, "utf8"));
        if (saved.runId !== data.edited.runId) throw new Error("Recovered edit run mismatch");
        frames.push(...saved.frames);
        marks.push(saved.mark);
        await openRun(data.edited.runId);
        await page
          .locator(".tl-narration .cue")
          .filter({ hasText: new RegExp(`^${data.edit.cueId}$`) })
          .click();
        await page.locator(".cue-editor").waitFor();
        await page.locator(".cue-editor").scrollIntoViewIfNeeded();
        await page.screenshot({ path: join(outDir, "editor.png") });
        console.log(
          "record edit: reusing the actual completed edit capture without another API call",
        );
      } else {
        await openRun(data.editBase.runId);
        await beat("edit", async () => {
          await clickLike(
            page,
            page
              .locator(".tl-narration .cue")
              .filter({ hasText: new RegExp(`^${data.edit.cueId}$`) }),
          );
          await page.locator(".cue-editor").waitFor();
          await glideTo(page, page.locator(".cue-editor textarea"));
          await page.locator(".cue-editor textarea").fill(data.edit.text);
          await page.locator('.cue-editor input[name="start"]').fill(String(data.edit.start));
          await page.waitForTimeout(1500);
          const responsePromise = page.waitForResponse(
            (r) => r.url().endsWith("/edits") && r.request().method() === "POST",
            { timeout: 900000 },
          );
          await clickLike(page, page.locator('.cue-editor button[type="submit"]'));
          const response = await responsePromise;
          const result = await response.json();
          if (!response.ok()) throw Error(`Recorded edit failed: ${JSON.stringify(result)}`);
          await writeFile(join(outDir, "edit-request.json"), response.request().postData()!);
          await page.waitForFunction(
            (id) =>
              document.querySelector<HTMLSelectElement>(".result-picker select")?.value === id,
            result.runId,
          );
          data.edited = await loadRunById(result.runId);
          await saveEditedRun(lang, result.runId);
          await page.waitForTimeout(1500);
          await page.screenshot({ path: join(outDir, "editor.png") });
        });
      }
    } else {
      await openRun(data.edited.runId);
    }
    const back = page.locator(".button.back");
    if (await back.count()) await back.click();
    await beat("listen", async () => {
      const scene = scenes.find((s) => s.id === "listen")!;
      const plan = planScene(scene, voiced);
      const start = Date.now() / 1000;
      await page.evaluate(() => window.scrollTo(0, 0));
      await clickLike(
        page,
        page.getByRole("button", { name: t.workspace.eyesClosed, exact: true }),
      );
      await page.locator("video").evaluate((v: HTMLVideoElement, from: number) => {
        v.currentTime = from;
      }, LISTEN_FROM);
      const wait = start + plan.film!.start - Date.now() / 1000 - 0.75;
      if (wait > 0) await page.waitForTimeout(wait * 1000);
      await clickLike(page, page.locator(".button.play"));
      await page.waitForFunction(
        (to) => document.querySelector<HTMLVideoElement>("video")!.currentTime >= to,
        LISTEN_TO,
        { timeout: 30000, polling: 50 },
      );
      await page.locator("video").evaluate((v: HTMLVideoElement) => v.pause());
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 10000 }),
        clickLike(page, page.locator('.downloads a[href*="descriptions.vtt"]')),
      ]);
      await download.saveAs(join(outDir, "downloaded-descriptions.vtt"));
    });
    await cdp.send("Page.stopScreencast");
    const media = (await page.evaluate(() => (window as any).__mediaLog)) as MediaEvent[];
    await Promise.all(writes);
    frames.sort((a, b) => a.t - b.t);
    await writeFile(join(outDir, "frames.json"), JSON.stringify(frames));
    await writeFile(join(outDir, "marks.json"), JSON.stringify(marks, null, 2));
    await writeFile(join(outDir, "media.json"), JSON.stringify(media, null, 2));
    await context.storageState({ path: join(outDir, "session.json") });
    return { frames, marks, media };
  } finally {
    await browser.close();
  }
}
