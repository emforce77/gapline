import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { it } from "node:test";
import { readCallRecords } from "../src/lib/llm/ledger";
import { extractStill } from "../src/lib/media/extract-still";
import { withScratchDir } from "../src/lib/media/ffmpeg";
import type { ClipContext } from "../src/lib/pipeline/context";
import { RUN_FILES, summarizeRun } from "../src/lib/pipeline/finish-run";
import { lineFrameTimes, type LineStills } from "../src/lib/pipeline/line-stills";
import { foldRun } from "../src/lib/pipeline/reduce";
import { reviewLines } from "../src/lib/pipeline/review";
import { describeFailure } from "../src/lib/runs/failure";
import { withFetch } from "./with-fetch";

const context: ClipContext = {
  language: "en",
  density: "standard",
  clipSeconds: 65,
  speech: [],
  scene: { shots: [], characters: [], sounds: [] },
  gaps: [],
  videoDataUrl: "data:video/mp4;base64,dmlkZW8=",
};

const review = {
  context,
  model: "gemini-3.8-flash",
  label: "review:final",
  lines: [{ id: "L6", start: 56.7, end: 60, text: "A man enters." }],
  finalOutput: true,
  approved: [],
  wholeScript: true,
};

it("uses the voiced duration when available and keeps both frames inside a short room", () => {
  const cue = { id: "L6", start: 2, windowEnd: 8 };
  assert.deepEqual(lineFrameTimes({ ...cue, seconds: 2 }), [
    { moment: "start", at: 2.5 },
    { moment: "voice_end", at: 3.9 },
  ]);
  assert.deepEqual(lineFrameTimes(cue), [
    { moment: "start", at: 2.5 },
    { moment: "room_end", at: 7.9 },
  ]);
  assert.deepEqual(
    lineFrameTimes({ ...cue, seconds: 0.05 }).map(({ at }) => at),
    [2, 2],
  );
  assert.throws(() => lineFrameTimes({ ...cue, seconds: 0 }), /Invalid frame window/);
});

it("requires a pair for each reviewed line before sending the request", async () => {
  await assert.rejects(
    reviewLines({ ...review, frames: new Map(), ledgerFile: "" }),
    /Missing review frames for L6/,
  );
});

it("reports missing ffmpeg as a media failure", async () => {
  const previous = process.env.FFMPEG_PATH;
  process.env.FFMPEG_PATH = "/no-such-directory/ffmpeg";
  try {
    await assert.rejects(
      extractStill("unused.mp4", 1),
      (error) => describeFailure(error).code === "media_failed",
    );
  } finally {
    if (previous === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previous;
  }
});

it("labels each source picture and retains only its time and moment in the saved final verdict", async () => {
  await withScratchDir(async (dir) => {
    const frames: LineStills = new Map([
      [
        "L6",
        [
          { moment: "start", at: 57.2, jpeg: Buffer.from([1]) },
          { moment: "voice_end", at: 59.9, jpeg: Buffer.from([2]) },
        ],
      ],
    ]);
    const ledgerFile = join(dir, "ledger.jsonl");
    const finalReview = await withFetch(
      async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const parts = body.contents[0].parts;
        assert.deepEqual(parts.slice(0, -1), [
          { inlineData: { mimeType: "video/mp4", data: "dmlkZW8=" } },
          { text: "L6 · just after it starts · 57.20 s" },
          { inlineData: { mimeType: "image/jpeg", data: "AQ==" } },
          { text: "L6 · as the voice ends · 59.90 s" },
          { inlineData: { mimeType: "image/jpeg", data: "Ag==" } },
        ]);
        assert.match(parts.at(-1).text, /A man enters\./);
        assert.doesNotMatch(
          JSON.stringify(body.generationConfig.responseFormat.text.schema),
          /"frames"/,
        );
        const data = {
          verdicts: [{ cueId: "L6", pass: true, violations: [], fix: "" }],
          missing: [],
        };
        return new Response(
          "data: " +
            JSON.stringify({
              candidates: [
                { content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: "STOP" },
              ],
            }) +
            "\n\n",
        );
      },
      () => reviewLines({ ...review, frames, ledgerFile }),
    );
    const summary = summarizeRun({
      calls: await readCallRecords(ledgerFile),
      cues: [],
      shipped: [],
      finalReview,
      clipSeconds: 65,
      analysisReused: { speech: true, scene: true },
      gaps: [],
      room: { gapSeconds: 0, little: false },
      speech: [],
      wallSeconds: 2,
    });
    const file = join(dir, RUN_FILES.script);
    await writeFile(file, JSON.stringify({ summary, cues: [] }));
    const saved = JSON.parse(await readFile(file, "utf8"));
    const view = foldRun([{ ...saved, type: "run_done", files: RUN_FILES, t: 2 }], 65);
    assert.deepEqual(view.summary?.finalReview?.verdicts[0].frames, [
      { moment: "start", at: 57.2 },
      { moment: "voice_end", at: 59.9 },
    ]);
  });
});
