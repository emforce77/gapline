import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LANE_GAP_PX, stackCueBoxes } from "../src/components/workspace/lanes";

/** 24 px boxes at the left edges the 390 px workspace measured for the English sample's lines 5–7. */
const PHONE = [
  { id: "L5", left: 218, right: 242 },
  { id: "L6", left: 229, right: 253 },
  { id: "L7", left: 238, right: 262 },
];

describe("stackCueBoxes", () => {
  it("keeps boxes that do not touch on one lane", () => {
    const { lanes, count } = stackCueBoxes([
      { id: "a", left: 0, right: 24 },
      { id: "b", left: 24 + LANE_GAP_PX, right: 50 },
    ]);
    assert.equal(count, 1);
    assert.deepEqual([...lanes.values()], [0, 0]);
  });

  it("stacks boxes that would cover each other's numbers", () => {
    const { lanes, count } = stackCueBoxes(PHONE);
    assert.equal(count, 3);
    assert.deepEqual(Object.fromEntries(lanes), { L5: 0, L6: 1, L7: 2 });
  });

  it("returns to the first free lane once there is room again", () => {
    const { lanes, count } = stackCueBoxes([...PHONE, { id: "L8", left: 300, right: 324 }]);
    assert.equal(count, 3);
    assert.equal(lanes.get("L8"), 0);
  });

  it("reports one lane when there is nothing to place", () => {
    assert.equal(stackCueBoxes([]).count, 1);
  });
});
