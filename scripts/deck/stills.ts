/** Which film frames the deck uses, as seconds into the film. Slides refer to them by name. */
import { coverLine, newspaper } from "./data/city";
import { lineHistory, opening, seven } from "./data/demo";
import type { StillSpec } from "./film";

const FULL = 1920;
const THUMB = 480;
export const THUMB_COUNT = 8;

/**
 * One frame per shot of the seven-second strip, each inside its shot (checked below). The first shot
 * shows for under a second before the silence and the strip leaves it dark, so it has no frame.
 */
const SEVEN_FRAMES: (number | null)[] = [null, 55.0, 59.6];

const sevenShots = opening.shots.filter(
  (s) => s.end > seven.domain[0] && s.start < seven.domain[1],
);
if (sevenShots.length !== SEVEN_FRAMES.length)
  throw new Error("the seven-second strip no longer has three shots");
SEVEN_FRAMES.forEach((t, i) => {
  if (t !== null && (t < sevenShots[i].start || t >= sevenShots[i].end))
    throw new Error(`frame ${t}s is outside shot ${i + 1}`);
});

/** The reviewer slide's frame: inside the line it rejected, on the shot that shows SIMULATION READY. */
const READY_FRAME = 55.8;
const readyShot = opening.shots.find((s) => READY_FRAME >= s.start && READY_FRAME < s.end);
if (
  !readyShot ||
  !/SIMULATION READY/.test(readyShot.onScreenText) ||
  READY_FRAME < lineHistory.start ||
  READY_FRAME >= lineHistory.windowEnd
)
  throw new Error("the reviewer slide's frame is outside its line or its shot");

export const thumbTimes = Array.from({ length: THUMB_COUNT }, (_, i) => {
  const slot = opening.clip / THUMB_COUNT;
  return Math.round((slot * i + slot / 2) * 1000) / 1000;
});

export const STILL_SPECS: StillSpec[] = [
  { name: "cover", filmTime: coverLine.filmTime, width: FULL },
  ...SEVEN_FRAMES.flatMap((t, i) =>
    t === null ? [] : [{ name: `seven-${i}`, filmTime: t, width: FULL }],
  ),
  ...thumbTimes.map((t, i) => ({ name: `thumb-${i}`, filmTime: t, width: THUMB })),
  { name: "news", filmTime: newspaper.filmTime, width: FULL },
  { name: "ready", filmTime: READY_FRAME, width: FULL },
];

export const stillUrl = (name: string): string => {
  if (!STILL_SPECS.some((s) => s.name === name)) throw new Error(`unknown still ${name}`);
  return `assets/stills/${name}.jpg`;
};

export { sevenShots };
