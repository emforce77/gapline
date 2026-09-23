/**
 * What the recorder writes for each app scene, and the clock it keeps while recording. Picture time
 * ("output" seconds) runs with the wall clock except inside warps: waits the builder shortens to
 * their allotted length (an upload being prepared) or cuts out, and a saved run's replay paced so
 * each stage lands on the sentence that names it — both under an honest label.
 * Camera moves and overlays are logged in output seconds with the element's box in CSS pixels, read
 * once the page has stopped moving; every spotlight is read again when it lights up and must still
 * cover its element, so the builder never frames the wrong thing.
 */
import type { Locator, Page } from "playwright-core";
import type { Rect } from "./ass";
import { DRIFT_PUSH, rectShowing, shotView } from "./camera";
import type { Beat } from "./storyboard";

export interface Frame {
  file: string;
  /** Seconds since the epoch, as Chrome stamped the frame. */
  t: number;
}

export interface Warp {
  /** Wall seconds shown in `seconds` of picture (fewer when shortened, more when slowed). */
  from: number;
  to: number;
  seconds: number;
  label: string;
}

/** A camera target: rect null means the whole viewport. */
export interface Shot {
  at: number;
  rect: Rect | null;
  /** Largest zoom allowed for this shot. */
  maxZoom?: number;
  /** Seconds the camera takes to get there (camera.ts MOVE_SECONDS unless set; 0 cuts). */
  move?: number;
  /** A drift: a slow push-in on `rect`, this much closer than its shot, that lit overlays follow. */
  drift?: number;
}

export type Overlay =
  | { kind: "spotlight"; at: number; until: number; rect: Rect }
  /** `media`: up from the moment the film the scene plays reaches this media second instead. */
  | { kind: "tag"; at: number; until: number; text: string; media?: number }
  | { kind: "chip"; at: number; until: number; text: string; rect: Rect };

/** The film's picture inside the player (CSS px) and the rounding of its corners. */
export interface PlayerPicture {
  rect: Rect;
  radius: number;
}

/** One entry of the page's media log (CURSOR_SCRIPT): an event of a <video>, or a presented frame. */
export interface MediaEvent {
  type: "playing" | "pause" | "waiting" | "stalled" | "seeking" | "seeked" | "frame";
  /** Wall seconds (epoch). */
  wall: number;
  /** The video's media time. */
  media: number;
}

export interface BeatRecord {
  beat: Beat;
  wallStart: number;
  wallEnd: number;
  /** Length of the scene in the film. */
  seconds: number;
  warps: Warp[];
  shots: Shot[];
  overlays: Overlay[];
  /**
   * Film playback shown in the scene, from its presented frames: the wall time media time `media`
   * reached the screen, and the wall time the last frame before the pause did. `rect` is the film's
   * picture inside the player (CSS px) and `radius` the rounding of its corners: the builder lays
   * the film itself over it (segments.ts), so the picture keeps time with the sound even when the
   * page's own playback stutters.
   */
  playback?: { wall: number; media: number; until: number } & PlayerPicture;
  /** Stretches the page's own playback stalled (presented frames over 0.15 s apart), wall seconds. */
  stalls?: { wall: number; seconds: number }[];
  /** The page's media log during the scene, as it was recorded. */
  media?: MediaEvent[];
  /** Each spotlight read again as it lit up: the share of its element it still covered. */
  spotChecks?: { what: string; at: number; share: number }[];
  /** Moves that started later than planned (seconds late), for the check note. */
  late: { what: string; by: number }[];
}

/** Maps wall seconds to picture seconds for one beat. */
export function toOutput(rec: Pick<BeatRecord, "wallStart" | "warps">, wall: number): number {
  let out = wall - rec.wallStart;
  for (const w of rec.warps) {
    if (wall <= w.from) break;
    const inside = Math.min(wall, w.to) - w.from;
    out -= inside - (inside * w.seconds) / (w.to - w.from);
  }
  return out;
}

/** The area two rects share. */
export function sharedArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Area shared by two rects over the larger one's area: 1 when they are the same box. */
export const overlapShare = (a: Rect, b: Rect): number =>
  sharedArea(a, b) / Math.max(a.w * a.h, b.w * b.h);

const LATE_TOLERANCE_S = 0.35;
const TAG_TAIL_S = 0.8;
const CURSOR_MOVE_MS = 650;
/** A spotlight must still cover this share of its element when it lights up. */
export const MIN_SPOT_OVERLAP = 0.9;
/** A paced step is slowed at most this much; a quicker page moment then lands early. */
export const MAX_STRETCH = 5;
/** Warps shorter than this difference are not worth a warp. */
const WARP_EPS_S = 0.02;
/** A drift shorter than this, or pushing in less than MIN_PUSH, is not worth one. */
const MIN_DRIFT_S = 1.5;
const MIN_PUSH = 1.01;
const PUSH_STEP = 0.005;
/** A line of text may reach this far (CSS px) past a frame's edge and still count as inside it. */
const LINE_EPS = 0.5;
/** Framing a shot may show up to this much more page than the element alone asks for... */
const FRAME_GROW = 1.15;
const FRAME_GROW_STEP = 0.01;
/** ...and keeps at least this much room (CSS px) above and below the element. */
const FRAME_ROOM = 6;
/** A box has settled when two readings this far apart agree within SETTLE_PX. */
const SETTLE_STEP_MS = 100;
const SETTLE_PX = 0.5;
const SETTLE_TIMEOUT_MS = 4000;

interface PendingSpot {
  what: string;
  at: number;
  rect: Rect;
  read: () => Promise<Rect>;
}

export class BeatClock {
  readonly rec: BeatRecord;
  /** Set by a scene that plays the film: where the film's picture is (videoPicture). */
  player?: PlayerPicture;
  private pending: PendingSpot[] = [];
  constructor(
    private page: Page,
    beat: Beat,
    seconds: number,
  ) {
    this.rec = {
      beat,
      wallStart: Date.now() / 1000,
      wallEnd: 0,
      seconds,
      warps: [],
      shots: [],
      overlays: [],
      spotChecks: [],
      late: [],
    };
  }

  now(): number {
    return toOutput(this.rec, Date.now() / 1000);
  }

  /**
   * Waits until picture time `t`, reading every spotlight that lights up on the way; notes it when
   * the recording is already past `t`.
   */
  async at(t: number, what: string): Promise<void> {
    await this.readSpotlights(t, true);
    const left = t - this.now();
    if (left > 0) await this.page.waitForTimeout(left * 1000);
    else if (-left > LATE_TOLERANCE_S) this.rec.late.push({ what, by: -left });
  }

  /**
   * Reads again every spotlight lighting up by picture time `t`, each at its start when `wait`
   * (inside at()), or at once (after a paced step, where the page is left to run).
   */
  private async readSpotlights(t: number, wait: boolean): Promise<void> {
    for (;;) {
      const due = this.pending.filter((s) => s.at <= t).sort((a, b) => a.at - b.at)[0];
      if (!due) return;
      const left = due.at - this.now();
      if (wait && left > 0) await this.page.waitForTimeout(left * 1000);
      this.pending.splice(this.pending.indexOf(due), 1);
      await this.verify(due);
    }
  }

  private async verify(s: PendingSpot): Promise<void> {
    const share = overlapShare(s.rect, await s.read());
    this.rec.spotChecks!.push({ what: s.what, at: s.at, share: Math.round(share * 1000) / 1000 });
    if (share < MIN_SPOT_OVERLAP)
      throw new Error(
        `${this.rec.beat}: the spotlight on ${s.what} covers ${(share * 100).toFixed(0)} % of it when it lights up at ${s.at.toFixed(2)} s (at least ${MIN_SPOT_OVERLAP * 100} %)`,
      );
  }

  /**
   * Runs waits that the film shows squeezed, each one ending by picture time `by` (a wait that is
   * already shorter plays at its real length); a step without `by` is cut out of the picture. The
   * whole stretch carries one label saying what was shortened, kept on screen `tail` seconds past it
   * so it can be read.
   */
  async squeeze(
    steps: { by?: number; wait: () => Promise<void> }[],
    label: (real: number) => string,
    tail = TAG_TAIL_S,
  ): Promise<void> {
    const at = this.now();
    const started = Date.now() / 1000;
    for (const step of steps) {
      const seconds = step.by === undefined ? 0 : step.by - this.now();
      if (step.by !== undefined && seconds <= 0)
        throw new Error(`${this.rec.beat}: a squeezed wait starts past its end ${step.by} s`);
      const from = Date.now() / 1000;
      await step.wait();
      const to = Date.now() / 1000;
      if (to - from > seconds)
        this.rec.warps.push({ from, to, seconds, label: label(to - started) });
    }
    const real = Date.now() / 1000 - started;
    this.overlay({ kind: "tag", at, until: this.now() + tail, text: label(real) });
  }

  /**
   * Lands moments of a replay on picture times. Each step waits for a moment of the page and shows
   * the wall time since the previous one (the first since `from`, the wall time the replay was
   * pressed) in exactly the picture time up to its `by`: shortened when the page took longer,
   * slowed when it was quicker, never slowed more than MAX_STRETCH (a quicker moment lands early).
   * The label is up from `from` until `tail` seconds past the last step.
   */
  async pace(
    steps: { by: number; wait: () => Promise<void> }[],
    label: string,
    from: number,
    tail = TAG_TAIL_S,
  ): Promise<void> {
    const last = this.rec.warps.at(-1);
    if (last && from < last.to) throw new Error(`${this.rec.beat}: a pace starts inside a warp`);
    const startOut = toOutput(this.rec, from);
    let wall = from;
    let out = startOut;
    for (const [i, step] of steps.entries()) {
      const allotted = step.by - out;
      if (allotted <= 0)
        throw new Error(`${this.rec.beat}: a paced step starts past its end ${step.by} s`);
      await step.wait();
      const to = Date.now() / 1000;
      const real = to - wall;
      const shown = Math.min(allotted, real * MAX_STRETCH);
      if (Math.abs(shown - real) > WARP_EPS_S)
        this.rec.warps.push({ from: wall, to, seconds: shown, label });
      out += Math.abs(shown - real) > WARP_EPS_S ? shown : real;
      // A moment the page reached too quickly to slow down this much lands early: noted, as a negative delay.
      if (allotted - shown > LATE_TOLERANCE_S)
        this.rec.late.push({ what: `paced step ${i + 1}`, by: shown - allotted });
      wall = to;
      await this.readSpotlights(out, false);
    }
    this.overlay({ kind: "tag", at: startOut, until: out + tail, text: label });
  }

  /** Frames `rect` from picture time `at`, reached in `move` seconds (camera.ts; 0 cuts). */
  shot(rect: Rect | null, maxZoom?: number, at = this.now(), move?: number): void {
    this.rec.shots.push(move === undefined ? { at, rect, maxZoom } : { at, rect, maxZoom, move });
  }

  /**
   * A slow push-in on the shot's `rect` from `from` to `until`, so a held picture keeps moving while
   * its caption is read; lit overlays follow it. It stops short of cutting any line of text in the
   * shot's column that the shot shows whole, and is skipped when the hold is too short to need one
   * or there is no room to push in.
   */
  async drift(rect: Rect, maxZoom: number | undefined, from: number, until: number): Promise<void> {
    if (until - from < MIN_DRIFT_S) return;
    const still = shotView(rect, maxZoom);
    const whole = (await textLines(this.page)).filter((l) => inColumn(l, rect) && holds(still, l));
    let push = DRIFT_PUSH;
    const keeps = (p: number) => {
      const view = shotView(rect, maxZoom, p);
      return whole.every((l) => holds(view, l));
    };
    while (push >= MIN_PUSH && !keeps(push)) push -= PUSH_STEP;
    if (push < MIN_PUSH) return;
    this.rec.shots.push({ at: from, rect, maxZoom, move: until - from, drift: push });
  }

  overlay(o: Overlay): void {
    this.rec.overlays.push(o);
  }

  /**
   * Dims everything but `rect` from `at` to `until`. `read` reads the element's box again: it runs
   * when the spotlight lights up (inside at()), and the recording fails if the box has moved away.
   */
  spotlight(
    what: string,
    at: number,
    until: number,
    rect: Rect,
    read: () => Promise<Rect>,
  ): Overlay & { kind: "spotlight" } {
    const o = { kind: "spotlight" as const, at, until, rect };
    this.overlay(o);
    this.pending.push({ what, at, rect, read });
    return o;
  }

  end(): BeatRecord {
    if (this.pending.length)
      throw new Error(
        `${this.rec.beat}: spotlights never read again as they lit up: ${this.pending.map((s) => s.what).join(", ")}`,
      );
    this.rec.wallEnd = Date.now() / 1000;
    this.rec.seconds = Math.max(this.rec.seconds, this.now());
    return this.rec;
  }
}

/**
 * Page style for the recording: the model's scene memo in the line inspector is left out (it is the
 * model's working notes, in English whatever the page's language), and the page keeps the scroll
 * position the recorder set. With scroll anchoring on, the end of the replay (the line picker and
 * the run's figures coming back under the timeline) scrolled the page to its foot, 645 px down
 * (measured on the dev server, 2026-09-23).
 */
const RECORDING_CSS = ".scene-evidence{display:none!important}html,body{overflow-anchor:none}";

/**
 * A drawn cursor (headless Chrome paints none) that glides to its target and pulses on click, the
 * recording's page style, and the page's media log: every video's playing, pause, waiting, stalled,
 * seeking and seeked events, and each frame as it reaches the screen.
 */
export const CURSOR_SCRIPT = `
(() => {
  const install = () => {
    if (document.getElementById("demo-cursor")) return;
    const style = document.createElement("style");
    style.id = "demo-style";
    style.textContent = ${JSON.stringify(RECORDING_CSS)};
    document.documentElement.appendChild(style);
    const el = document.createElement("div");
    el.id = "demo-cursor";
    el.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M4 2 L4 22 L9.5 17 L13 25 L16.5 23.5 L13 15.5 L20.5 15.5 Z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg><span></span>';
    Object.assign(el.style, { position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none",
      transform: "translate(" + (window.__cursorX || 1180) + "px, " + (window.__cursorY || 560) + "px)",
      transition: "transform ${CURSOR_MOVE_MS}ms cubic-bezier(.3,.7,.2,1)" });
    const ring = el.querySelector("span");
    Object.assign(ring.style, { position: "absolute", left: "-14px", top: "-14px", width: "32px", height: "32px",
      borderRadius: "50%", border: "2px solid #ece9e3", opacity: "0", transition: "transform 380ms ease, opacity 380ms ease" });
    document.documentElement.appendChild(el);
    window.__demoCursor = {
      move(x, y) { window.__cursorX = x; window.__cursorY = y; el.style.transform = "translate(" + x + "px, " + y + "px)"; },
      pulse() {
        ring.style.transition = "none"; ring.style.transform = "scale(0.4)"; ring.style.opacity = "1";
        requestAnimationFrame(() => { ring.style.transition = "transform 380ms ease, opacity 380ms ease";
          ring.style.transform = "scale(1.4)"; ring.style.opacity = "0"; });
      },
    };
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install); else install();
  window.__mediaLog = [];
  const log = (type) => (e) => { if (e.target instanceof HTMLVideoElement)
    window.__mediaLog.push({ type, wall: Date.now() / 1000, media: e.target.currentTime }); };
  for (const type of ["playing", "pause", "waiting", "stalled", "seeking", "seeked"])
    document.addEventListener(type, log(type), true);
  // Frames as they reach the screen: 'playing' fires before the first one does, so the film's
  // sound is anchored to these. One callback chain per video; it idles while the video is paused.
  const watched = new WeakSet();
  document.addEventListener("playing", (e) => {
    const v = e.target;
    if (!(v instanceof HTMLVideoElement) || watched.has(v)) return;
    watched.add(v);
    const onFrame = (_, meta) => {
      window.__mediaLog.push({ type: "frame", wall: (performance.timeOrigin + meta.expectedDisplayTime) / 1000,
        media: meta.mediaTime });
      v.requestVideoFrameCallback(onFrame);
    };
    v.requestVideoFrameCallback(onFrame);
  }, true);
})();
`;

type CursorWindow = { __demoCursor: { move: (x: number, y: number) => void; pulse: () => void } };

export async function moveCursor(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(
    ([px, py]) => (window as unknown as CursorWindow).__demoCursor.move(px, py),
    [x, y],
  );
  await page.waitForTimeout(CURSOR_MOVE_MS + 60);
}

export async function rectOf(target: Locator): Promise<Rect> {
  const box = await target.boundingBox();
  if (!box) throw new Error(`${target} has no box on the page`);
  return { x: box.x, y: box.y, w: box.width, h: box.height };
}

export const unionRect = (rects: Rect[]): Rect => {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return {
    x,
    y,
    w: Math.max(...rects.map((r) => r.x + r.w)) - x,
    h: Math.max(...rects.map((r) => r.y + r.h)) - y,
  };
};

/**
 * Every visible line of text on the page (CSS px): one box per line of each text node, clipped to
 * the boxes that scroll or clip it and to the viewport. (Page code: no named inner functions.)
 */
export async function textLines(page: Page): Promise<Rect[]> {
  return page.evaluate(() => {
    const lines: { x: number; y: number; w: number; h: number }[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || !(n.textContent ?? "").trim()) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of Array.from(range.getClientRects())) {
        let [x1, y1, x2, y2] = [r.left, r.top, r.right, r.bottom];
        for (let a: HTMLElement | null = el; a; a = a.parentElement) {
          const s = getComputedStyle(a);
          if (s.overflowX === "visible" && s.overflowY === "visible") continue;
          const b = a.getBoundingClientRect();
          [x1, y1] = [Math.max(x1, b.left), Math.max(y1, b.top)];
          [x2, y2] = [Math.min(x2, b.right), Math.min(y2, b.bottom)];
        }
        [x1, y1] = [Math.max(x1, 0), Math.max(y1, 0)];
        [x2, y2] = [Math.min(x2, innerWidth), Math.min(y2, innerHeight)];
        if (x2 - x1 >= 1 && y2 - y1 >= 1) lines.push({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
      }
    }
    return lines;
  });
}

/** Whether `view` shows all of `line`. */
const holds = (view: Rect, line: Rect) =>
  line.x >= view.x - LINE_EPS &&
  line.y >= view.y - LINE_EPS &&
  line.x + line.w <= view.x + view.w + LINE_EPS &&
  line.y + line.h <= view.y + view.h + LINE_EPS;

/** A line in the column of `rect`: they share some of their width. */
const inColumn = (line: Rect, rect: Rect) => line.x < rect.x + rect.w && line.x + line.w > rect.x;

/**
 * The box to frame for a shot of `rect` whose top and bottom edges cut no line of text in the
 * column of `rect` (lines beside the column, as in a dimmed panel next to it, fall as they may): the
 * view is moved up or down, least first, and failing that shown a little taller, with the element
 * always whole. `rect` itself when no such view exists.
 */
export async function frameWhole(page: Page, rect: Rect, maxZoom: number): Promise<Rect> {
  const lines = (await textLines(page)).filter((l) => inColumn(l, rect));
  const inside = (l: Rect, edge: number) => l.y + LINE_EPS < edge && edge < l.y + l.h - LINE_EPS;
  const clean = (v: Rect) =>
    rect.y - v.y >= FRAME_ROOM - LINE_EPS &&
    v.y + v.h - (rect.y + rect.h) >= FRAME_ROOM - LINE_EPS &&
    !lines.some((l) => inside(l, v.y) || inside(l, v.y + v.h));
  const view = shotView(rect, maxZoom);
  if (clean(view)) return rect;
  for (let grow = 1; grow <= FRAME_GROW + 1e-9; grow += FRAME_GROW_STEP) {
    const height = view.h * grow;
    const centred = view.y - (height - view.h) / 2;
    for (let shift = 0; shift <= height; shift++)
      for (const top of shift ? [centred - shift, centred + shift] : [centred]) {
        const box = rectShowing(rect, top, height);
        const shown = shotView(box, maxZoom);
        if (Math.abs(shown.y - top) < 1 && Math.abs(shown.h - height) < 1 && clean(shown))
          return box;
      }
  }
  return rect;
}

/** Reads the union of the targets' boxes. */
export const boxesOf = (targets: Locator[]) => async (): Promise<Rect> =>
  unionRect(await Promise.all(targets.map(rectOf)));

const sameRect = (a: Rect, b: Rect) =>
  Math.abs(a.x - b.x) <= SETTLE_PX &&
  Math.abs(a.y - b.y) <= SETTLE_PX &&
  Math.abs(a.w - b.w) <= SETTLE_PX &&
  Math.abs(a.h - b.h) <= SETTLE_PX;

/** The targets' box once the page has stopped moving: two readings 100 ms apart agree. */
export async function settledRect(page: Page, read: () => Promise<Rect>): Promise<Rect> {
  const started = Date.now();
  let prev = await read();
  for (;;) {
    await page.waitForTimeout(SETTLE_STEP_MS);
    const next = await read();
    if (sameRect(prev, next)) return next;
    if (Date.now() - started > SETTLE_TIMEOUT_MS)
      throw new Error(`a box was still moving after ${SETTLE_TIMEOUT_MS} ms`);
    prev = next;
  }
}

/**
 * The film's picture inside a <video> (CSS px): its content box with the video fitted by
 * object-fit, and the rounding its frame (overflow hidden) gives the picture's corners.
 */
export async function videoPicture(target: Locator): Promise<PlayerPicture> {
  // Page code: no named inner functions (tsx would wrap them in a helper the page does not have).
  return target.evaluate((v: HTMLVideoElement) => {
    const cs = getComputedStyle(v);
    const box = v.getBoundingClientRect();
    const [bl, br, bt, bb, pl, pr, pt, pb] = [
      cs.borderLeftWidth,
      cs.borderRightWidth,
      cs.borderTopWidth,
      cs.borderBottomWidth,
      cs.paddingLeft,
      cs.paddingRight,
      cs.paddingTop,
      cs.paddingBottom,
    ].map(parseFloat);
    const cw = box.width - bl - br - pl - pr;
    const ch = box.height - bt - bb - pt - pb;
    if (!v.videoWidth || !v.videoHeight) throw new Error("the video has no picture size yet");
    if (cs.objectPosition !== "50% 50%") throw new Error(`object-position ${cs.objectPosition}`);
    let w = cw;
    let h = ch;
    if (cs.objectFit === "contain" || cs.objectFit === "scale-down") {
      const scale = Math.min(cw / v.videoWidth, ch / v.videoHeight);
      w = v.videoWidth * scale;
      h = v.videoHeight * scale;
    } else if (cs.objectFit !== "fill") throw new Error(`object-fit ${cs.objectFit}`);
    const rect = { x: box.x + bl + pl + (cw - w) / 2, y: box.y + bt + pt + (ch - h) / 2, w, h };
    // The frame clips its content to its inner radius: the picture's corners are rounded when they
    // meet the frame's padding box.
    const frame = v.parentElement!;
    const fs = getComputedStyle(frame);
    const fb = frame.getBoundingClientRect();
    const [fl, fr, ft, fbm, radius] = [
      fs.borderLeftWidth,
      fs.borderRightWidth,
      fs.borderTopWidth,
      fs.borderBottomWidth,
      fs.borderTopLeftRadius,
    ].map(parseFloat);
    const meets =
      fs.overflow !== "visible" &&
      Math.abs(rect.x - (fb.x + fl)) < 1 &&
      Math.abs(rect.y - (fb.y + ft)) < 1 &&
      Math.abs(rect.w - (fb.width - fl - fr)) < 1 &&
      Math.abs(rect.h - (fb.height - ft - fbm)) < 2;
    return { rect, radius: meets ? Math.max(0, radius - ft) : 0 };
  });
}

/**
 * Glides the cursor onto `target`, at `across` of its width (the middle by default; a hover near a
 * button's end keeps the pointer off its label).
 */
export async function glideTo(
  page: Page,
  target: Locator,
  across = 0.5,
): Promise<{ x: number; y: number }> {
  const r = await rectOf(target);
  const x = r.x + r.w * across;
  const y = r.y + r.h / 2;
  await moveCursor(page, x, y);
  return { x, y };
}

export async function clickLike(page: Page, target: Locator): Promise<void> {
  const { x, y } = await glideTo(page, target);
  await page.evaluate(() => (window as unknown as CursorWindow).__demoCursor.pulse());
  await page.mouse.click(x, y);
}

/** Smoothly scrolls the inspector panel so `target` sits `offset` px below its top. */
export async function scrollInspectorTo(page: Page, target: Locator, offset = 24): Promise<void> {
  await target.evaluate((el, off) => {
    const panel = el.closest(".ws-inspector") as HTMLElement;
    const top =
      el.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop - off;
    panel.scrollTo({ top, behavior: "smooth" });
  }, offset);
  await page.waitForTimeout(700);
}
