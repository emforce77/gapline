/**
 * What the recorder writes for each app scene, and the clock it keeps while recording. Picture time
 * ("output" seconds) runs with the wall clock except inside squeezed waits (an upload being prepared,
 * a saved run replaying), which the builder shortens to their allotted length under an honest label.
 * Camera moves and overlays are logged in output seconds with the element's box in CSS pixels, taken
 * the moment the move starts, so the builder zooms to where the element really was.
 */
import type { Locator, Page } from "playwright-core";
import type { Rect } from "./ass";
import type { Beat } from "./storyboard";

export interface Frame {
  file: string;
  /** Seconds since the epoch, as Chrome stamped the frame. */
  t: number;
}

export interface Warp {
  /** Wall seconds squeezed into `seconds` of picture. */
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
}

export type Overlay =
  | { kind: "spotlight"; at: number; until: number; rect: Rect }
  | { kind: "tag"; at: number; until: number; text: string }
  | { kind: "chip"; at: number; until: number; text: string; rect: Rect };

export interface BeatRecord {
  beat: Beat;
  wallStart: number;
  wallEnd: number;
  /** Length of the scene in the film. */
  seconds: number;
  warps: Warp[];
  shots: Shot[];
  overlays: Overlay[];
  /** Film playback shown in the scene: wall time it started, media time, and wall time it stopped. */
  playback?: { wall: number; media: number; until: number };
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

const LATE_TOLERANCE_S = 0.35;
const TAG_TAIL_S = 0.8;
const CURSOR_MOVE_MS = 650;

export class BeatClock {
  readonly rec: BeatRecord;
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
      late: [],
    };
  }

  now(): number {
    return toOutput(this.rec, Date.now() / 1000);
  }

  /** Waits until picture time `t`; notes it when the recording is already past it. */
  async at(t: number, what: string): Promise<void> {
    const left = t - this.now();
    if (left > 0) await this.page.waitForTimeout(left * 1000);
    else if (-left > LATE_TOLERANCE_S) this.rec.late.push({ what, by: -left });
  }

  /**
   * Runs a wait that the film shows squeezed into `seconds`. The squeezed stretch always carries a
   * label saying what was shortened, kept on screen a little past it so it can be read.
   */
  async squeeze(seconds: number, label: (real: number) => string, wait: () => Promise<void>) {
    const at = this.now();
    const from = Date.now() / 1000;
    await wait();
    const to = Date.now() / 1000;
    if (to - from > seconds) this.rec.warps.push({ from, to, seconds, label: label(to - from) });
    this.overlay({ kind: "tag", at, until: this.now() + TAG_TAIL_S, text: label(to - from) });
  }

  shot(rect: Rect | null, maxZoom?: number, at = this.now()): void {
    this.rec.shots.push({ at, rect, maxZoom });
  }

  overlay(o: Overlay): void {
    this.rec.overlays.push(o);
  }

  end(): BeatRecord {
    this.rec.wallEnd = Date.now() / 1000;
    this.rec.seconds = Math.max(this.rec.seconds, this.now());
    return this.rec;
  }
}

/** A drawn cursor (headless Chrome paints none) that glides to its target and pulses on click. */
export const CURSOR_SCRIPT = `
(() => {
  const install = () => {
    if (document.getElementById("demo-cursor")) return;
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
  document.addEventListener("playing", log("playing"), true);
  document.addEventListener("pause", log("pause"), true);
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

export async function glideTo(page: Page, target: Locator): Promise<{ x: number; y: number }> {
  const r = await rectOf(target);
  const x = r.x + r.w / 2;
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
