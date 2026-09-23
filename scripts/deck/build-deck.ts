/**
 * Builds the pitch deck from Scene's run records:
 *   npm run deck                  html, one PNG per slide, the PDF, a contact sheet and a check note
 *   npm run deck -- --stills      cut the film stills again from the 1080p master
 *   npm run deck -- --screens     take fresh product screenshots from a running Scene (SCENE_APP_URL)
 *   npm run deck -- --final       also refuse a deck that still lacks a submission link or still names
 *                                 the development route to Gemini (see openItems)
 * Output: runtime/deck/. The build stops on any failed check instead of writing a doubtful deck.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GEMINI_ACCESS_LABEL } from "../../src/lib/models";
import { checkDeck } from "./checks";
import { writeCheckNote } from "./check-note";
import { ensureStills } from "./film";
import {
  CONTACT_SHEET,
  DECK_HTML,
  DECK_PDF,
  FONTS_OUT,
  OUT,
  OUT_SLIDES,
  PRETENDARD_STATIC,
  REPO,
  VENDORED_FONTS,
} from "./paths";
import { SUBMISSION } from "./facts";
import { allNotes } from "./notes";
import { captureScreens } from "./screens";
import { renderSpectrograms } from "./spectrogram";
import { buildSlides, DECK_CSS } from "./slides/index";
import { STILL_SPECS } from "./stills";
import { BASE_CSS, FONT_FILES, H, W } from "./theme";

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const CONTACT_COLUMNS = 3;
const CONTACT_SCALE = 0.25;
const require = createRequire(join(REPO, "package.json"));
const { chromium } = require("playwright-core") as typeof import("playwright-core");

/** What must change before the deck is submitted; `--final` turns each into a build failure. */
function openItems(): string[] {
  const items: string[] = [];
  if (/openrouter/i.test(GEMINI_ACCESS_LABEL))
    items.push(`GEMINI_ACCESS_LABEL (src/lib/models.ts) still reads "${GEMINI_ACCESS_LABEL}"`);
  if (!SUBMISSION.repoUrl)
    items.push("no public GitHub URL: set SUBMISSION.repoUrl in scripts/deck/facts.ts");
  if (!SUBMISSION.videoUrl)
    items.push("no video link: set SUBMISSION.videoUrl in scripts/deck/facts.ts");
  if (!SUBMISSION.team) items.push("no team name: set SUBMISSION.team in scripts/deck/facts.ts");
  return items;
}

const envFile = join(REPO, ".env.local");
if (existsSync(envFile)) process.loadEnvFile(envFile);

function copyFonts(): void {
  mkdirSync(FONTS_OUT, { recursive: true });
  for (const f of FONT_FILES.vendored) copyFileSync(join(VENDORED_FONTS, f), join(FONTS_OUT, f));
  for (const f of FONT_FILES.pretendard)
    copyFileSync(join(PRETENDARD_STATIC, f), join(FONTS_OUT, f));
}

function writeHtml(slides: string[]): void {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Scene — AI Builder Cup 2026</title>
<style>${BASE_CSS}\n${DECK_CSS}</style></head>
<body>${slides.join("\n")}</body></html>`;
  writeFileSync(DECK_HTML, html);
}

/**
 * pdffonts must list every face as embedded and none as Type 3; pdftotext must return every Korean
 * line the deck prints (compared without whitespace, since the PDF breaks lines where the slide does).
 */
function checkPdf(korean: string[]): { fonts: string[]; problems: string[] } {
  const listing = spawnSync("pdffonts", [DECK_PDF], { encoding: "utf8" });
  if (listing.status !== 0) throw new Error(`pdffonts failed: ${listing.stderr}`);
  const rows = listing.stdout.trim().split("\n").slice(2);
  const problems: string[] = [];
  for (const row of rows) {
    const flags = row.match(/\s(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/);
    if (!flags) throw new Error(`unreadable pdffonts row: ${row}`);
    if (/Type 3/.test(row)) problems.push(`Type 3 font in PDF: ${row.trim()}`);
    if (flags[1] !== "yes") problems.push(`font not embedded: ${row.trim()}`);
  }
  // -raw keeps the content-stream order, so text beside a wrapped line cannot land inside it.
  const text = spawnSync("pdftotext", ["-raw", DECK_PDF, "-"], { encoding: "utf8" });
  if (text.status !== 0) throw new Error(`pdftotext failed: ${text.stderr}`);
  const squeeze = (t: string) => t.replace(/\s+/g, "");
  const extracted = squeeze(text.stdout);
  if (korean.length === 0) problems.push("the deck prints no Korean text to check in the PDF");
  for (const line of korean)
    if (!extracted.includes(squeeze(line)))
      problems.push(`pdftotext does not return the Korean line "${line}"`);
  return { fonts: rows.map((r) => r.trim().replace(/\s+/g, " ")), problems };
}

async function buildContactSheet(
  browser: import("playwright-core").Browser,
  files: string[],
): Promise<void> {
  const cell = { w: W * CONTACT_SCALE, h: H * CONTACT_SCALE };
  const page = await browser.newPage({
    viewport: { width: cell.w * CONTACT_COLUMNS + 16 * (CONTACT_COLUMNS + 1), height: 400 },
  });
  const imgs = files
    .map((f) => `<img src="${pathToFileURL(f).href}" width="${cell.w}" height="${cell.h}">`)
    .join("");
  const sheet = join(OUT, "contact-sheet.html");
  writeFileSync(
    sheet,
    `<body style="margin:0;background:#1c1d20;display:grid;grid-template-columns:repeat(${CONTACT_COLUMNS},${cell.w}px);gap:16px;padding:16px">${imgs}</body>`,
  );
  await page.goto(pathToFileURL(sheet).href);
  await page.waitForLoadState("load");
  await page.screenshot({ path: CONTACT_SHEET, fullPage: true });
  await page.close();
  rmSync(sheet);
}

async function main(): Promise<void> {
  const notes: string[] = [];
  const open = openItems();
  if (process.argv.includes("--final") && open.length > 0)
    throw new Error(`not ready for submission:\n  ${open.join("\n  ")}`);
  notes.push(...(await ensureStills(STILL_SPECS, process.argv.includes("--stills"))));
  notes.push(...(await renderSpectrograms()));
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  try {
    if (process.argv.includes("--screens")) notes.push(...(await captureScreens(browser)));

    copyFonts();
    const slides = buildSlides();
    writeHtml(slides);

    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    // tsx keeps function names with an __name() helper; code sent into the page needs it too.
    await page.addInitScript({ content: "window.__name = (fn) => fn;" });
    const remote: string[] = [];
    await page.route("**/*", (route) => {
      if (route.request().url().startsWith("file:")) return route.continue();
      remote.push(route.request().url());
      return route.abort();
    });
    const consoleErrors: string[] = [];
    page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    await page.goto(pathToFileURL(DECK_HTML).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    // Errors while the deck loads count; the DevTools CSS domain used by the checks logs its own.
    const loadErrors = [...consoleErrors];
    const report = await checkDeck(page);
    report.problems.push(
      ...remote.map((u) => `remote request: ${u}`),
      ...loadErrors.map((e) => `console: ${e}`),
    );

    rmSync(OUT_SLIDES, { recursive: true, force: true });
    mkdirSync(OUT_SLIDES, { recursive: true });
    const names = await page.$$eval(".slide", (els) =>
      els.map((e) => (e as HTMLElement).dataset.name ?? ""),
    );
    const korean = await page.$$eval("[lang=ko]", (els) =>
      els.map((e) => (e.textContent ?? "").trim()).filter((t) => t !== ""),
    );
    const pngs = names.map((n, i) =>
      join(OUT_SLIDES, `${String(i + 1).padStart(2, "0")}-${n}.png`),
    );
    for (const [i, file] of pngs.entries())
      await page.locator(".slide").nth(i).screenshot({ path: file });
    await page.pdf({
      path: DECK_PDF,
      width: `${W}px`,
      height: `${H}px`,
      printBackground: true,
      displayHeaderFooter: false,
    });
    await page.close();
    await buildContactSheet(browser, pngs);

    const pdf = checkPdf(korean);
    report.problems.push(...pdf.problems);
    writeCheckNote({
      notes,
      painted: report.painted,
      pdfFonts: pdf.fonts,
      problems: report.problems,
      slides: names,
      words: report.words,
      endnotes: allNotes().length,
      open,
    });
    console.log([...notes, ...report.painted, ...pdf.fonts].join("\n"));
    console.log(`wrote ${pngs.length} slides, ${DECK_PDF}, ${CONTACT_SHEET} (all under ${OUT})`);
    if (open.length > 0) console.log(`open before submission:\n  ${open.join("\n  ")}`);
    if (report.problems.length > 0)
      throw new Error(`deck checks failed:\n  ${report.problems.join("\n  ")}`);
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
