import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { editBounds, EditSchema } from "../src/lib/runs/edit-run";
import { missingLineSlot } from "../src/lib/pipeline/cues";
import type { Cue } from "../src/lib/pipeline/schemas";

const REQUEST_ID = "remove-line-0001";

describe("edit request schema", () => {
  it("keeps the text form and adds a removal form", () => {
    const text = { cueId: "L4", text: "시뮬레이션 준비 완료.", start: 54.2, requestId: REQUEST_ID };
    assert.deepEqual(EditSchema.parse(text), text);
    const removal = { cueId: "L6", action: "remove", requestId: REQUEST_ID };
    assert.deepEqual(EditSchema.parse(removal), removal);
  });

  it("takes the omission index from an immutable result; clients cannot assign a cue or gap", () => {
    const add = {
      action: "add",
      missingIndex: 0,
      text: "자막, 준비 완료.",
      start: 54.2,
      requestId: REQUEST_ID,
    };
    assert.deepEqual(EditSchema.parse(add), add);
    for (const invalid of [
      { ...add, missingIndex: -1 },
      { ...add, gapId: "g1" },
      { ...add, cueId: "L1" },
    ])
      assert.equal(EditSchema.safeParse(invalid).success, false);
  });

  it("refuses a removal that also carries words, another action, or no request id", () => {
    const removal = { cueId: "L6", action: "remove", requestId: REQUEST_ID };
    for (const bad of [
      { ...removal, text: "망고 오픈 무비 프로젝트." },
      { ...removal, start: 4.5 },
      { ...removal, action: "delete" },
      { cueId: "L6", action: "remove" },
      { ...removal, cueId: "line-6" },
      { ...removal, requestId: "short" },
    ])
      assert.equal(EditSchema.safeParse(bad).success, false, JSON.stringify(bad));
  });

  it("still refuses a text edit without a start", () => {
    assert.equal(
      EditSchema.safeParse({ cueId: "L4", text: "a", requestId: REQUEST_ID }).success,
      false,
    );
  });
});

describe("placing a line next to a removed one", () => {
  const gaps = [{ id: "g1", start: 0, end: 10 }];
  const cues = (
    [
      { id: "L1", start: 1, seconds: 2, status: "fits" },
      { id: "L2", start: 4, status: "removed" },
      { id: "L3", start: 7, seconds: 2, status: "fits" },
    ] as const
  ).map((c) => ({ ...c, gapId: "g1", windowEnd: 10, versions: [] })) as Cue[];

  it("assigns a new ID and preserves space on both sides of an insertion", () => {
    const missing = { gapId: "g1", at: 3.1, what: "The title appears." };
    assert.deepEqual(missingLineSlot(missing, cues, gaps), {
      id: "L4",
      gapId: "g1",
      start: 3.3,
      windowEnd: 6.7,
    });
    assert.equal(missingLineSlot({ ...missing, at: 20 }, cues, gaps), "tooFar");
    assert.equal(
      missingLineSlot(missing, [{ ...cues[0], seconds: undefined }, ...cues.slice(1)], gaps),
      "noRoom",
    );
  });

  it("lets an editor put a removed line back between its neighbours' audio", () => {
    assert.deepEqual(editBounds(cues, gaps, "L2"), { min: 3, max: 7 });
  });

  it("does not let a removed line hold room for the lines around it", () => {
    assert.deepEqual(editBounds(cues, gaps, "L3"), { min: 3, max: 10 });
  });
});
