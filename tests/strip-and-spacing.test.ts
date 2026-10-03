import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readKeyframeTimes } from "../src/lib/media/ffmpeg";
import {
  freeRoom,
  LINE_SPACING_SECONDS,
  MIN_ROOM_SECONDS,
  placeCues,
  roomEndBefore,
} from "../src/lib/pipeline/cues";
import { keyframeInEverySpan } from "../src/lib/store/ingest";

/** The head of ffmpeg 5.1's framecrc listing of a 1080p phone-style clip (QA round 3's clip89). */
const LISTING = `#extradata 0:       49, 0x84c71178
#software: Lavf59.27.100
#tb 0: 1/15360
#media_type 0: video
#codec_id 0: h264
#dimensions 0: 1920x1080
#sar 0: 1/1
0,      -1024,          0,      512,     1175, 0x9b3c1c6c
0,       -512,       2048,      512,       71, 0x327b05af, F=0x0
0,          0,       1024,      512,       68, 0xb77b03b4, F=0x0
0,      29184,      30720,      512,     1716, 0xc32c38a4
0,      29696,      29696,      512,      354, 0xb71b9946, F=0x0
0,      58880,      59392,      512,     1650, 0x0a1b2c3d, F=0x5
`;

describe("the timeline strip", () => {
  it("reads keyframe times from the packet listing: packets without flags are keyframes", () => {
    assert.deepEqual(readKeyframeTimes(LISTING), [0, 2]);
    assert.throws(() => readKeyframeTimes("0, 0, 0, 512, 10, 0x0\n"), /time base/);
  });

  it("decodes keyframes alone only when every thumbnail's span holds one", () => {
    // Keyframes off the grid but never more than 2 s apart (x264 restarts at scene cuts).
    const cuts = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 19.37, 21.37, 23, 25, 27, 28.93];
    assert.equal(keyframeInEverySpan(cuts, 2, 15), true);
    // Without 21.37 the span [20, 22) has none, so the strip decodes more than keyframes.
    assert.equal(
      keyframeInEverySpan(
        cuts.filter((t) => t !== 21.37),
        2,
        15,
      ),
      false,
    );
    // x264's default: a keyframe every 250 frames (8.3 s at 30 fps).
    assert.equal(keyframeInEverySpan([0, 8.33, 16.67], 1, 20), false);
    // The last span counts too.
    assert.equal(keyframeInEverySpan([0, 1, 2], 1, 4), false);
  });
});

describe("air between narration lines", () => {
  const gap = { id: "g1", start: 20, end: 36 };

  it("ends a line's room a moment before the next line starts", () => {
    // Sintel, QA round 3: a rewrite filled 27.5–29.99 s and the next line started at 30.0 s.
    const { placed } = placeCues(
      [
        { gapId: "g1", at: 27.5, text: "The red-haired woman watches with wide eyes." },
        { gapId: "g1", at: 30, text: "She looks up." },
      ],
      [gap],
    );
    assert.equal(placed[0].windowEnd, 30 - LINE_SPACING_SECONDS);
    assert.equal(placed[1].windowEnd, 36);
  });

  it("drops a line that would have less than a second before that moment", () => {
    const { placed, dropped } = placeCues(
      [
        { gapId: "g1", at: 21, text: "first" },
        { gapId: "g1", at: 21 + MIN_ROOM_SECONDS + LINE_SPACING_SECONDS / 2, text: "second" },
      ],
      [gap],
    );
    assert.deepEqual(
      dropped.map((c) => [c.versions[0].text, c.droppedReason]),
      [["first", "no_room"]],
    );
    assert.equal(placed.length, 1);
  });

  it("gives a line the room up to that moment when the run recomputes its windows", () => {
    // The fix stage's recomputeWindows and placeCues share this: same spacing, never negative.
    assert.equal(roomEndBefore(24, 30, gap.end), 30 - LINE_SPACING_SECONDS);
    assert.equal(roomEndBefore(24, undefined, gap.end), gap.end);
    // A line the reviewer added 0.1 s after another's start leaves that line no room, not -0.2 s.
    assert.equal(roomEndBefore(24, 24.1, gap.end), 24);
  });

  it("keeps the same air before the next voiced line when a line is added", () => {
    const room = freeRoom(24, gap, [
      { start: 21, end: 23 },
      { start: 30, end: 32 },
    ]);
    assert.deepEqual(room, { start: 24, end: 30 - LINE_SPACING_SECONDS });
  });
});
