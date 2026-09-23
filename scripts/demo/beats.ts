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
  clock.overlay({
    kind: "spotlight",
    at: clock.now() + 0.8,
    until: plan.seconds - 2.6,
    rect: cardRect,
  });
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    clickLike(page, card.getByRole("button")),
  ]);
  await chooser.setFiles(await uploadCopy());
  await clock.squeeze(UPLOAD_SQUEEZE_S, TIME_LABELS.upload, async () => {
    await page.waitForURL("**/p/u-*", { timeout: 180_000 });
    await page.locator(".ws-main").waitFor();
    await page.waitForLoadState("networkidle");
  });
  clock.shot(null);
  await moveCursor(page, REST.x, REST.y);
  await clock.at(plan.seconds, "end of upload");
};

const replay: BeatScript = async (page, clock, plan) => {
  const [, , s2] = plan.sentenceStarts;
  const s1 = plan.sentenceStarts[1];
  clock.shot(null);
  await clock.at(0.2, "start the replay");
  await clickLike(page, page.getByRole("button", { name: t.workspace.replay }));
  await page.locator(".replay-badge").waitFor();
  await moveCursor(page, REST.x - 300, REST.y);
  // The stage list does not move during the replay: its box and rows are read now.
  const stages = await rectOf(page.locator(".stages"));
  clock.shot(stages, 1.8, s1);
  clock.shot(null, undefined, s2);
  clock.overlay({ kind: "spotlight", at: s1 + 0.4, until: s2, rect: stages });
  for (const row of await page.locator(".stages li").all()) {
    const service = STAGE_SERVICES[(await row.locator("span").first().innerText()).trim()];
    if (service)
      clock.overlay({
        kind: "chip",
        at: s1 + 0.7,
        until: s2,
        text: service,
        rect: await rectOf(row),
      });
  }
  await clock.squeeze(
    plan.seconds - clock.now() - REPLAY_TAIL_S,
    () => TIME_LABELS.replay,
    () => page.locator(".replay-badge").waitFor({ state: "detached", timeout: 90_000 }),
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
  clock.overlay({
    kind: "spotlight",
    at: s0 + 0.7,
    until: s1,
    rect: await rectOf(page.locator(".verdict-chip")),
  });
  await moveCursor(page, REST.x - 300, REST.y);
  const rejections = page.locator(".versions .verdict.fail");
  for (const [k, at] of [
    [0, s1],
    [1, s2],
  ] as const) {
    await clock.at(at - 0.7, `rejection ${k + 1}`);
    await scrollInspectorTo(page, rejections.nth(k), 60);
    const card = await rectOf(rejections.nth(k).locator("li").first());
    clock.shot(card, 2);
    clock.overlay({ kind: "spotlight", at: clock.now() + 0.7, until: k ? s3 : s2, rect: card });
  }
  await clock.at(s3 - 0.9, "final check");
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
  clock.overlay({ kind: "tag", at: 0, until: s1, text: TIME_LABELS.result });
  const top = unionRect([
    await rectOf(page.locator(".line-head")),
    await rectOf(page.locator(".fit")),
  ]);
  clock.shot(top, 2);
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
    },
    run: upload,
  },
  replay: {
    before: async (page) => {
      await openRun(page, ORIGINAL_RUN);
      const bottom = await page
        .locator(".timeline")
        .evaluate((el) => el.getBoundingClientRect().bottom);
      await page.evaluate((y) => window.scrollTo({ top: y }), bottom + 24 - VIEWPORT.height);
      await page.waitForTimeout(300);
    },
    run: replay,
  },
  review: { before: async () => {}, run: review },
  edit: {
    before: async (page) => {
      await openRun(page, EDIT_PARENT_RUN);
      await selectLine(page);
      await scrollInspectorTo(page, page.locator(FIX), 140);
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
