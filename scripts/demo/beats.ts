/**
 * What happens in each app scene, timed by the scene's sentences (see record.ts for the recording):
 *   upload  — a private upload of the sample clip (free: FFmpeg only);
 *   replay  — the pinned automatic run's saved trace, replayed and shown sped up;
 *   review  — the line the reviewer rejected twice, and the final check that flagged it;
 *   edit    — the editor typing the reviewer's fix into that line, WITHOUT submitting it;
 *   result  — the already recorded result of that same edit, its measured fit, and playback.
 * Camera shots and overlays are logged on the scene's clock as the page is driven.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { dictionary } from "../../src/i18n";
import { MOVE_SECONDS } from "./camera";
import {
  BASE_URL,
  CACHE_DIR,
  CLIP_FILE,
  EDIT_CHILD_RUN,
  EDIT_PARENT_RUN,
  ORIGINAL_RUN,
  PROJECT_ID,
  VIEWPORT,
} from "./config";
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
import type { ScenePlan } from "./voice";

const t = dictionary("en");
/** Where the cursor rests when it should not cover anything. */
const REST = { x: 1000, y: 690 };
const UPLOAD_SQUEEZE_S = 1.8;
const UPLOAD_NAME = "Tears of Steel, opening.mp4";
/** The camera leaves the last detail this long before a scene ends. */
const PULL_BACK_S = 1.3;
/** The fit meter is a plain bar: it takes a closer zoom than text does. */
const FIT_ZOOM = 2.4;
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
  [t.stages.mix]: "FFmpeg on Cloud Run",
};

export type BeatScript = (page: Page, clock: BeatClock, plan: ScenePlan) => Promise<void>;

/** The reviewer's suggested fix on the rewrite: what the editor types. */
const FIX = ".versions .verdict.fail .fix >> nth=-1";

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

/** The pinned run with its timeline's foot at the bottom of the viewport, as the replay shows it. */
async function openReplayView(page: Page): Promise<void> {
  await openRun(page, ORIGINAL_RUN);
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

/** Selects Line 5 (cue L4) without the cursor, before a scene starts. */
async function selectLine(page: Page): Promise<void> {
  await page.locator(`[data-cue-id="${film.line.cueId}"]`).first().click();
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
  await clock.at(plan.seconds, "end of upload");
};

const replay: BeatScript = async (page, clock, plan) => {
  const [, s1, s2] = plan.sentenceStarts;
  // The list stays in close-up through Review's sentence ("checks every line").
  const listEnd = plan.seconds - PULL_BACK_S;
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
  clock.shot(null, undefined, listEnd);
  clock.overlay({ kind: "spotlight", at: s1 + 0.4, until: listEnd, rect: stages });
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
  const [s0, s1, s2, s3] = plan.sentenceStarts;
  clock.shot(null);
  await clock.at(0.2, "pick line 5");
  await clickLike(page, page.locator(`[data-cue-id="${film.line.cueId}"]`).first());
  await page.locator(".line-detail").waitFor();
  await clock.at(s0 - 0.6, "line 5 verdict");
  const head = unionRect([
    await rectOf(page.locator(".line-head")),
    await rectOf(page.locator(".verdict-chip")),
  ]);
  clock.shot(head, 2);
  // Each spotlight is gone before the inspector scrolls the next rejection under it.
  clock.overlay({
    kind: "spotlight",
    at: s0 + 0.7,
    until: s1 - SCROLL_LEAD_S - SPOTLIGHT_CLEAR_S,
    rect: await rectOf(page.locator(".verdict-chip")),
  });
  await moveCursor(page, REST.x - 300, REST.y);
  const rejections = page.locator(".versions .verdict.fail");
  for (const [k, at] of [
    [0, s1],
    [1, s2],
  ] as const) {
    await clock.at(at - SCROLL_LEAD_S, `rejection ${k + 1}`);
    await scrollInspectorTo(page, rejections.nth(k), 60);
    const card = await rectOf(rejections.nth(k).locator("li").first());
    clock.shot(card, 2);
    const moves = k ? s3 - FINAL_SCROLL_LEAD_S : s2 - SCROLL_LEAD_S;
    clock.overlay({
      kind: "spotlight",
      at: clock.now() + 0.7,
      until: moves - SPOTLIGHT_CLEAR_S,
      rect: card,
    });
  }
  await clock.at(s3 - FINAL_SCROLL_LEAD_S, "final check");
  const flagged = page.locator(".quality-note li").filter({ hasText: /0:54\.2/ });
  await flagged.evaluate((el) => {
    const r = el.getBoundingClientRect();
    window.scrollTo({ top: window.scrollY + r.top - 420, behavior: "smooth" });
  });
  await page.waitForTimeout(800);
  const item = await rectOf(flagged);
  clock.shot(unionRect([item, await rectOf(page.locator(".quality-note strong"))]), 1.8);
  clock.overlay({
    kind: "spotlight",
    at: clock.now() + 0.7,
    until: plan.seconds - PULL_BACK_S,
    rect: item,
  });
  clock.shot(null, undefined, plan.seconds - PULL_BACK_S);
  await clock.at(plan.seconds, "end of review");
};

const edit: BeatScript = async (page, clock, plan) => {
  const [s0, s1] = plan.sentenceStarts;
  const fixRect = await rectOf(page.locator(FIX));
  clock.shot(unionRect([fixRect, await rectOf(page.locator(".edit-line > summary"))]), 1.8);
  clock.overlay({ kind: "spotlight", at: 0.7, until: s0 + 1.1, rect: fixRect });
  await clock.at(s0 + 0.6, "open the editor");
  await clickLike(page, page.locator(".edit-line > summary"));
  const form = page.locator(".cue-editor");
  await form.waitFor();
  await scrollInspectorTo(page, form, 40);
  clock.shot(await rectOf(form), 2);
  const box = form.locator("textarea");
  await clickLike(page, box);
  await box.press("End");
  const before = await box.inputValue();
  const target = film.line.typed;
  let same = 0;
  while (same < before.length && before[same] === target[same]) same++;
  for (let i = same; i < before.length; i++) await box.press("Backspace", { delay: 60 });
  await box.pressSequentially(target.slice(same), { delay: 110 });
  if ((await box.inputValue()) !== target)
    throw new Error(`typed "${await box.inputValue()}", expected "${target}"`);
  await clock.at(s1, "the start bound");
  const bound = unionRect([
    await rectOf(form.locator('input[name="start"]')),
    await rectOf(form.locator("p.mono")),
  ]);
  clock.shot(bound, BOUND_ZOOM);
  clock.overlay({ kind: "spotlight", at: s1 + 0.2, until: plan.seconds - 1.4, rect: bound });
  clock.shot(await rectOf(form), 2, plan.seconds - 1.4);
  await clock.at(plan.seconds - 1.3, "hover the submit button");
  // The edit is never submitted: the result shown next is the one recorded when it was.
  await glideTo(page, form.locator('button[type="submit"]'));
  await clock.at(plan.seconds, "end of edit");
};

const result: BeatScript = async (page, clock, plan) => {
  const [, s1] = plan.sentenceStarts;
  const listenAt = plan.parts.find((p) => "pause" in p.part)!.start;
  const top = unionRect([
    await rectOf(page.locator(".line-head")),
    await rectOf(page.locator(".fit")),
  ]);
  clock.shot(top, 2);
  // The label waits for the pull-in: on the wide first frames it would sit over the app header.
  clock.overlay({
    kind: "tag",
    at: clock.now() + MOVE_SECONDS,
    until: s1,
    text: TIME_LABELS.result,
  });
  clock.overlay({
    kind: "spotlight",
    at: 0.8,
    until: s1,
    rect: await rectOf(page.locator(".verdict-chip")),
  });
  await clock.at(s1, "fit meter");
  const fit = await rectOf(page.locator(".fit"));
  clock.shot(fit, FIT_ZOOM);
  clock.overlay({ kind: "spotlight", at: s1 + 0.3, until: listenAt - 0.9, rect: fit });
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
    // Line 5's frame is decoded before the scene picks the line, so the pick does not flash black.
    before: (page) => paintFrame(page, "video", film.line.start),
    run: review,
  },
  edit: {
    before: async (page) => {
      await openRun(page, EDIT_PARENT_RUN);
      await selectLine(page);
      await scrollInspectorTo(page, page.locator(FIX), 140);
      // The new page draws the cursor at its default spot, which the close-up puts on the fix.
      await moveCursor(page, REST.x - 300, REST.y);
    },
    run: edit,
  },
  result: {
    before: async (page) => {
      await openRun(page, EDIT_CHILD_RUN);
      await selectLine(page);
    },
    run: result,
  },
};
