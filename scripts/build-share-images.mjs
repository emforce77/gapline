/**
 * Builds the images other apps show for Gapline, from what the app itself draws:
 *
 * - src/app/apple-icon.png (180×180): src/app/icon.svg full-bleed, since iOS rounds the corners itself
 *   and turns transparency black.
 * - public/favicon.ico (16, 32 and 48 px PNGs): for crawlers and bookmark services that ask for
 *   /favicon.ico. It lives in public/ so Next does not add a second icon link next to icon.svg.
 * - src/app/opengraph-image.png (1200×630): the card a shared link unfurls into. It is drawn for that
 *   size, not cut from the landing page: a chat app shows it 340–500 px wide, where the landing's
 *   buttons, timecodes and body text shrank to 3–6 px (QA round 3). The card keeps what still reads
 *   there: the wordmark, the headline, one line of what Gapline is, and the icon's mark (dialogue,
 *   narration in the silence, dialogue) as a lane. Its words come from the English catalog and its
 *   colours from src/styles/tokens.css. Every page uses it, so a card never shows a private upload.
 *
 * Needs no server. Run from the repository root:
 *   node --import tsx scripts/build-share-images.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { en } from "../src/i18n/en.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const CHROME = join(process.env.HOME, ".cache/ms-playwright/chromium-1228/chrome-linux64/chrome");
const FAVICON_SIZES = [16, 32, 48];
const OG = { width: 1200, height: 630 };
const PRETENDARD = "node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2";
/**
 * The lane under the words, left to right: [kind, share of the width]. Grey dialogue with amber
 * narration only in the silences between, as in icon.svg; a picture of the idea, not of a clip.
 */
const LANE = [
  ["dialogue", 0.13],
  ["silence", 0.02],
  ["narration", 0.1],
  ["silence", 0.03],
  ["dialogue", 0.2],
  ["silence", 0.02],
  ["narration", 0.14],
  ["silence", 0.02],
  ["dialogue", 0.09],
  ["silence", 0.02],
  ["narration", 0.07],
  ["silence", 0.03],
  ["dialogue", 0.13],
];

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

const escapeHtml = (text) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** The share card as a page of its own, at exactly 1200×630. */
async function shareCardHtml() {
  const tokens = await readFile(join(ROOT, "src/styles/tokens.css"), "utf8");
  const font = (await readFile(join(ROOT, PRETENDARD))).toString("base64");
  const lane = LANE.map(
    ([kind, share]) => `<span class="${kind}" style="flex-grow:${share}"></span>`,
  ).join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><style>
@font-face {
  font-family: "Pretendard Variable";
  font-weight: 45 920;
  src: url(data:font/woff2;base64,${font}) format("woff2");
}
${tokens}
html, body { width: ${OG.width}px; height: ${OG.height}px; overflow: hidden; }
.card {
  box-sizing: border-box;
  width: ${OG.width}px;
  height: ${OG.height}px;
  padding: 72px 88px 80px;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}
.wordmark {
  margin: 0;
  font-size: 44px;
  line-height: 1;
  font-weight: 800;
  letter-spacing: -0.02em;
  color: var(--text-strong);
}
.wordmark::after {
  content: "";
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-left: 6px;
  border-radius: 50%;
  background: var(--accent);
}
h1 {
  margin: auto 0 0;
  max-width: 980px;
  font-size: 88px;
  line-height: 1.06;
  font-weight: 750;
  letter-spacing: -0.03em;
  color: var(--text-strong);
}
.value {
  margin: 28px 0 0;
  font-size: 36px;
  line-height: 1.3;
  font-weight: 500;
  color: var(--text);
}
.lane {
  display: flex;
  gap: 0;
  height: 22px;
  margin-top: 56px;
}
.lane span { border-radius: 6px; }
.lane .dialogue { background: var(--dialogue); }
.lane .narration { background: var(--accent); }
</style></head>
<body><main class="card">
  <p class="wordmark">${escapeHtml(en.nav.home)}</p>
  <h1>${escapeHtml(en.landing.title)}</h1>
  <p class="value">${escapeHtml(en.landing.eyebrow)}</p>
  <div class="lane" aria-hidden="true">${lane}</div>
</main></body></html>`;
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

  const card = await browser.newPage({ viewport: OG, deviceScaleFactor: 1 });
  await card.setContent(await shareCardHtml(), { waitUntil: "load" });
  await card.evaluate(() => document.fonts.ready);
  const loaded = await card.evaluate(() =>
    [...document.fonts].some((f) => f.family.includes("Pretendard") && f.status === "loaded"),
  );
  if (!loaded) throw new Error("Pretendard did not load, so the card would use a system font");
  await card.screenshot({ path: join(ROOT, "src/app/opengraph-image.png") });
  console.log("wrote src/app/apple-icon.png, public/favicon.ico, src/app/opengraph-image.png");
} finally {
  await browser.close();
}
