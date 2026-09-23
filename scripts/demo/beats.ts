/**
 * What happens in each app scene, timed by the scene's caption sentences (see record.ts), with the
 * app in the film's language:
 *   upload  — a private upload of the sample clip (free: FFmpeg only), then the Generate button of
 *             the new workspace, set to Korean narration, the one press the rest follows from
 *             (hovered, never pressed);
 *   replay  — the automatic sample run's saved trace, replayed so each stage works under the
 *             sentence that names it, sped up overall under an honest label;
 *   review  — the line the final check sent back: the rule it broke, the fix, the rewrite built from
 *             it, and how the line ended;
 *   result  — that line's measured fit, and playback;
 *   edit    — a word typed into another line, WITHOUT submitting it: the optional path.
 * Camera shots and overlays are logged on the scene's clock as the page is driven. Every box is read
 * once the page has stopped moving, and every spotlight is read again as it lights up. Where a
 * picture is held while its caption is read, the camera drifts slowly in on it.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "playwright-core";
import { dictionary } from "../../src/i18n";
import type { Language } from "../../src/lib/pipeline/schemas";
import type { Rect } from "./ass";
import { DRIFT_PUSH, MOVE_SECONDS, shotView } from "./camera";
import { BASE_URL, CACHE_DIR, CLIP_FILE, PROJECT_ID, SAMPLE_RUN } from "./config";
import { film } from "./facts";
import { EDIT_WORD, labels, type ServiceStage } from "./labels";
import {
  BeatClock,
  boxesOf,
  clickLike,
  frameWhole,
  glideTo,
  moveCursor,
  rectOf,
  scrollInspectorTo,
  settledRect,
  sharedArea,
  toOutput,
  unionRect,
  videoPicture,
} from "./recorder-kit";
import { LISTEN, type Beat } from "./storyboard";
import type { ScenePlan } from "./timing";

/** A hovered button is pointed at near its right end, off its label. */
const HOVER_ACROSS = 0.88;
/** Where the cursor rests when it should not cover anything. */
const REST = { x: 1000, y: 620 };
/** The replay's resting cursor: past the corner of both its shots. */
const REPLAY_REST = { x: 1430, y: 650 };
/** The upload card lights up this long after it is in view, as the cursor heads for its button. */
const CARD_LIGHT_S = 0.1;
/** The upload section with the card: never closer than this. */
const SECTION_ZOOM = 1.5;
/** The camera heads for Generate this long before the sentence that names it. */
const GENERATE_LEAD_S = 0.3;
const UPLOAD_NAME: Record<Language, string> = {
  en: "Tears of Steel, opening.mp4",
  ko: "Tears of Steel 오프닝.mp4",
};
/** The Generate button is small: the camera goes closer than it does for text. */
const GENERATE_ZOOM = 2.2;
/** The camera leaves the last detail this long before a scene ends. */
const PULL_BACK_S = 1.3;
/** The fit meter is a plain bar: it takes a closer zoom than text does. */
const FIT_ZOOM = 2.4;
/** The timeline is wide: a light push-in keeps all 65 seconds in the picture. */
const TIMELINE_ZOOM = 1.4;
/** The player with the strip and controls under it, across the page: at most this close. */
const PLAYER_ZOOM = 1.4;
const LIST_ZOOM = 1.8;
const TEXT_ZOOM = 2;
const REPLAY_TIMEOUT_MS = 90_000;
/**
 * The replay's last sentence (voiced, measured, the final check sends back what fails), as shares
 * of its time from its start to the scene's end: the final check working from the start (after the
 * brief Voice), the fix from FIX_AT, the replay done by DONE_AT, then the finished timeline.
 */
const CHECK_LEAD_S = 0.3;
const FIX_AT = 0.4;
const DONE_AT = 0.68;
/** The service chips light up this long into the replay's first sentence, after the list does. */
const LIST_LIGHT_S = 0.4;
const CHIPS_LIGHT_S = 0.7;
/** The review picks its line this soon, so the first scroll can start before its sentence. */
const PICK_S = 0.1;
/** Inspector scrolls start this long before their sentence. */
const SCROLL_LEAD_S = 0.7;
/** A spotlight ends, its fade included, this long before the page under it moves. */
const SPOTLIGHT_CLEAR_S = 0.1;
/** A spotlight lights up this long after its sentence starts, once the camera is on its way. */
const LIGHT_S = 0.5;
/** The check's fix is lit alone at least until this far into its sentence, before the rewrite joins it. */
const FIX_ALONE_S = 2.2;
/** A drift starts this long after the camera has arrived, and ends this long before the next move. */
const DRIFT_LEAD_S = 0.1;
const DRIFT_TAIL_S = 0.2;
/** "Play from here" is pressed this long before the listen pause, so the film starts inside it. */
const PLAY_LEAD_S = 0.9;
/** "Play from here" starts the page this long before its line (PLAY_LEAD_IN_SECONDS, Workspace.tsx). */
const PLAY_FROM_LEAD_S = 1;
const playFrom = Math.max(0, film.line.start - PLAY_FROM_LEAD_S);
const PLAYBACK_TIMEOUT_MS = 30_000;
/** The film around the line is loaded ahead: enough of it buffered past the listen, or give up. */
const BUFFER_TAIL_S = 0.5;
const BUFFER_TIMEOUT_MS = 15_000;
/** How long an upload may take to be prepared and answered. */
const UPLOAD_TIMEOUT_MS = 180_000;
/** The upload's page change may land this much before its planned moment and still be on plan. */
const PAGE_CHANGE_TOLERANCE_S = 0.05;

export type BeatScript = (
  page: Page,
  clock: BeatClock,
  plan: ScenePlan,
  lang: Language,
) => Promise<void>;

/** What the edit scene types into Line 7, before its last word: one word added. Never submitted. */
const EDIT_ADDED = `${EDIT_WORD.ko} `;
const EDIT_BEFORE = "들여다본다.";
/** The editor opens this soon after its sentence starts; the caret moves and the word is typed at these paces. */
const EDITOR_OPEN_S = 0.2;
const CARET_MS = 25;
const TYPING_MS = 110;
/** The cursor's glide (recorder-kit moveCursor) with its settle, so it can arrive on time. */
const GLIDE_S = 0.75;

/** Seconds into the listened line's voice before its first spoken sound (from its voice file). */
const lineOnset = film.opening.lines.find((l) => l.id === film.line.cueId)?.onset;
if (lineOnset === undefined) throw new Error(`${film.line.cueId} is not a line of the sample`);

/** The sample clip under a readable name: the workspace titles an upload after its file. */
async function uploadCopy(lang: Language): Promise<string> {
  const file = join(CACHE_DIR, UPLOAD_NAME[lang]);
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

/** How many caption sentences a scene must have for its choreography (the storyboard's contract). */
function sentences(plan: ScenePlan, beat: Beat, count: number): number[] {
  if (plan.captionStarts.length !== count)
    throw new Error(
      `${beat} is choreographed for ${count} caption sentences; the storyboard has ${plan.captionStarts.length}`,
    );
  return plan.captionStarts;
}

/**
 * When the reader reaches the last line of caption sentence `k`: the start of its caption, or into
 * it by the share of the caption's characters before that line.
 */
function lastLineAt(plan: ScenePlan, k: number): number {
  const c = plan.parts.filter((p) => p.captions)[k].captions!.at(-1)!;
  if (c.lines.length === 1) return c.start;
  const before = c.lines.slice(0, -1).join(" ").length;
  return c.start + ((c.end - c.start) * before) / c.lines.join(" ").length;
}

/**
 * Frames `rect` (taking in the lines of text its frame would otherwise cut) from picture time `at`;
 * once the camera has arrived, it drifts slowly in on it until `until`, so the picture keeps moving
 * while its caption is read.
 */
async function frameAndHold(
  page: Page,
  clock: BeatClock,
  rect: Rect,
  maxZoom: number,
  until: number,
  at = clock.now(),
): Promise<void> {
  const framed = await frameWhole(page, rect, maxZoom);
  clock.shot(framed, maxZoom, at);
  await clock.drift(framed, maxZoom, at + MOVE_SECONDS + DRIFT_LEAD_S, until - DRIFT_TAIL_S);
}

/** Whether `box` is wholly inside `view` or wholly out of it: never cut at the frame's edge. */
const wholeOrOut = (box: Rect, view: Rect) => {
  const shared = sharedArea(box, view);
  return shared === 0 || shared >= box.w * box.h - 1;
};

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

/**
 * Loads the film around the listened line before the scene: seeks to where "Play from here" will
 * start and waits until the player has buffered past the listen, so playback does not stall on the
 * network (the media route is not cacheable). Reports, and goes on, when it does not get there.
 */
async function bufferListen(page: Page): Promise<void> {
  await paintFrame(page, ".player-frame video", playFrom);
  const ready = await page
    .waitForFunction(
      ([from, to]) => {
        const v = document.querySelector<HTMLVideoElement>(".player-frame video")!;
        for (let i = 0; i < v.buffered.length; i++)
          if (v.buffered.start(i) <= from && v.buffered.end(i) >= to) return true;
        return false;
      },
      [playFrom, LISTEN.to + BUFFER_TAIL_S],
      { timeout: BUFFER_TIMEOUT_MS },
    )
    .then(() => true)
    .catch(() => false);
  if (!ready) console.warn(`record result: the film around the line was not buffered ahead`);
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

/** A spotlight on `targets` from `at` to `until`, read now and again as it lights up. */
async function spotlight(
  page: Page,
  clock: BeatClock,
  what: string,
  targets: Locator[],
  at: number,
  until: number,
) {
  const read = boxesOf(targets);
  const rect = await settledRect(page, read);
  clock.spotlight(what, at, until, rect, read);
  return rect;
}

const upload: BeatScript = async (page, clock, plan, lang) => {
  const t = dictionary(lang);
  const words = labels(lang);
  const [, s1] = sentences(plan, "upload", 2);
  // The page changes to the new workspace here, with the camera pulled back to the whole page, and
  // the camera heads straight on for Generate.
  const changed = s1 - GENERATE_LEAD_S;
  const back = changed - MOVE_SECONDS;
  clock.shot(null);
  await clock.at(0.1, "open the upload section");
  await clickLike(page, page.locator('a.button[href="#try-your-clip"]'));
  const card = page.locator(".upload-card");
  // The card's title, hint and button: its box stays the same while the upload's progress bar and
  // status come and go under the button (the button's own label says what is happening).
  const cardParts = boxesOf([
    card.locator("h3"),
    card.locator("#upload-hint"),
    card.getByRole("button"),
  ]);
  const cardRect = await settledRect(page, cardParts);
  // The card with the column beside it, so no line of either is cut at the frame's edge.
  const intro = page.locator(".upload-section > div:not(.upload-card)");
  const section = await settledRect(page, boxesOf([intro, card]));
  clock.shot(await frameWhole(page, section, SECTION_ZOOM), SECTION_ZOOM);
  // The card lights up as the cursor heads for its button, and stays lit while the clip uploads.
  const lit = clock.now() + CARD_LIGHT_S;
  clock.spotlight("the upload card", lit, back - SPOTLIGHT_CLEAR_S, cardRect, cardParts);
  clock.shot(null, undefined, back);
  await clock.at(lit, "the upload card");
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    clickLike(page, card.getByRole("button")),
  ]);
  // The clip is prepared when the upload is answered; the page then changes by client-side
  // navigation, which paints the new page before its address changes.
  const answered = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/projects",
    { timeout: UPLOAD_TIMEOUT_MS },
  );
  await chooser.setFiles(await uploadCopy(lang));
  const chosen = Date.now() / 1000;
  let left = 0;
  const korean = page.locator('.run-options .segmented button[lang="ko"]');
  // No label tail: it would sit over the new page's header.
  await clock.squeeze(
    [
      {
        by: changed,
        wait: async () => {
          const response = await answered;
          left = Date.now() / 1000;
          if (!response.ok())
            throw new Error(`upload: the clip was refused (HTTP ${response.status()})`);
        },
      },
      {
        // Cut out: the page change, the workspace's first paint, and its narration set to Korean,
        // the language of the sample the film goes on to replay, so the page is first seen ready
        // to generate Korean.
        wait: async () => {
          await page.waitForURL("**/p/u-*", { timeout: UPLOAD_TIMEOUT_MS, waitUntil: "commit" });
          await page.locator(".ws-main").waitFor();
          await page.waitForLoadState("networkidle");
          if ((await korean.getAttribute("aria-pressed")) !== "true") await korean.click();
          await page.waitForFunction(
            () =>
              document
                .querySelector('.run-options .segmented button[lang="ko"]')
                ?.getAttribute("aria-pressed") === "true",
          );
          await paintFrame(page, ".player-frame video");
          await moveCursor(page, REST.x, REST.y);
        },
      },
    ],
    () => words.upload(left - chosen),
    0,
  );
  if (toOutput(clock.rec, left) < changed - PAGE_CHANGE_TOLERANCE_S)
    throw new Error(
      `upload: the clip was ready ${(left - chosen).toFixed(1)} s after it was chosen, before the camera had pulled back; show less of the preparation`,
    );
  const generate = page.getByRole("button", { name: t.workspace.generate, exact: true }).first();
  const button = await settledRect(page, boxesOf([generate]));
  await frameAndHold(page, clock, button, GENERATE_ZOOM, plan.seconds - 0.2, changed);
  clock.spotlight("Generate", s1 + 0.4, plan.seconds - 0.2, button, boxesOf([generate]));
  clock.overlay({
    kind: "chip",
    at: s1 + 0.6,
    until: plan.seconds - 0.2,
    text: words.generate,
    rect: button,
  });
  await clock.at(s1 + 0.5, "hover Generate");
  // Hovered, never pressed: it would start a paid run.
  await glideTo(page, generate, HOVER_ACROSS);
  await clock.at(plan.seconds, "end of upload");
};

/** A stage row of the list, by the app's own name for the stage in the film's language. */
const stageRow = (page: Page, lang: Language, stage: ServiceStage, state?: string) =>
  page
    .locator(`.stages li${state ? `.${state}` : ""}`)
    .filter({ has: page.getByText(dictionary(lang).stages[stage], { exact: true }) });

const replay: BeatScript = async (page, clock, plan, lang) => {
  const words = labels(lang);
  const t = dictionary(lang);
  // s1: Gemini writes each line; s2: a second Gemini checks every line; s3: voiced and measured, and
  // the final check sends back what fails.
  const [s1, s2, s3] = sentences(plan, "replay", 3);
  const last = plan.seconds - s3;
  const doneAt = s3 + last * DONE_AT;
  const listEnd = doneAt - SPOTLIGHT_CLEAR_S;
  // The replay was pressed before the scene (SCRIPTS.replay.before): the scene cuts straight in on
  // the reset list, with the app's own "Replaying at N× speed" badge out of the picture (the film's
  // label says what is sped up).
  const list = page.locator(".stages");
  const stages = await settledRect(page, boxesOf([list]));
  const badge = await rectOf(page.locator(".replay-badge"));
  for (const push of [1, DRIFT_PUSH])
    if (sharedArea(badge, shotView(stages, LIST_ZOOM, push)) > 0)
      throw new Error("replay: the replay badge would be in the stage list's shot");
  clock.shot(stages, LIST_ZOOM, 0, 0);
  clock.spotlight("the stage list", s1 + LIST_LIGHT_S, listEnd, stages, boxesOf([list]));
  // Each stage's service beside it; the stages the sample reused get one chip saying where from.
  const reused = page.locator(".stages li").filter({ hasText: t.stages.reused });
  const services = Object.entries(words.services) as [ServiceStage, string][];
  for (const [stage, service] of services) {
    const row = stageRow(page, lang, stage);
    if (!(await row.count()) || (await row.filter({ hasText: t.stages.reused }).count())) continue;
    clock.overlay({
      kind: "chip",
      at: s1 + CHIPS_LIGHT_S,
      until: listEnd,
      text: service,
      rect: await rectOf(row.first()),
    });
  }
  if (await reused.count())
    clock.overlay({
      kind: "chip",
      at: s1 + CHIPS_LIGHT_S,
      until: listEnd,
      text: words.reused,
      rect: unionRect(await Promise.all((await reused.all()).map(rectOf))),
    });
  // A slow push-in on the list while its stages run, so it is never a still picture.
  await clock.drift(stages, LIST_ZOOM, s1 + CHIPS_LIGHT_S + DRIFT_LEAD_S, doneAt - DRIFT_TAIL_S);
  const running = (stage: ServiceStage) => () =>
    stageRow(page, lang, stage, "running").first().waitFor({ timeout: REPLAY_TIMEOUT_MS });
  await clock.pace(
    [
      { by: s2, wait: running("review") },
      { by: s3 + CHECK_LEAD_S, wait: running("verify") },
      { by: s3 + last * FIX_AT, wait: running("fix") },
      {
        by: doneAt,
        wait: () =>
          page.locator(".replay-badge").waitFor({ state: "detached", timeout: REPLAY_TIMEOUT_MS }),
      },
    ],
    words.replay,
    clock.rec.wallStart,
  );
  // Every row done: the timeline, with every line in place, whole in the picture, and the line
  // picker under it either whole or out of it.
  const timeline = await settledRect(page, boxesOf([page.locator(".timeline")]));
  const view = shotView(timeline, TIMELINE_ZOOM);
  for (const part of [".timeline", ".cue-picker"]) {
    const el = page.locator(part);
    if ((await el.count()) && !wholeOrOut(await rectOf(el.first()), view))
      throw new Error(`replay: the timeline's shot cuts ${part} at the frame's edge`);
  }
  clock.shot(timeline, TIMELINE_ZOOM, doneAt);
  if (!(await page.getByRole("button", { name: t.workspace.replay }).count()))
    throw new Error("replay: the replay did not finish");
  await clock.at(plan.seconds, "end of replay");
};

const review: BeatScript = async (page, clock, plan) => {
  const [s0, s1, s2] = sentences(plan, "review", 3);
  clock.shot(null);
  // Picked on the timeline; the cursor stays there, off the inspector the camera goes to.
  await clock.at(PICK_S, "pick the line");
  await clickLike(page, page.locator(`[data-cue-id="${film.line.cueId}"]`).first());
  await page.locator(".line-detail").waitFor();
  // 1. The rejection: the rule it broke, the words quoted, why, and the guideline's page.
  const draft = page.locator(".versions > li").first();
  const failed = draft.locator(".verdict.fail");
  const rejection = [failed.locator(".verdict-title"), failed.locator("ul")];
  await clock.at(s0 - SCROLL_LEAD_S, "the rejection");
  await scrollInspectorTo(page, failed, 60);
  const ruleEnd = s1 - SCROLL_LEAD_S - SPOTLIGHT_CLEAR_S;
  const rule = await spotlight(page, clock, "the rejection", rejection, s0 + LIGHT_S, ruleEnd);
  await frameAndHold(page, clock, rule, TEXT_ZOOM, ruleEnd);
  // 2. The check's fix, then the rewrite built from it, brought in when the caption names it.
  await clock.at(s1 - SCROLL_LEAD_S, "the check's fix");
  const fix = failed.locator(".fix");
  const rewrite = page.locator(".versions > li").nth(1);
  await scrollInspectorTo(page, fix, 40);
  const rewriteAt = Math.max(lastLineAt(plan, 1), s1 + FIX_ALONE_S);
  const fixEnd = s2 - SCROLL_LEAD_S - SPOTLIGHT_CLEAR_S;
  await spotlight(
    page,
    clock,
    "the check's fix",
    [fix],
    s1 + LIGHT_S,
    rewriteAt - SPOTLIGHT_CLEAR_S,
  );
  const both = await spotlight(
    page,
    clock,
    "the fix and the rewrite",
    [fix, rewrite],
    rewriteAt,
    fixEnd,
  );
  await frameAndHold(page, clock, both, LIST_ZOOM, fixEnd);
  // 3. How the line ended: its history in one sentence, and its measured fit.
  await clock.at(s2 - SCROLL_LEAD_S, "the line's verdict");
  await page.evaluate(() =>
    document.querySelector(".ws-inspector")?.scrollTo({ top: 0, behavior: "smooth" }),
  );
  const leave = plan.seconds - PULL_BACK_S;
  const verdict = await spotlight(
    page,
    clock,
    "the verdict and the fit",
    [page.locator(".verdict-chip"), page.locator(".fit")],
    s2 + LIGHT_S,
    leave - SPOTLIGHT_CLEAR_S,
  );
  await frameAndHold(page, clock, verdict, TEXT_ZOOM, leave);
  clock.shot(null, undefined, leave);
  await clock.at(plan.seconds, "end of review");
};

const result: BeatScript = async (page, clock, plan, lang) => {
  const t = dictionary(lang);
  const words = labels(lang);
  const [, s1] = sentences(plan, "result", 2);
  const listenAt = plan.parts.find((p) => "pause" in p.part)!.start;
  const head = page.locator(".line-head");
  const title = words.resultLine.split(" · ")[0];
  if (!(await head.innerText()).startsWith(title))
    throw new Error(`result: the line picked is not "${title}"`);
  const fit = page.locator(".fit");
  const lined = await settledRect(page, boxesOf([head, fit]));
  clock.shot(await frameWhole(page, lined, TEXT_ZOOM), TEXT_ZOOM);
  await clock.at(0.9, "fit meter");
  const meterEnd = s1 - SPOTLIGHT_CLEAR_S;
  const meter = await spotlight(page, clock, "the fit meter", [fit], 1.3, meterEnd);
  await frameAndHold(page, clock, meter, FIT_ZOOM, meterEnd);
  // The player with the strip and the controls under it, framed across the whole workspace: the
  // zoom's spare width lands in the page's margins, never inside the inspector beside it.
  const main = await rectOf(page.locator(".ws-main"));
  const player = await settledRect(
    page,
    boxesOf([
      page.locator(".player-frame"),
      page.locator(".caption-strip"),
      page.locator(".player-controls"),
    ]),
  );
  clock.shot({ x: main.x, y: player.y, w: main.w, h: player.h }, PLAYER_ZOOM, s1);
  await clock.at(listenAt - PLAY_LEAD_S, "play from here");
  await clickLike(page, head.getByRole("button", { name: t.line.play }));
  const started = clock.now();
  clock.player = await videoPicture(page.locator(".player-frame video"));
  // The line's name is up from its first spoken sound.
  clock.overlay({
    kind: "tag",
    at: started,
    until: plan.seconds,
    text: words.resultLine,
    media: film.line.start + lineOnset,
  });
  await moveCursor(page, REST.x - 300, REST.y);
  // Paused on the first frame at or past the listen's end, from the page's own frame callbacks.
  // (Page code: anonymous functions only; tsx would wrap a named one in a helper the page lacks.)
  await page.locator(".player-frame video").evaluate(
    async (v: HTMLVideoElement, [to, timeout]) => {
      const until = performance.now() + timeout;
      for (;;) {
        const meta = await new Promise<VideoFrameCallbackMetadata>((r) =>
          v.requestVideoFrameCallback((_, m) => r(m)),
        );
        if (meta.mediaTime >= to) return v.pause();
        if (performance.now() > until) throw new Error("playback never reached the listen's end");
      }
    },
    [LISTEN.to, PLAYBACK_TIMEOUT_MS],
  );
  await clock.at(plan.seconds, "end of result");
};

const edit: BeatScript = async (page, clock, plan, lang) => {
  const words = labels(lang);
  const [s0, s1] = sentences(plan, "edit", 2);
  const summary = page.locator(".edit-line > summary");
  const opener = await settledRect(page, boxesOf([page.locator(".line-head"), summary]));
  clock.shot(await frameWhole(page, opener, LIST_ZOOM), LIST_ZOOM);
  await clock.at(s0 + EDITOR_OPEN_S, "open the editor");
  await clickLike(page, summary);
  const form = page.locator(".cue-editor");
  await form.waitFor();
  await scrollInspectorTo(page, form, 40);
  const typedEnd = s1 - SPOTLIGHT_CLEAR_S;
  await frameAndHold(page, clock, await settledRect(page, boxesOf([form])), TEXT_ZOOM, typedEnd);
  const box = form.locator("textarea");
  await clickLike(page, box);
  const before = await box.inputValue();
  if (!before.endsWith(EDIT_BEFORE))
    throw new Error(`the edit scene's line does not end "${EDIT_BEFORE}"`);
  // The caret goes before the last word, and one word is typed there, in a lit box named by a chip.
  await box.press("End");
  for (let i = 0; i < EDIT_BEFORE.length; i++) await box.press("ArrowLeft", { delay: CARET_MS });
  const lit = clock.now() + 0.1;
  const area = await spotlight(page, clock, "the typed line", [box], lit, typedEnd);
  clock.overlay({ kind: "chip", at: lit, until: typedEnd, text: words.editAdded, rect: area });
  await box.pressSequentially(EDIT_ADDED, { delay: TYPING_MS });
  const typed = before.slice(0, -EDIT_BEFORE.length) + EDIT_ADDED + EDIT_BEFORE;
  if ((await box.inputValue()) !== typed)
    throw new Error(`typed "${await box.inputValue()}", expected "${typed}"`);
  // 2. The button that would review and re-voice this line, and the note above it: the cursor is on
  // the button as its sentence starts. Never submitted: it would start a paid re-voice.
  const submit = form.locator('button[type="submit"]');
  await clock.at(s1 - GLIDE_S, "point at the submit button");
  await glideTo(page, submit, HOVER_ACROSS);
  const note = form.locator("p.label:not(.mono)");
  const button = await spotlight(
    page,
    clock,
    "Review and re-voice",
    [note, submit],
    s1 + 0.2,
    plan.seconds - 0.2,
  );
  await frameAndHold(page, clock, button, TEXT_ZOOM, plan.seconds - 0.2, s1);
  await clock.at(plan.seconds, "end of edit");
};

export const SCRIPTS: Record<
  Beat,
  { before: (page: Page, lang: Language) => Promise<void>; run: BeatScript }
> = {
  upload: {
    before: async (page) => {
      await page.goto(BASE_URL, { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await paintFrame(page, ".seven video");
    },
    run: upload,
  },
  replay: {
    // The finished run, scrolled to the foot of the page and of the inspector, then replayed: the
    // replay shortens both, which leaves the whole stage list in the inspector and, once the run is
    // done, the timeline's foot in view with the line picker under it out of view. Pressed before
    // the scene, so the scene opens on the reset list.
    before: async (page, lang) => {
      await openRun(page, SAMPLE_RUN);
      await page.evaluate(() => {
        window.scrollTo({ top: document.documentElement.scrollHeight });
        const inspector = document.querySelector(".ws-inspector");
        inspector?.scrollTo({ top: inspector.scrollHeight });
      });
      await moveCursor(page, REPLAY_REST.x, REPLAY_REST.y);
      await page
        .getByRole("button", { name: dictionary(lang).workspace.replay })
        .evaluate((b: HTMLButtonElement) => b.focus({ preventScroll: true }));
      await page.keyboard.press("Enter");
      await page.locator(".replay-badge").waitFor();
      // Two animation frames: the reset list is on screen before the scene's first frame.
      await page.evaluate(
        () =>
          new Promise<void>((done) =>
            requestAnimationFrame(() => requestAnimationFrame(() => done())),
          ),
      );
    },
    run: replay,
  },
  review: {
    // The line's frame is decoded before the scene picks the line, so the pick does not flash black.
    before: (page) => paintFrame(page, "video", film.line.start),
    run: review,
  },
  result: {
    // A fresh page: after the replay and review scenes, the same page's playback froze for 2 s at
    // the same film second in three takes (2026-09-23); a freshly loaded one did not.
    before: async (page) => {
      await openRun(page, SAMPLE_RUN);
      await selectLine(page, film.line.cueId);
      await bufferListen(page);
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
