/**
 * Renders a motion page frame by frame in headless Chrome: for each frame, render(t) sets the page to
 * that instant and a screenshot is piped straight into FFmpeg, so no frame folder is written. The page
 * fills the 1920×960 picture area; the caption band below it and the captions come from the scene's
 * subtitle file, burned in during the same encode.
 */
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Browser } from "playwright-core";
import { ffmpegPath } from "../../src/lib/media/ffmpeg";
import { COLOR } from "../deck/theme";
import { CONTENT_HEIGHT, FPS, HEIGHT, PAGES_DIR, WIDTH } from "./config";
import { encodeArgs, subtitlesFilter } from "./encode";

const JPEG_QUALITY = 95;

export async function renderMotion(input: {
  browser: Browser;
  name: string;
  html: string;
  seconds: number;
  assFile: string;
  fadeIn: boolean;
  out: string;
}): Promise<void> {
  const htmlFile = join(PAGES_DIR, `${input.name}.html`);
  await writeFile(htmlFile, input.html);
  const page = await input.browser.newPage({ viewport: { width: WIDTH, height: CONTENT_HEIGHT } });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => errors.push(`request failed: ${r.url()}`));
  try {
    await page.goto(pathToFileURL(htmlFile).href);
    await page.evaluate(() => document.fonts.ready);
    if (errors.length) throw new Error(`${input.name}: ${errors.join("; ")}`);
    const frames = Math.round(input.seconds * FPS);
    const filters = [
      `pad=${WIDTH}:${HEIGHT}:0:0:color=${COLOR.screen.replace("#", "0x")}`,
      subtitlesFilter(input.assFile),
      ...(input.fadeIn ? ["fade=t=in:st=0:d=0.25"] : []),
      "format=yuv420p",
    ];
    const ffmpeg = spawn(ffmpegPath(), [
      "-hide_banner",
      "-y",
      "-f",
      "image2pipe",
      "-framerate",
      String(FPS),
      "-c:v",
      "mjpeg",
      "-i",
      "-",
      "-vf",
      filters.join(","),
      ...encodeArgs(),
      input.out,
    ]);
    let stderr = "";
    ffmpeg.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    const done = new Promise<void>((resolve, reject) => {
      ffmpeg.on("error", reject);
      ffmpeg.on("close", (code) =>
        code === 0 ? resolve() : reject(new Error(`ffmpeg ${input.name}: ${stderr.slice(-800)}`)),
      );
    });
    for (let i = 0; i < frames; i++) {
      await page.evaluate(
        (t) => (window as unknown as { render: (t: number) => void }).render(t),
        i / FPS,
      );
      const jpeg = await page.screenshot({ type: "jpeg", quality: JPEG_QUALITY });
      if (!ffmpeg.stdin.write(jpeg)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
    }
    ffmpeg.stdin.end();
    await done;
    if (errors.length) throw new Error(`${input.name}: ${errors.join("; ")}`);
  } finally {
    await page.close();
  }
}
