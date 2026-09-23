/**
 * Fresh screenshots of the product, taken at device scale 2 from a running Scene server (the sample
 * project), so the deck shows the current UI sharply. Any request that could start a paid run or edit
 * is aborted. Run with `npm run deck -- --screens` while the dev server is up.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright-core";
import { SCREENS } from "./paths";

export const APP_URL = process.env.SCENE_APP_URL ?? "http://127.0.0.1:21960";
const SAMPLE = "/p/tos-opening";
export const DEVICE_SCALE = 2;
/** A laptop-sized window: the whole workspace (player, timeline, inspector) in one frame. */
export const WORKSPACE_VIEWPORT = { width: 1440, height: 900 };
const SETTLE_MS = 1500;
const PAID = /\/(runs|edits)(\/|$|\?)/;
/** The line the editor restored (cue L4), at 54.2 s. */
const LINE_CUE = "L4";
const LINE_AT = "54.2";
/** How much of a called-out element must show above the fold. */
const CALLOUT_VISIBLE_PX = 80;
/** The line's history holds the draft, the automatic rewrite and the editor's line. */
const HISTORY_VERSIONS = 3;
/** The rewrite's rejection (its fix is what the editor typed) is scrolled to this far below the top. */
const HISTORY_SCROLL_PAD = 0;
/** Space kept under the timeline where the workspace screenshot ends. */
const BELOW_TIMELINE_PX = 16;

/** Screenshot files the slides use. */
export const SCREEN_FILES = {
  workspace: "workspace-line5.png",
  eyesClosed: "player-eyes-closed.png",
} as const;
/** Where the callouts point, in CSS pixels of the workspace screenshot. */
const WORKSPACE_BOXES = "workspace-line5.json";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type WorkspaceBoxes = Record<"timeline" | "rejection" | "typed" | "eyesClosed", Box>;
export interface WorkspaceCapture {
  /** Local date of the capture, YYYY-MM-DD. */
  capturedAt: string;
  /** The inspector's heading for the selected line, as the app numbers it ("Line 4 · 54.2 s"). */
  lineHeading: string;
  boxes: WorkspaceBoxes;
}

/** Relative URL of a captured screenshot; stops the build when it has not been captured yet. */
export function screenUrl(key: keyof typeof SCREEN_FILES): string {
  const file = SCREEN_FILES[key];
  if (!existsSync(join(SCREENS, file)))
    throw new Error(`screenshot ${file} missing: run npm run deck -- --screens`);
  return `assets/screens/${file}`;
}

/** Pixel size of a captured screenshot, read from its PNG header. */
export function screenSize(key: keyof typeof SCREEN_FILES): { width: number; height: number } {
  const png = readFileSync(join(SCREENS, SCREEN_FILES[key]));
  if (png.toString("latin1", 12, 16) !== "IHDR")
    throw new Error(`${SCREEN_FILES[key]} is not a PNG`);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

export function workspaceCapture(): WorkspaceCapture {
  const file = join(SCREENS, WORKSPACE_BOXES);
  if (!existsSync(file))
    throw new Error(`${WORKSPACE_BOXES} missing: run npm run deck -- --screens`);
  return JSON.parse(readFileSync(file, "utf8")) as WorkspaceCapture;
}

async function openSample(browser: Browser): Promise<{ page: Page; blocked: string[] }> {
  const context = await browser.newContext({
    viewport: WORKSPACE_VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE,
    locale: "en-US",
  });
  const blocked: string[] = [];
  await context.route("**/*", (route) => {
    const req = route.request();
    if (req.method() !== "GET" && PAID.test(req.url())) {
      blocked.push(`${req.method()} ${req.url()}`);
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  await page.goto(`${APP_URL}${SAMPLE}`, { waitUntil: "networkidle" });
  await page.locator(".ws-inspector").waitFor({ timeout: 15_000 });
  // Korean narration, English page: the sample's final version, after its editor sessions.
  await page.locator(".ws-inspector").getByRole("button", { name: "한국어", exact: true }).click();
  await page.waitForTimeout(SETTLE_MS);
  return { page, blocked };
}

async function boxOf(page: Page, selector: string): Promise<Box> {
  const el = page.locator(selector).first();
  await el.waitFor({ timeout: 10_000 });
  const box = await el.boundingBox();
  if (!box) throw new Error(`${selector} has no box on the page`);
  return box;
}

/** Captures every file in SCREEN_FILES and the callout boxes. Returns notes for the check report. */
export async function captureScreens(browser: Browser): Promise<string[]> {
  mkdirSync(SCREENS, { recursive: true });
  const { page, blocked } = await openSample(browser);

  // The line the editor restored: its verdict, citation, measured fit and version history.
  await page.locator("main select").first().selectOption(LINE_CUE);
  await page.waitForTimeout(SETTLE_MS);
  const heading = await page.locator(".line-heading").first().innerText();
  if (!heading.includes(LINE_AT))
    throw new Error(`expected the ${LINE_AT} s line in the inspector, got "${heading}"`);
  await page.evaluate(() => window.scrollTo(0, 0));
  // Show the second rejection, whose suggested fix the editor typed, and the editor's version under it.
  const versions = page.locator(".ws-inspector .versions > li");
  if ((await versions.count()) !== HISTORY_VERSIONS)
    throw new Error(`expected ${HISTORY_VERSIONS} versions in the line's history`);
  if (!(await versions.nth(2).getAttribute("class"))?.includes("by-human"))
    throw new Error("the line's last version is not the editor's");
  await versions.nth(1).evaluate((el, pad) => {
    const panel = el.closest(".ws-inspector");
    if (!panel) throw new Error("version outside the inspector");
    panel.scrollTop +=
      el.getBoundingClientRect().top - panel.getBoundingClientRect().top - (pad as number);
  }, HISTORY_SCROLL_PAD);
  await page.waitForTimeout(SETTLE_MS);
  const boxes: WorkspaceBoxes = {
    timeline: await boxOf(page, ".timeline"),
    rejection: await boxOf(page, ".ws-inspector .versions > li:nth-child(2) .verdict.fail"),
    typed: await boxOf(page, ".ws-inspector .versions > li:nth-child(3)"),
    eyesClosed: await boxOf(page, ".player-controls button:has-text('Eyes closed')"),
  };
  // End the picture just under the timeline, so no half-shown control hangs off its bottom edge.
  const height = Math.ceil(boxes.timeline.y + boxes.timeline.height + BELOW_TIMELINE_PX);
  // Each box needs its top in the frame; a long rejection may push the editor's line past the edge.
  for (const [key, b] of Object.entries(boxes))
    if (b.y + Math.min(b.height, CALLOUT_VISIBLE_PX) > height)
      throw new Error(`${key} is below the bottom of the workspace screenshot`);
  await page.screenshot({
    path: join(SCREENS, SCREEN_FILES.workspace),
    clip: { x: 0, y: 0, width: WORKSPACE_VIEWPORT.width, height },
  });
  const capture: WorkspaceCapture = {
    capturedAt: new Date().toLocaleDateString("en-CA"),
    lineHeading: heading.replace(/\s+/g, " ").trim(),
    boxes,
  };
  writeFileSync(join(SCREENS, WORKSPACE_BOXES), JSON.stringify(capture, null, 1));

  // What eyes-closed listening looks like: the picture blacked out, the spoken line in its place.
  await page.locator(".player-controls button:has-text('Eyes closed')").click();
  await page.waitForTimeout(SETTLE_MS);
  const frame = await boxOf(page, ".player-frame");
  await page.screenshot({ path: join(SCREENS, SCREEN_FILES.eyesClosed), clip: frame });

  await page.context().close();
  if (blocked.length > 0)
    throw new Error(`paid requests were attempted and blocked: ${blocked.join(", ")}`);
  return [
    `screens: ${Object.keys(SCREEN_FILES).length} captured from ${APP_URL}${SAMPLE} at device scale ${DEVICE_SCALE} (${WORKSPACE_VIEWPORT.width}x${WORKSPACE_VIEWPORT.height} window, "${capture.lineHeading}" selected, its history scrolled to the rewrite's rejection and the editor's line)`,
  ];
}
