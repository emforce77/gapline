/**
 * The virtual camera over a recording: eased zooms and pans to the elements the recorder logged. The
 * FFmpeg chain scales each 2880×1320 frame to 1920·Z × 880·Z and crops the 1920×880 picture area out
 * of it. Crop bounds are written as explicit 1920·Z / 880·Z expressions because crop keeps the first
 * frame's input size.
 * A shot is reached in MOVE_SECONDS, or cut to at once; a drift is a slow push-in on the element in
 * shot, so the picture never stands still for long, about the page point it keeps in place (its
 * anchor: the element's centre unless the recorder chose an edge). The same state function places
 * overlays in picture pixels: a spotlight lands on its element, and follows it through a drift.
 */
import type { Rect } from "./ass";
import { CONTENT_HEIGHT, CSS_TO_OUT, FPS, WIDTH } from "./config";
import type { BeatRecord, Shot } from "./recorder-kit";

/** Space kept around a target, in CSS pixels. */
const PAD_CSS = 22;
const DEFAULT_MAX_ZOOM = 2;
export const MOVE_SECONDS = 1.2;
/**
 * A drift pushes in at most this much closer than its shot, and never so close that less than
 * DRIFT_PAD_CSS is left around its element (more than a spotlight's frame, 10 picture px).
 */
export const DRIFT_PUSH = 1.08;
export const DRIFT_PAD_CSS = 12;

/** Zoom, and the view centre in unzoomed picture pixels. */
export interface CamState {
  z: number;
  cx: number;
  cy: number;
}

const WIDE: CamState = { z: 1, cx: WIDTH / 2, cy: CONTENT_HEIGHT / 2 };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** The zoom that fits `r` with `pad` CSS px around it. */
const fitZoom = (r: Rect, pad: number) =>
  Math.min(WIDTH / ((r.w + 2 * pad) * CSS_TO_OUT), CONTENT_HEIGHT / ((r.h + 2 * pad) * CSS_TO_OUT));

/** A point of the page (CSS px). */
export interface Point {
  x: number;
  y: number;
}

/**
 * `c` pushed `push` closer about the page point `p`, which stays where it is in the picture. A
 * point inside the view keeps the pushed view inside it, so inside the frame.
 */
function pushAbout(c: CamState, p: Point, push: number): CamState {
  const z = c.z * push;
  const px = p.x * CSS_TO_OUT;
  const py = p.y * CSS_TO_OUT;
  // The picture position of p stays: p·z − (centre·z − half) is the same at both zooms.
  const x0 = px * z - (px * c.z - (c.cx * c.z - WIDTH / 2));
  const y0 = py * z - (py * c.z - (c.cy * c.z - CONTENT_HEIGHT / 2));
  const x = clamp(x0, 0, WIDTH * z - WIDTH);
  const y = clamp(y0, 0, CONTENT_HEIGHT * z - CONTENT_HEIGHT);
  return { z, cx: (x + WIDTH / 2) / z, cy: (y + CONTENT_HEIGHT / 2) / z };
}

function stateFor(shot: Pick<Shot, "rect" | "maxZoom" | "drift" | "anchor">): CamState {
  if (!shot.rect) return WIDE;
  const r = shot.rect;
  const framed = clamp(fitZoom(r, PAD_CSS), 1, shot.maxZoom ?? DEFAULT_MAX_ZOOM);
  const push = Math.min(shot.drift ?? 1, DRIFT_PUSH);
  if (shot.anchor && push > 1)
    return pushAbout(stateFor({ rect: r, maxZoom: shot.maxZoom }), shot.anchor, push);
  const z = Math.max(framed, Math.min(framed * push, fitZoom(r, DRIFT_PAD_CSS)));
  // Clamp the crop inside the zoomed frame, then express it as a centre again.
  const x = clamp((r.x + r.w / 2) * CSS_TO_OUT * z - WIDTH / 2, 0, WIDTH * z - WIDTH);
  const y = clamp(
    (r.y + r.h / 2) * CSS_TO_OUT * z - CONTENT_HEIGHT / 2,
    0,
    CONTENT_HEIGHT * z - CONTENT_HEIGHT,
  );
  return { z, cx: (x + WIDTH / 2) / z, cy: (y + CONTENT_HEIGHT / 2) / z };
}

export interface Key {
  at: number;
  /** Seconds to reach `state`; 0 is a cut. */
  move: number;
  state: CamState;
  /** A drift: overlays stay lit and follow it. */
  drift: boolean;
}

const ease = (p: number) => (1 - Math.cos(Math.PI * clamp(p, 0, 1))) / 2;
const lerp = (a: CamState, b: CamState, p: number): CamState => ({
  z: a.z + (b.z - a.z) * p,
  cx: a.cx + (b.cx - a.cx) * p,
  cy: a.cy + (b.cy - a.cy) * p,
});

/**
 * The camera's keys, in time order. A move is shortened when the next shot comes sooner; a drift the
 * next shot cuts short stops where it has got to, so it never speeds up.
 */
export function cameraKeys(shots: Shot[]): Key[] {
  const sorted = [...shots].sort((a, b) => a.at - b.at);
  let prev = WIDE;
  return sorted.map((s, i) => {
    const wanted = s.move ?? MOVE_SECONDS;
    const move = Math.min(wanted, (sorted[i + 1]?.at ?? Infinity) - s.at);
    const target = stateFor(s);
    const state = s.drift && move < wanted ? lerp(prev, target, ease(move / wanted)) : target;
    prev = state;
    return { at: s.at, move, state, drift: s.drift !== undefined };
  });
}

/**
 * Hold the replay's dense stage list still while it is read. A tiny continuous scale/crop rounds
 * to whole pixels in FFmpeg and makes the text and overlay edges visibly jitter. Apply this when
 * building too, so cached recordings get the same stable hold without recording a new run.
 */
export function cameraForBeat(rec: Pick<BeatRecord, "beat" | "shots">): Key[] {
  return cameraKeys(
    rec.beat === "replay" ? rec.shots.filter((shot) => shot.drift === undefined) : rec.shots,
  );
}

const progress = (k: Key, t: number) => (k.move > 0 ? ease((t - k.at) / k.move) : 1);

/** The camera at picture time t (for placing overlays). */
export function cameraAt(keys: Key[], t: number): CamState {
  let state = WIDE;
  for (const k of keys) {
    if (t < k.at) break;
    state = lerp(state, k.state, progress(k, t));
  }
  return state;
}

/**
 * The part of the page (CSS px) a shot shows once the camera has arrived (or drifted `push` in,
 * about `anchor` when one is given).
 */
export function shotView(rect: Rect | null, maxZoom?: number, push?: number, anchor?: Point): Rect {
  const c = stateFor({ rect, maxZoom, drift: push, anchor });
  const w = WIDTH / c.z / CSS_TO_OUT;
  const h = CONTENT_HEIGHT / c.z / CSS_TO_OUT;
  return { x: c.cx / CSS_TO_OUT - w / 2, y: c.cy / CSS_TO_OUT - h / 2, w, h };
}

/**
 * A box in `rect`'s column whose shot shows the page from `top` down for `height` CSS px (as long as
 * the zoom that takes is the one the height sets: under the shot's cap, and wide enough).
 */
export const rectShowing = (rect: Rect, top: number, height: number): Rect => ({
  x: rect.x,
  w: rect.w,
  y: top + PAD_CSS,
  h: height - 2 * PAD_CSS,
});

/** When the camera has arrived at the shot in force at time t (a drift is not waited for). */
export function settledAt(keys: Key[], t: number): number {
  const k = [...keys].reverse().find((key) => key.at <= t && !key.drift);
  return k ? Math.max(t, k.at + k.move) : t;
}

/** Moves other than drifts under way between `from` and `to`: an overlay lit then would slide off. */
export const movesDuring = (keys: Key[], from: number, to: number): Key[] =>
  keys.filter((k) => !k.drift && k.move > 0 && k.at < to && k.at + k.move > from);

/**
 * `from`–`to` in pieces, each drawn with the camera at its `at`: one piece where the camera holds
 * still, one per output frame (boundaries half a frame either side of it) where a drift moves it.
 * Pieces also break at `splits`, so an overlay's fades can be set piece by piece.
 */
export function pieces(
  keys: Key[],
  from: number,
  to: number,
  splits: number[] = [],
): { start: number; end: number; at: number }[] {
  const moving = keys
    .filter((k) => k.drift && k.move > 0)
    .map((k) => ({ start: Math.max(from, k.at), end: Math.min(to, k.at + k.move) }))
    .filter((m) => m.end > m.start);
  const out: { start: number; end: number; at: number }[] = [];
  const still = (start: number, end: number) => {
    const cuts = [start, ...splits.filter((s) => s > start && s < end), end];
    for (let i = 1; i < cuts.length; i++)
      out.push({ start: cuts[i - 1], end: cuts[i], at: cuts[i - 1] });
  };
  let t = from;
  for (const m of moving) {
    if (m.start > t) still(t, m.start);
    for (let f = Math.round(m.start * FPS); f <= Math.round(m.end * FPS); f++) {
      const start = Math.max(m.start, (f - 0.5) / FPS);
      const end = Math.min(m.end, (f + 0.5) / FPS);
      if (end > start) out.push({ start, end, at: clamp(f / FPS, start, end) });
    }
    t = m.end;
  }
  if (to > t) still(t, to);
  return out;
}

/** A CSS-pixel rect as picture pixels under camera state c. */
export function toPicture(r: Rect, c: CamState): Rect {
  const x0 = c.cx * c.z - WIDTH / 2;
  const y0 = c.cy * c.z - CONTENT_HEIGHT / 2;
  return {
    x: r.x * CSS_TO_OUT * c.z - x0,
    y: r.y * CSS_TO_OUT * c.z - y0,
    w: r.w * CSS_TO_OUT * c.z,
    h: r.h * CSS_TO_OUT * c.z,
  };
}

/** Piecewise eased expression for one state field, in FFmpeg's expression language. */
function expr(keys: Key[], field: keyof CamState): string {
  let prev = WIDE[field];
  let out = "";
  let close = "";
  for (const k of keys) {
    const v = k.state[field];
    const at = k.at.toFixed(3);
    if (k.move > 0) {
      const e = `(1-cos(PI*(t-${at})/${k.move.toFixed(3)}))/2`;
      out += `if(lt(t,${at}),${prev.toFixed(4)},if(lt(t,${(k.at + k.move).toFixed(3)}),${prev.toFixed(4)}+(${(v - prev).toFixed(4)})*${e},`;
      close += "))";
    } else {
      out += `if(lt(t,${at}),${prev.toFixed(4)},`;
      close += ")";
    }
    prev = v;
  }
  return `${out}${prev.toFixed(4)}${close}`;
}

/** scale+crop filters for a recording; plain scaling when the camera never moves. */
export function cameraFilters(keys: Key[]): string[] {
  if (keys.every((k) => k.state === WIDE))
    return [`scale=${WIDTH}:${CONTENT_HEIGHT}:flags=lanczos`];
  const z = expr(keys, "z");
  const cx = expr(keys, "cx");
  const cy = expr(keys, "cy");
  return [
    `scale=w='trunc(${WIDTH}*(${z})/2)*2':h='trunc(${CONTENT_HEIGHT}*(${z})/2)*2':eval=frame:flags=lanczos`,
    `crop=${WIDTH}:${CONTENT_HEIGHT}:x='min(max(0,(${cx})*(${z})-${WIDTH / 2}),${WIDTH}*(${z})-${WIDTH})':y='min(max(0,(${cy})*(${z})-${CONTENT_HEIGHT / 2}),${CONTENT_HEIGHT}*(${z})-${CONTENT_HEIGHT})'`,
  ];
}
