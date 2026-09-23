/**
 * The virtual camera over a recording: eased zooms and pans to the elements the recorder logged. The
 * FFmpeg chain scales each 2880×1440 frame to 1920·Z × 960·Z and crops 1920×960 out of it. Crop bounds
 * are written as explicit 1920·Z / 960·Z expressions because crop keeps the first frame's input size.
 * The same state function places overlays in picture pixels, so a spotlight lands on its element.
 */
import type { Rect } from "./ass";
import { CONTENT_HEIGHT, CSS_TO_OUT, WIDTH } from "./config";
import type { Shot } from "./recorder-kit";

/** Space kept around a target, in CSS pixels. */
const PAD_CSS = 22;
const DEFAULT_MAX_ZOOM = 2;
export const MOVE_SECONDS = 0.8;

/** Zoom, and the view centre in unzoomed picture pixels. */
export interface CamState {
  z: number;
  cx: number;
  cy: number;
}

const WIDE: CamState = { z: 1, cx: WIDTH / 2, cy: CONTENT_HEIGHT / 2 };
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function stateFor(shot: Shot): CamState {
  if (!shot.rect) return WIDE;
  const r = shot.rect;
  const z = clamp(
    Math.min(
      WIDTH / ((r.w + 2 * PAD_CSS) * CSS_TO_OUT),
      CONTENT_HEIGHT / ((r.h + 2 * PAD_CSS) * CSS_TO_OUT),
    ),
    1,
    shot.maxZoom ?? DEFAULT_MAX_ZOOM,
  );
  // Clamp the crop inside the zoomed frame, then express it as a centre again.
  const x = clamp((r.x + r.w / 2) * CSS_TO_OUT * z - WIDTH / 2, 0, WIDTH * z - WIDTH);
  const y = clamp(
    (r.y + r.h / 2) * CSS_TO_OUT * z - CONTENT_HEIGHT / 2,
    0,
    CONTENT_HEIGHT * z - CONTENT_HEIGHT,
  );
  return { z, cx: (x + WIDTH / 2) / z, cy: (y + CONTENT_HEIGHT / 2) / z };
}

interface Key {
  at: number;
  move: number;
  state: CamState;
}

export function cameraKeys(shots: Shot[]): Key[] {
  const sorted = [...shots].sort((a, b) => a.at - b.at);
  return sorted.map((s, i) => ({
    at: s.at,
    move: Math.min(MOVE_SECONDS, (sorted[i + 1]?.at ?? Infinity) - s.at),
    state: stateFor(s),
  }));
}

const ease = (p: number) => (1 - Math.cos(Math.PI * clamp(p, 0, 1))) / 2;

/** The camera at picture time t (for placing overlays). */
export function cameraAt(keys: Key[], t: number): CamState {
  let state = WIDE;
  for (const k of keys) {
    if (t < k.at) break;
    const p = ease((t - k.at) / k.move);
    state = {
      z: state.z + (k.state.z - state.z) * p,
      cx: state.cx + (k.state.cx - state.cx) * p,
      cy: state.cy + (k.state.cy - state.cy) * p,
    };
  }
  return state;
}

/** When the camera has arrived at the shot in force at time t. */
export function settledAt(keys: Key[], t: number): number {
  const k = [...keys].reverse().find((key) => key.at <= t);
  return k ? Math.max(t, k.at + k.move) : t;
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
    const e = `(1-cos(PI*(t-${k.at.toFixed(3)})/${k.move.toFixed(3)}))/2`;
    out += `if(lt(t,${k.at.toFixed(3)}),${prev.toFixed(4)},if(lt(t,${(k.at + k.move).toFixed(3)}),${prev.toFixed(4)}+(${(v - prev).toFixed(4)})*${e},`;
    close += "))";
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
