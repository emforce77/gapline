/**
 * Fresh screenshots of the product, taken at device scale 2 from a running Scene server on the pinned
 * sample run (runtime/showcase.json), so the deck shows the current UI sharply. The product slide
 * shows four crops of the workspace at 1:1 of the capture, so the app's own text stays legible: the
 * Generate button, the player's switches (Eyes closed), the timeline around the chosen line, and
 * the panel of the line the final check sent back (Line 5, 47.2 s). The Generate button is taken
 * last, on the Brief density, which has no track of the clip: there it reads "Generate", not
 * "Generate again" (the capture stops otherwise). The density button is only clicked; any request
 * that could start a paid run or an edit is aborted. Run with `npm run deck -- --screens` while the
 * dev server is up.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Locator, Page } from "playwright-core";
import { dictionary, UI_LANG_COOKIE } from "../../src/i18n";
import { pin } from "./data/runs";
import { line } from "./data/sample";
import { SCREENS } from "./paths";

export const APP_URL = process.env.SCENE_APP_URL ?? "http://127.0.0.1:21960";
/** The pinned run, opened directly: without `?run=` the page may pick another Korean run. */
const SAMPLE = `/p/${pin.projectId}?run=${pin.runs.ko}`;
export const DEVICE_SCALE = 2;
/** A laptop-sized window: the whole workspace (player, timeline, inspector) in one frame. */
export const WORKSPACE_VIEWPORT = { width: 1440, height: 900 };
const SETTLE_MS = 1500;
const PAID = /\/(runs|edits)(\/|$|\?)/;
/** The line's history: the draft the final check sent back, and Scene's rewrite that passed. */
const HISTORY_VERSIONS = 2;
/** Space kept around each crop, in CSS pixels, so no control touches the crop's edge. */
const CROP_PAD = 8;
/** The English interface's words the capture looks for (the page is opened in English). */
const UI = dictionary("en");

/** Screenshot files the slides use. */
export const SCREEN_FILES = {
  generate: "workspace-generate.png",
  controls: "workspace-controls.png",
  timeline: "workspace-timeline.png",
  line: "workspace-line.png",
} as const;
export type ScreenKey = keyof typeof SCREEN_FILES;
/** Crop sizes and callout boxes, in CSS pixels of each crop. */
const WORKSPACE_BOXES = "workspace.json";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** What the product slide's callouts ring: the button, the switch and the line's verdict. */
export type CalloutKey = "generate" | "eyesClosed" | "fixed";
export interface WorkspaceCapture {
  /** Local date of the capture, YYYY-MM-DD. */
  capturedAt: string;
  /** The run the workspace showed (checked against the pin at capture time). */
  runId: string;
  /** The inspector's heading for the selected line, as the app numbers it ("Line 5 · 0:47.2"). */
  lineHeading: string;
  /** Each crop's size in CSS pixels (its PNG is DEVICE_SCALE times larger). */
  crops: Record<ScreenKey, { width: number; height: number }>;
  callouts: Record<CalloutKey, { crop: ScreenKey; box: Box }>;
}

/** Relative URL of a captured screenshot; stops the build when it has not been captured yet. */
export function screenUrl(key: ScreenKey): string {
  const file = SCREEN_FILES[key];
  if (!existsSync(join(SCREENS, file)))
    throw new Error(`screenshot ${file} missing: run npm run deck -- --screens`);
  return `assets/screens/${file}`;
}

/** Pixel size of a captured screenshot, read from its PNG header. */
export function screenSize(key: ScreenKey): { width: number; height: number } {
  const png = readFileSync(join(SCREENS, SCREEN_FILES[key]));
  if (png.toString("latin1", 12, 16) !== "IHDR")
    throw new Error(`${SCREEN_FILES[key]} is not a PNG`);
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** The capture's boxes; stops the build when the screenshots show another run than the pin. */
export function workspaceCapture(): WorkspaceCapture {
  const file = join(SCREENS, WORKSPACE_BOXES);
  if (!existsSync(file))
    throw new Error(`${WORKSPACE_BOXES} missing: run npm run deck -- --screens`);
  const capture = JSON.parse(readFileSync(file, "utf8")) as WorkspaceCapture;
  if (capture.runId !== pin.runs.ko)
    throw new Error(`the screenshots show ${capture.runId}, not the pinned ${pin.runs.ko}`);
  return capture;
}

async function openSample(browser: Browser): Promise<{ page: Page; blocked: string[] }> {
  const context = await browser.newContext({
    viewport: WORKSPACE_VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE,
    locale: "en-US",
  });
  await context.addCookies([{ name: UI_LANG_COOKIE, value: "en", url: APP_URL }]);
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
  await page.waitForTimeout(SETTLE_MS);
  const shown = await page.locator(".run-panel .result-picker select").inputValue();
  if (shown !== pin.runs.ko) throw new Error(`the workspace shows ${shown}, not ${pin.runs.ko}`);
  return { page, blocked };
}

async function boxOf(el: Locator): Promise<Box> {
  await el.waitFor({ timeout: 10_000 });
  const box = await el.boundingBox();
  if (!box) throw new Error("an element to capture has no box on the page");
  return box;
}

/** The smallest box around all of `boxes`, with CROP_PAD on every side. */
function around(...boxes: Box[]): Box {
  const x = Math.min(...boxes.map((b) => b.x)) - CROP_PAD;
  const y = Math.min(...boxes.map((b) => b.y)) - CROP_PAD;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + CROP_PAD;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + CROP_PAD;
  return { x, y, width: right - x, height: bottom - y };
}

/** `box` in the coordinates of `crop`; stops when it is not wholly inside it. */
function inside(box: Box, crop: Box, name: string): Box {
  const rel = { x: box.x - crop.x, y: box.y - crop.y, width: box.width, height: box.height };
  if (rel.x < 0 || rel.y < 0 || rel.x + rel.width > crop.width || rel.y + rel.height > crop.height)
    throw new Error(`${name} is not inside its crop`);
  return rel;
}

/** Shoots one crop and returns its size for the capture file. */
async function shoot(page: Page, key: ScreenKey, clip: Box) {
  await page.screenshot({ path: join(SCREENS, SCREEN_FILES[key]), clip });
  return { width: clip.width, height: clip.height };
}

/** Captures every file in SCREEN_FILES and the callout boxes. Returns notes for the check report. */
export async function captureScreens(browser: Browser): Promise<string[]> {
  mkdirSync(SCREENS, { recursive: true });
  const { page, blocked } = await openSample(browser);
  const panel = page.locator(".ws-inspector");

  // 1. The line the final check sent back, chosen in the line picker under the timeline.
  await page.locator("main select").first().selectOption(line.cueId);
  await page.waitForTimeout(SETTLE_MS);
  const heading = (await page.locator(".line-heading").first().innerText())
    .replace(/\s+/g, " ")
    .trim();
  if (!heading.includes(String(line.start)))
    throw new Error(`expected the ${line.start} s line in the inspector, got "${heading}"`);
  const versions = panel.locator(".versions > li");
  if ((await versions.count()) !== HISTORY_VERSIONS)
    throw new Error(`expected ${HISTORY_VERSIONS} versions in the line's history`);
  if (
    (await versions.nth(0).locator(".verdict.fail").count()) !== 1 ||
    !(await versions.nth(1).getAttribute("class"))?.includes("by-revise") ||
    (await versions.nth(1).locator(".verdict.pass").count()) !== 1
  )
    throw new Error("the line's history is not a rejected draft and a rewrite that passed");
  // The app moves focus to the line's heading; its focus ring is not part of the picture.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.waitForTimeout(SETTLE_MS);

  // Its heading, its words and the one-sentence verdict on how it got there.
  const detail = panel.locator(".line-detail");
  const verdict = await boxOf(detail.locator(".verdict-chip"));
  const lineCrop = around(await boxOf(detail.locator(".line-head")), verdict);
  const fixed = inside(verdict, lineCrop, "the verdict");
  const lineSize = await shoot(page, "line", lineCrop);

  // 2. The player's two switches, and the timeline under them from the same left edge to its end.
  const controls = page.locator(".player-controls");
  const switches = controls.locator(".segmented");
  const left = (await boxOf(switches.first())).x - CROP_PAD;
  const controlsCrop = around(await boxOf(switches.first()), await boxOf(switches.last()));
  const eyesClosed = inside(
    await boxOf(controls.getByRole("button", { name: UI.workspace.eyesClosed, exact: true })),
    controlsCrop,
    "the Eyes closed button",
  );
  const controlsSize = await shoot(page, "controls", controlsCrop);
  const whole = around(await boxOf(page.locator(".timeline")));
  const timelineCrop = { ...whole, x: left, width: whole.x + whole.width - left };
  inside(
    await boxOf(page.locator(".tl-narration .cue.selected")),
    timelineCrop,
    "the chosen line on the timeline",
  );
  const timelineSize = await shoot(page, "timeline", timelineCrop);

  // 3. Last, the Generate button as a first press meets it: back from the line to the run panel, then
  // the Brief density, which has no track of this clip, so the button reads "Generate". Only these
  // two buttons are clicked; neither sends a request.
  await panel.getByRole("button", { name: UI.line.close }).click();
  await panel
    .locator(".run-options")
    .getByRole("button", { name: UI.workspace.densityBrief, exact: true })
    .click();
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    (document.activeElement as HTMLElement | null)?.blur();
  });
  await page.waitForTimeout(SETTLE_MS);
  // The run panel's last action is the one that starts a run; it must read exactly "Generate".
  const label = (await panel.locator(".run-actions button").last().innerText()).trim();
  if (label !== UI.workspace.generate)
    throw new Error(`the run panel's button reads "${label}", not "${UI.workspace.generate}"`);
  const button = await boxOf(
    panel.getByRole("button", { name: UI.workspace.generate, exact: true }),
  );
  const generateCrop = around(button);
  const generate = inside(button, generateCrop, "the Generate button");
  const generateSize = await shoot(page, "generate", generateCrop);

  const capture: WorkspaceCapture = {
    capturedAt: new Date().toLocaleDateString("en-CA"),
    runId: pin.runs.ko,
    lineHeading: heading,
    crops: {
      generate: generateSize,
      controls: controlsSize,
      timeline: timelineSize,
      line: lineSize,
    },
    callouts: {
      generate: { crop: "generate", box: generate },
      eyesClosed: { crop: "controls", box: eyesClosed },
      fixed: { crop: "line", box: fixed },
    },
  };
  writeFileSync(join(SCREENS, WORKSPACE_BOXES), JSON.stringify(capture, null, 1));

  await page.context().close();
  if (blocked.length > 0)
    throw new Error(`paid requests were attempted and blocked: ${blocked.join(", ")}`);
  return [
    `screens: ${Object.keys(SCREEN_FILES).length} crops captured from ${APP_URL}${SAMPLE} at device scale ${DEVICE_SCALE} (${WORKSPACE_VIEWPORT.width}x${WORKSPACE_VIEWPORT.height} window, "${capture.lineHeading}" selected)`,
  ];
}
