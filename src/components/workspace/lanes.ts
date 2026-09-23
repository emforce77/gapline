/** A narration line's box on the timeline, in pixels from the left edge of the narration row. */
export interface CueBox {
  id: string;
  left: number;
  right: number;
}

/** Space kept between two boxes that share a lane, so their outlines never touch. */
export const LANE_GAP_PX = 2;

/**
 * Stacks boxes that would overlap on screen into lanes, first fit in time order. Lines never overlap
 * in time, but a phone gives the 65-second sample about 4 px per second while every box is at least
 * 24 px wide, so lines a few seconds apart would cover each other's numbers.
 */
export function stackCueBoxes(
  boxes: CueBox[],
  gap: number = LANE_GAP_PX,
): { lanes: Map<string, number>; count: number } {
  const ends: number[] = [];
  const lanes = new Map<string, number>();
  for (const box of [...boxes].sort((a, b) => a.left - b.left)) {
    let lane = ends.findIndex((end) => box.left >= end + gap);
    if (lane === -1) lane = ends.length;
    ends[lane] = box.right;
    lanes.set(box.id, lane);
  }
  return { lanes, count: Math.max(1, ends.length) };
}
