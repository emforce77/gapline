import { extractStill } from "../media/extract-still";
import { mapLimit } from "./map-limit";
import type { Cue, ReviewFrame } from "./schemas";

type LineWindow = Pick<Cue, "id" | "start" | "seconds" | "windowEnd">;
export interface LineStill extends ReviewFrame {
  jpeg: Buffer;
}
export type LineStills = ReadonlyMap<string, readonly [LineStill, LineStill]>;

/** Allow the opening cut to land, then sample just before the voice (or available room) ends. */
export function lineFrameTimes(cue: LineWindow): [ReviewFrame, ReviewFrame] {
  const end = cue.seconds === undefined ? cue.windowEnd : cue.start + cue.seconds;
  if (!Number.isFinite(cue.start) || !Number.isFinite(end) || cue.start < 0 || end <= cue.start)
    throw new RangeError(`Invalid frame window for ${cue.id}`);
  const last = Math.max(cue.start, end - 0.1);
  return [
    { moment: "start", at: Math.min(cue.start + 0.5, last) },
    { moment: cue.seconds === undefined ? "room_end" : "voice_end", at: last },
  ];
}

/** Decode at most four pictures at once across the whole set of lines. */
export async function extractLineStills(
  clipFile: string,
  cues: LineWindow[],
): Promise<Map<string, [LineStill, LineStill]>> {
  const moments = cues.flatMap(lineFrameTimes);
  const stills = await mapLimit(moments, 4, async (frame) => ({
    ...frame,
    jpeg: await extractStill(clipFile, frame.at),
  }));
  return new Map(cues.map((cue, i) => [cue.id, [stills[2 * i], stills[2 * i + 1]]]));
}
