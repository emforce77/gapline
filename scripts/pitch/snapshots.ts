/**
 * Snapshots of the deployed prototype for the deck's "Snapshots of the prototype" page: the landing
 * page, and the workspace on the pinned English sample with the reviewer's example line open (its
 * rejected draft and the rewrite that passed). Taken from the live Cloud Run service by default, so
 * the deck shows what a judge opening the link sees. Read-only: every request other than GET or
 * HEAD is aborted, so nothing can start a paid run or an edit.
 *
 * Out: runtime/pitch/snapshots/{landing,workspace}.png (1440x900 CSS px at device scale 2) and
 * manifest.json (URL, run, time, and any aborted request).
 * Run: node --import tsx scripts/pitch/snapshots.ts   (PITCH_APP_URL overrides the service URL)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { UI_LANG_COOKIE } from "../../src/i18n";
import { pin, SAMPLE_LANGUAGE } from "../deck/data/runs";
import { line } from "../deck/data/sample";
import { SUBMISSION } from "../deck/facts";
import { REPO } from "../deck/paths";

const APP_URL = process.env.PITCH_APP_URL ?? SUBMISSION.demoUrl;
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const OUT = join(REPO, "runtime/pitch/snapshots");
const VIEWPORT = { width: 1440, height: 900 };
const DEVICE_SCALE = 2;
const SETTLE_MS = 1500;
const LOAD_TIMEOUT_MS = 30_000;
/** The reviewer's example has two versions: the draft sent back, then the rewrite that passed. */
const HISTORY_VERSIONS = 2;

async function main(): Promise<void> {
  if (!APP_URL) throw new Error("no service URL: set SUBMISSION.demoUrl or PITCH_APP_URL");
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const aborted: string[] = [];
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: DEVICE_SCALE,
      locale: "en-US",
    });
    await context.addCookies([{ name: UI_LANG_COOKIE, value: "en", url: APP_URL }]);
    await context.route("**/*", (route) => {
      const req = route.request();
      if (req.method() === "GET" || req.method() === "HEAD") return route.continue();
      aborted.push(`${req.method()} ${req.url()}`);
      return route.abort();
    });
    const page = await context.newPage();

    await page.goto(APP_URL, { waitUntil: "networkidle", timeout: LOAD_TIMEOUT_MS });
    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({ path: join(OUT, "landing.png") });

    const runId = pin.runs[SAMPLE_LANGUAGE];
    await page.goto(`${APP_URL}/p/${pin.projectId}?run=${runId}`, {
      waitUntil: "networkidle",
      timeout: LOAD_TIMEOUT_MS,
    });
    await page.locator(".ws-inspector").waitFor({ timeout: LOAD_TIMEOUT_MS });
    const shown = await page.locator(".run-panel .result-picker select").inputValue();
    if (shown !== runId) throw new Error(`the live workspace shows ${shown}, not ${runId}`);
    await page.locator("main select").first().selectOption(line.cueId);
    await page.waitForTimeout(SETTLE_MS);
    const versions = page.locator(".ws-inspector .versions > li");
    if ((await versions.count()) !== HISTORY_VERSIONS)
      throw new Error(`expected ${HISTORY_VERSIONS} versions in ${line.cueId}'s history`);
    if (
      (await versions.nth(0).locator(".verdict.fail").count()) !== 1 ||
      (await versions.nth(1).locator(".verdict.pass").count()) !== 1
    )
      throw new Error(`${line.cueId}'s history is not a rejected draft and a rewrite that passed`);
    // The app focuses the line's heading; its focus ring is not part of the picture.
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({ path: join(OUT, "workspace.png") });

    const manifest = {
      producedBy: "scripts/pitch/snapshots.ts",
      capturedAt: new Date().toISOString(),
      appUrl: APP_URL,
      runId,
      line: line.cueId,
      viewport: VIEWPORT,
      deviceScale: DEVICE_SCALE,
      aborted,
    };
    writeFileSync(join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 1)}\n`);
    process.stdout.write(`snapshots from ${APP_URL} (run ${runId}); aborted ${aborted.length}\n`);
  } finally {
    await browser.close();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
  process.exit(1);
});
