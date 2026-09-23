/**
 * What happens in each app scene, timed by the scene's caption sentences (see record.ts):
 *   upload  — a private upload of the sample clip (free: FFmpeg only), then the Generate button;
 *   replay  — the automatic sample run's saved trace, replayed and shown sped up;
 *   review  — a line the reviewer rejected, Scene's rewrite from the reviewer's fix, and the final
 *             check's note on what Scene fixed by itself;
 *   result  — that line's measured fit, and playback;
 *   edit    — an editor typing a change into another line, WITHOUT submitting it: the optional path.
 * Camera shots and overlays are logged on the scene's clock as the page is driven.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { dictionary } from "../../src/i18n";
import { MOVE_SECONDS } from "./camera";
import { BASE_URL, CACHE_DIR, CLIP_FILE, PROJECT_ID, SAMPLE_RUN, VIEWPORT } from "./config";
import { film, GEMINI_NAME } from "./facts";
import {
  BeatClock,
  clickLike,
  glideTo,
  moveCursor,
  rectOf,
  scrollInspectorTo,
  toOutput,
  unionRect,
} from "./recorder-kit";
import { LISTEN, TIME_LABELS, type Beat } from "./storyboard";
import type { ScenePlan } from "./timing";

const t = dictionary("en");
/** Where the cursor rests when it should not cover anything. */
const REST = { x: 1000, y: 690 };
const UPLOAD_SQUEEZE_S = 1.8;
const UPLOAD_NAME = "Tears of Steel, opening.mp4";
/** The Generate button is small: the camera goes closer than it does for text. */
const GENERATE_ZOOM = 2.2;
/** The camera leaves the last detail this long before a scene ends. */
const PULL_BACK_S = 1.3;
/** The fit meter is a plain bar: it takes a closer zoom than text does. */
const FIT_ZOOM = 2.4;
/** The timeline is wide: a light push-in keeps all 65 seconds in the picture. */
const TIMELINE_ZOOM = 1.4;
const BOUND_ZOOM = 2.3;
/** Replay ends this long before the scene does, so its finished timeline is seen. */
const REPLAY_TAIL_S = 1.2;
/** The earliest the replay is pressed, after the scene has opened on the finished run. */
const REPLAY_PRESS_S = 0.2;
const REPLAY_TIMEOUT_MS = 90_000;
/** Inspector scrolls start this long before their sentence; the final check's page scroll earlier. */
const SCROLL_LEAD_S = 0.7;
const FINAL_SCROLL_LEAD_S = 0.9;
/** A spotlight ends, its fade included, this long before the page under it moves. */
const SPOTLIGHT_CLEAR_S = 0.1;
const STAGE_SERVICES: Record<string, string> = {
  [t.stages.hear]: "Speech-to-Text · Chirp 3",
  [t.stages.watch]: GEMINI_NAME,
  [t.stages.write]: GEMINI_NAME,
  [t.stages.review]: GEMINI_NAME,
  [t.stages.voice]: "Text-to-Speech · Chirp 3 HD",
  [t.stages.verify]: GEMINI_NAME,
  [t.stages.fix]: GEMINI_NAME,
  [t.stages.mix]: "FFmpeg on Cloud Run",
};

export type BeatScript = (page: Page, clock: BeatClock, plan: ScenePlan) => Promise<void>;

/**
 * What the recorder types into the edit scene's line: one word added ("steadily"), a change an editor
 * might make. Nothing typed is submitted.
 */
const EDIT_ADDED = "가만히 ";
const EDIT_BEFORE = "들여다본다.";

/** The sample clip under a readable name: the workspace titles an upload after its file. */
async function uploadCopy(): Promise<string> {
  const file = join(CACHE_DIR, UPLOAD_NAME);
  await mkdir(CACHE_DIR, { recursive: true });
  await copyFile(CLIP_FILE, file);
  return file;
}

const sampleUrl = (runId: string) => `${BASE_URL}/p/${PROJECT_ID}?run=${runId}`;

async function openRun(page: Page, runId: string): Promise<void> {
  await page.goto(sampleUrl(runId), { waitUntil: "networkidle" });
  await page.locator(".metrics").waitFor();
  await page.waitForFunction((id) => {
    const v = document.querySelector<HTMLVideoElement>("video");
    return !!v && v.currentSrc.includes(id) && v.readyState >= 2;
  }, runId);
}

/** The sample run with its timeline's foot at the bottom of the viewport, as the replay shows it. */
async function openReplayView(page: Page): Promise<void> {
  await openRun(page, SAMPLE_RUN);
  const bottom = await page
    .locator(".timeline")
    .evaluate((el) => el.getBoundingClientRect().bottom);
  await page.evaluate((y) => window.scrollTo({ top: y }), bottom + 24 - VIEWPORT.height);
  await page.waitForTimeout(300);
}

const replayButton = (page: Page) => page.getByRole("button", { name: t.workspace.replay });
const reviewRunning = (page: Page) =>
  page.locator(".stages li.running", { hasText: t.stages.review });

/**
 * Wall seconds from starting to press Replay until Review runs, measured on a replay before the scene
 * is recorded (the replay runs in the page and calls nothing).
 */
const replayTiming = { toReview: 0 };

/** How long a page's video may take to paint its first frame before the recording gives up. */
const VIDEO_FRAME_TIMEOUT_MS = 15_000;

/**
 * Seeks a video to where it already is (or to `to`) and waits until that frame is painted. A video
 * reloaded with its page can stay black until it is seeked (the landing hero once did for a whole
 * take), and a seek out of the poster paints black until the frame decodes.
 */
async function paintFrame(page: Page, selector: string, to?: number): Promise<void> {
  const video = page.locator(selector);
  await page.waitForFunction(
    (sel) => {
      const v = document.querySelector<HTMLVideoElement>(sel);
      return !!v && v.readyState >= 2;
    },
    selector,
    { timeout: VIDEO_FRAME_TIMEOUT_MS },
  );
  await video.evaluate(
    (v: HTMLVideoElement, at) =>
      new Promise<void>((done) => {
        // Two animation frames after 'seeked': the decoded frame has been composited.
        v.addEventListener(
          "seeked",
          () => requestAnimationFrame(() => requestAnimationFrame(() => done())),
          { once: true },
        );
        v.currentTime = at ?? v.currentTime;
      }),
    to,
  );
}

/** Selects a line without the cursor, before a scene starts. */
async function selectLine(page: Page, cueId: string): Promise<void> {
  await page.locator(`[data-cue-id="${cueId}"]`).first().click();
  await page.locator(".line-detail").waitFor();
  await page.evaluate(() => {
    document.querySelector(".ws-inspector")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  });
  await page.waitForTimeout(400);
}

const upload: BeatScript = async (page, clock, plan) => {
  clock.shot(null);
  await clock.at(0.3, "open the upload section");
  await clickLike(page, page.locator('a.button[href="#try-your-clip"]'));
  await page.waitForTimeout(900);
  const card = page.locator(".upload-card");
  const cardRect = await rectOf(card);
  clock.shot(cardRect, 1.5);
  const lit = clock.now() + 0.8;
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    clickLike(page, card.getByRole("button")),
  ]);
  await chooser.setFiles(await uploadCopy());
  let left = 0;
  // No label tail: it would sit over the new page's header while the camera pulls back.
  await clock.squeeze(
    [
      {
        by: clock.now() + UPLOAD_SQUEEZE_S,
        wait: async () => {
          await page.waitForURL("**/p/u-*", { timeout: 180_000, waitUntil: "commit" });
          left = Date.now() / 1000;
          await page.locator(".ws-main").waitFor();
          await page.waitForLoadState("networkidle");
        },
      },
    ],
    TIME_LABELS.upload,
    0,
  );
  // The card stays lit while it prepares the clip, and goes before the workspace replaces it.
  clock.overlay({
    kind: "spotlight",
    at: lit,
    until: toOutput(clock.rec, left) - SPOTLIGHT_CLEAR_S,
    rect: cardRect,
  });
  clock.shot(null);
  await moveCursor(page, REST.x, REST.y);
  // The one button the rest of the film follows from; not pressed (it would start a paid run).
  const [, s1] = plan.captionStarts;
  await clock.at(s1 - 0.3, "the Generate button");
  const generate = page.getByRole("button", { name: t.workspace.generate, exact: true }).first();
  const button = await rectOf(generate);
  clock.shot(button, GENERATE_ZOOM);
  clock.overlay({ kind: "spotlight", at: s1 + 0.4, until: plan.seconds - 0.2, rect: button });
  await clock.at(s1 + 0.5, "hover Generate");
  await glideTo(page, generate);
  await clock.at(plan.seconds, "end of upload");
};

const replay: BeatScript = async (page, clock, plan) => {
  // s1: the sentence that says "writes"; s2: "checks every line"; s3: "voiced and measured".
  const [s1, s2, s3] = plan.captionStarts;
  // The list stays in close-up through the reviewer's sentence; then the timeline, where the lines
  // fill in as they are voiced.
  const listEnd = s3 - SPOTLIGHT_CLEAR_S;
  clock.shot(null);
  // Pressed so that Write runs through the sentence that says "writes" (in Korean the verb ends it),
  // and Review starts with the one that says "checks".
  await clock.at(Math.max(REPLAY_PRESS_S, s2 - replayTiming.toReview), "start the replay");
  await clickLike(page, replayButton(page));
  await page.locator(".replay-badge").waitFor();
  await moveCursor(page, REST.x - 300, REST.y);
  // The stage list does not move during the replay: its box and rows are read now.
  const stages = await rectOf(page.locator(".stages"));
  clock.shot(stages, 1.8, s1);
  const timeline = await rectOf(page.locator(".timeline"));
  clock.shot(timeline, TIMELINE_ZOOM, s3);
  clock.overlay({ kind: "spotlight", at: s1 + 0.4, until: listEnd, rect: stages });
  clock.overlay({
    kind: "spotlight",
    at: s3 + 0.6,
    until: plan.seconds - PULL_BACK_S,
    rect: timeline,
  });
  clock.shot(null, undefined, plan.seconds - PULL_BACK_S);
  for (const row of await page.locator(".stages li").all()) {
    const service = STAGE_SERVICES[(await row.locator("span").first().innerText()).trim()];
    if (service)
      clock.overlay({
        kind: "chip",
        at: s1 + 0.7,
        until: listEnd,
        text: service,
        rect: await rectOf(row),
      });
  }
  // A trace too long to reach Review by s2 at replay speed is squeezed to reach it there.
  await clock.squeeze(
    [
      { by: s2, wait: () => reviewRunning(page).waitFor({ timeout: REPLAY_TIMEOUT_MS }) },
      {
        by: plan.seconds - REPLAY_TAIL_S,
        wait: () =>
          page.locator(".replay-badge").waitFor({ state: "detached", timeout: REPLAY_TIMEOUT_MS }),
      },
    ],
    () => TIME_LABELS.replay,
  );
  await clock.at(plan.seconds, "end of replay");
};

const review: BeatScript = async (page, clock, plan) => {
  const [s0, s1, s2, s3] = plan.captionStarts;
  clock.shot(null);
  await clock.at(0.2, "pick the line");
  await clickLike(page, page.locator(`[data-cue-id="${film.line.cueId}"]`).first());
  await page.locator(".line-detail").waitFor();
  await moveCursor(page, REST.x - 300, REST.y);
  // 1. The rejection: rule, quote, reason, guideline page.
  const draft = page.locator(".versions > li").first();
  await clock.at(s0 - SCROLL_LEAD_S, "the rejection");
  await scrollInspectorTo(page, draft, 60);
  const rejection = await rectOf(draft.locator(".verdict.fail li").first());
  clock.shot(rejection, 2);
  clock.overlay({
    kind: "spotlight",
    at: s0 + 0.5,
    until: s1 - SCROLL_LEAD_S - SPOTLIGHT_CLEAR_S,
    rect: rejection,
  });
  // 2. The reviewer's fix and the rewrite built from it, passed.
  await clock.at(s1 - SCROLL_LEAD_S, "the fix and the rewrite");
  const rewrite = page.locator(".versions > li").nth(1);
  await scrollInspectorTo(page, draft.locator(".fix"), 40);
  const fixed = unionRect([await rectOf(draft.locator(".fix")), await rectOf(rewrite)]);
  clock.shot(fixed, 1.8);
  clock.overlay({
    kind: "spotlight",
    at: s1 + 0.5,
    until: s2 - SCROLL_LEAD_S - SPOTLIGHT_CLEAR_S,
    rect: fixed,
  });
  // 3. How the line ended: one sentence on its history, and its measured fit.
  await clock.at(s2 - SCROLL_LEAD_S, "the line's verdict");
  await page.evaluate(() =>
    document.querySelector(".ws-inspector")?.scrollTo({ top: 0, behavior: "smooth" }),
  );
  await page.waitForTimeout(700);
  const verdict = unionRect([
    await rectOf(page.locator(".line-head")),
    await rectOf(page.locator(".verdict-chip")),
    await rectOf(page.locator(".fit")),
  ]);
  clock.shot(verdict, 2);
  clock.overlay({
    kind: "spotlight",
    at: s2 + 0.5,
    until: (s3 ?? plan.seconds) - FINAL_SCROLL_LEAD_S - SPOTLIGHT_CLEAR_S,
    rect: await rectOf(page.locator(".verdict-chip")),
  });
  // 4. The final check's note: what Scene fixed after it, by itself.
  if (s3 !== undefined) {
    await clock.at(s3 - FINAL_SCROLL_LEAD_S, "final check");
    const note = page.locator(".quality-note");
    await note.evaluate((el) => {
      const r = el.getBoundingClientRect();
      window.scrollTo({ top: window.scrollY + r.top - 380, behavior: "smooth" });
    });
    await page.waitForTimeout(800);
    const box = await rectOf(note);
    clock.shot(box, 1.8);
    clock.overlay({
      kind: "spotlight",
      at: clock.now() + 0.6,
      until: plan.seconds - PULL_BACK_S,
      rect: box,
    });
  }
  clock.shot(null, undefined, plan.seconds - PULL_BACK_S);
  await clock.at(plan.seconds, "end of review");
};

const result: BeatScript = async (page, clock, plan) => {
  const listenAt = plan.parts.find((p) => "pause" in p.part)!.start;
  const fit = await rectOf(page.locator(".fit"));
  clock.shot(unionRect([await rectOf(page.locator(".line-head")), fit]), 2);
  await clock.at(0.9, "fit meter");
  clock.shot(fit, FIT_ZOOM);
  clock.overlay({ kind: "spotlight", at: 1.3, until: listenAt - 0.9, rect: fit });
  await clock.at(listenAt - 0.9, "play from here");
  await clickLike(page, page.locator(".line-head").getByRole("button", { name: t.line.play }));
  clock.shot(
    unionRect([
      await rectOf(page.locator(".player-frame")),
      await rectOf(page.locator(".caption-strip")),
    ]),
    1.4,
  );
  await moveCursor(page, REST.x - 300, REST.y + 10);
  await page.waitForFunction(
    (to) => document.querySelector<HTMLVideoElement>("video")!.currentTime >= to,
    LISTEN.to,
    { timeout: 30_000, polling: 50 },
  );
  await page.locator("video").evaluate((v: HTMLVideoElement) => v.pause());
  await clock.at(plan.seconds, "end of result");
};

const edit: BeatScript = async (page, clock, plan) => {
  const [s0, s1] = plan.captionStarts;
  const summary = page.locator(".edit-line > summary");
  clock.shot(unionRect([await rectOf(page.locator(".line-head")), await rectOf(summary)]), 1.8);
  await clock.at(s0 + 0.5, "open the editor");
  await clickLike(page, summary);
  const form = page.locator(".cue-editor");
  await form.waitFor();
  await scrollInspectorTo(page, form, 40);
  clock.shot(await rectOf(form), 2);
  const box = form.locator("textarea");
  await clickLike(page, box);
  await box.press("End");
  const before = await box.inputValue();
  if (!before.endsWith(EDIT_BEFORE))
    throw new Error(`the edit scene's line does not end "${EDIT_BEFORE}"`);
  const typed = before.slice(0, -EDIT_BEFORE.length) + EDIT_ADDED + EDIT_BEFORE;
  for (let i = 0; i < EDIT_BEFORE.length; i++) await box.press("Backspace", { delay: 45 });
  await box.pressSequentially(EDIT_ADDED + EDIT_BEFORE, { delay: 110 });
  if ((await box.inputValue()) !== typed)
    throw new Error(`typed "${await box.inputValue()}", expected "${typed}"`);
  await clock.at(s1, "the start bound");
  const bound = unionRect([
    await rectOf(form.locator('input[name="start"]')),
    await rectOf(form.locator("p.mono")),
  ]);
  clock.shot(bound, BOUND_ZOOM);
  clock.overlay({ kind: "spotlight", at: s1 + 0.2, until: plan.seconds - 1.4, rect: bound });
  clock.shot(await rectOf(form), 2, plan.seconds - 1.4);
  await clock.at(plan.seconds - 1.3, "hover the submit button");
  // The edit is never submitted: it would start a paid re-voice. Editing is shown as the option it is.
  await glideTo(page, form.locator('button[type="submit"]'));
  await clock.at(plan.seconds, "end of edit");
};

export const SCRIPTS: Record<Beat, { before: (page: Page) => Promise<void>; run: BeatScript }> = {
  upload: {
    before: async (page) => {
      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await paintFrame(page, ".seven video");
    },
    run: upload,
  },
  replay: {
    before: async (page) => {
      await openReplayView(page);
      const pressed = Date.now() / 1000;
      await clickLike(page, replayButton(page));
      await reviewRunning(page).waitFor({ timeout: REPLAY_TIMEOUT_MS });
      replayTiming.toReview = Date.now() / 1000 - pressed;
      await openReplayView(page);
    },
    run: replay,
  },
  review: {
    // The line's frame is decoded before the scene picks the line, so the pick does not flash black.
    before: (page) => paintFrame(page, "video", film.line.start),
    run: review,
  },
  result: {
    before: async (page) => {
      await page.evaluate(() => window.scrollTo({ top: 0 }));
      await selectLine(page, film.line.cueId);
    },
    run: result,
  },
  edit: {
    before: async (page) => {
      await selectLine(page, film.hook.lines[1].id);
      await scrollInspectorTo(page, page.locator(".edit-line > summary"), 180);
      await moveCursor(page, REST.x - 300, REST.y);
    },
    run: edit,
  },
};
