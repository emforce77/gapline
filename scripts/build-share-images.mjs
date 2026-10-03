/**
 * Builds the images other apps show for Gapline, from what the app itself draws:
 *
 * - src/app/apple-icon.png (180×180): src/app/icon.svg full-bleed, since iOS rounds the corners itself
 *   and turns transparency black.
 * - public/favicon.ico (16, 32 and 48 px PNGs): for crawlers and bookmark services that ask for
 *   /favicon.ico. It lives in public/ so Next does not add a second icon link next to icon.svg.
 * - src/app/opengraph-image.png (1200×630): the top of the English landing page, the card a shared
 *   link unfurls into. Every page uses it, so a card never shows a private upload.
 *
 * Run against a server that shows the sample (`npm run dev`, or `npm start` after a build):
 *   node scripts/build-share-images.mjs http://127.0.0.1:21960
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const ROOT = new URL("..", import.meta.url).pathname;
const BASE = process.argv[2];
if (!BASE) throw new Error("Pass the base URL of a running Gapline server");
const CHROME = join(process.env.HOME, ".cache/ms-playwright/chromium-1228/chrome-linux64/chrome");
const FAVICON_SIZES = [16, 32, 48];
const OG = { width: 1200, height: 630 };
/** The landing is laid out at this width and scaled down, so the whole hero fits the card. */
const OG_SCALE = 0.8;

/** One PNG of the SVG at `size` px; `square` drops the rounded corners. */
async function renderIcon(page, svg, size, square) {
  const drawn = square
    ? svg.replace(/<rect width="64" height="64" rx="14"/, '<rect width="64" height="64"')
    : svg;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${drawn}`,
  );
  return page.screenshot({ omitBackground: !square, type: "png" });
}

/** An .ico that holds PNGs (Windows Vista and later, and every browser, read these). */
function icoFromPngs(pngs) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = 6 + 16 * pngs.length;
  const entries = pngs.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size % 256, 0);
    entry.writeUInt8(size % 256, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

const browser = await chromium.launch({ executablePath: CHROME });
try {
  const svg = await readFile(join(ROOT, "src/app/icon.svg"), "utf8");
  const icons = await browser.newPage();
  await writeFile(join(ROOT, "src/app/apple-icon.png"), await renderIcon(icons, svg, 180, true));
  const pngs = [];
  for (const size of FAVICON_SIZES)
    pngs.push({ size, data: await renderIcon(icons, svg, size, false) });
  await writeFile(join(ROOT, "public/favicon.ico"), icoFromPngs(pngs));

  const context = await browser.newContext({
    viewport: { width: OG.width / OG_SCALE, height: Math.ceil(OG.height / OG_SCALE) },
    deviceScaleFactor: OG_SCALE,
  });
  await context.addCookies([{ name: "scene_lang", value: "en", url: BASE }]);
  const landing = await context.newPage();
  await landing.goto(BASE, { waitUntil: "networkidle" });
  await landing.evaluate(() => document.fonts.ready);
  await landing.screenshot({
    path: join(ROOT, "src/app/opengraph-image.png"),
    clip: { x: 0, y: 0, width: OG.width / OG_SCALE, height: OG.height / OG_SCALE },
  });
  console.log("wrote src/app/apple-icon.png, public/favicon.ico, src/app/opengraph-image.png");
} finally {
  await browser.close();
}
