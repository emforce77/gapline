import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCallRecords } from "../src/lib/llm/ledger";
import { MIN_ROOM_SECONDS, placeCues } from "../src/lib/pipeline/cues";
import type { TimedRunEvent } from "../src/lib/pipeline/events";
import { findGaps, MIN_GAP_SECONDS } from "../src/lib/pipeline/gaps";
import {
  CHUNK_SECONDS,
  speechCostUsd,
  timeChunkWords,
  type RecognizeResponse,
  type RecognizedChunk,
  type SpanRecognizer,
} from "../src/lib/pipeline/hear";
import { foldRun } from "../src/lib/pipeline/reduce";
import {
  planRelisten,
  relistenGaps,
  RELISTEN_CONCURRENCY,
  RELISTEN_LEDGER_LABEL,
  RELISTEN_PADDING_SECONDS,
  speechInSlice,
  type RelistenSlice,
} from "../src/lib/pipeline/relisten";
import type { DraftCue, Gap, SpeechSegment } from "../src/lib/pipeline/schemas";
import { validateAnalysis } from "../src/lib/store/analysis";

const EPS = 1e-9;
const near = (actual: number, expected: number, message?: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `${actual} ≠ ${expected}`);

/** Chirp 3 response with slice-relative word offsets, as the API returns them. */
function response(words: [string, number, number][], billed: number): RecognizeResponse {
  return {
    results: [
      {
        alternatives: [
          {
            words: words.map(([word, start, end]) => ({
              word,
              startOffset: `${start}s`,
              endOffset: `${end}s`,
            })),
          },
        ],
      },
    ],
    metadata: { totalBilledDuration: `${billed}s` },
  };
}

/** A recognizer answering from fixtures by slice start; unknown slices hear nothing. */
function fixtureRecognizer(bodies: { from: number; response: RecognizeResponse }[]) {
  const calls: { from: number; length: number }[] = [];
  const recognize: SpanRecognizer = async (from, length) => {
    calls.push({ from, length });
    const body = bodies.find((b) => Math.abs(b.from - from) < 1e-6)?.response ?? {
      results: [],
      metadata: { totalBilledDuration: `${Math.ceil(length)}s` },
    };
    const billed = Number(body.metadata!.totalBilledDuration!.replace("s", ""));
    return { ...timeChunkWords(body, from, from + length), billedSeconds: billed };
  };
  return { recognize, calls };
}

const slice = (start: number, end: number, clip = 20): RelistenSlice => ({
  gapId: "g1",
  start,
  end,
  from: Math.max(0, start - RELISTEN_PADDING_SECONDS),
  to: Math.min(clip, end + RELISTEN_PADDING_SECONDS),
});

describe("planRelisten", () => {
  it("pads each usable gap on both sides, inside the clip, and skips short ones", () => {
    const gaps: Gap[] = [
      { id: "g1", start: 0, end: 2.07 },
      { id: "g2", start: 4.21, end: 6.59 },
      { id: "g3", start: 8, end: 8 + MIN_GAP_SECONDS - 0.01 },
      { id: "g4", start: 62.65, end: 65 },
    ];
    const slices = planRelisten(gaps, 65);
    assert.deepEqual(
      slices.map((s) => s.gapId),
      ["g1", "g2", "g4"],
    );
    near(slices[0].from, 0, "clip start bounds the left padding");
    near(slices[0].to, 2.07 + RELISTEN_PADDING_SECONDS);
    near(slices[1].from, 4.21 - RELISTEN_PADDING_SECONDS);
    near(slices[1].to, 6.59 + RELISTEN_PADDING_SECONDS);
    near(slices[2].to, 65, "clip end bounds the right padding");
    for (const [s, g] of [
      [slices[1], gaps[1]],
      [slices[2], gaps[3]],
    ] as const) {
      near(s.start, g.start);
      near(s.end, g.end);
    }
  });

  it("splits a silence too long for one request into padded parts that cover it", () => {
    const slices = planRelisten([{ id: "g1", start: 0, end: 90 }], 90);
    assert.equal(slices.length, 2);
    assert.ok(slices.every((s) => s.to - s.from <= CHUNK_SECONDS + EPS));
    near(slices[0].start, 0);
    near(slices[0].end, slices[1].start);
    near(slices[1].end, 90);
  });
});

describe("speechInSlice", () => {
  const s = slice(4, 8);
  const chunk = (words: [string, number, number][]): RecognizedChunk => ({
    ...timeChunkWords(response(words, 5), s.from, s.to),
    billedSeconds: 5,
  });

  it("maps slice-relative offsets to clip time and keeps every word that touches the gap", () => {
    const { segments, words } = speechInSlice(
      s,
      chunk([
        ["tail", 0.1, 0.45], // 3.6–3.95: only in the left padding
        ["edge", 0.3, 0.7], // 3.8–4.2: crosses the gap start, kept whole
        ["middle", 2, 2.5], // 5.5–6.0
        ["late", 4.4, 4.6], // 7.9–8.1: crosses the gap end
        ["after", 4.55, 4.9], // 8.05–8.4: only in the right padding
      ]),
    );
    assert.equal(words, 3);
    assert.deepEqual(
      segments.map((x) => [x.text, x.heard]),
      [
        ["edge", "relisten"],
        ["middle", "relisten"],
        ["late", "relisten"],
      ],
    );
    near(segments[0].start, 3.8);
    near(segments[0].end, 4.2);
    near(segments[1].start, 5.5);
    near(segments[2].end, 8.1);
  });

  it("cuts a word at the slice edges, never beyond the audio that was sent", () => {
    const { segments } = speechInSlice(s, chunk([["long", 4, 9]])); // 7.5–12.5 reported
    near(segments[0].start, 7.5);
    near(segments[0].end, s.to);
  });

  it("blocks the whole part of the silence when any word comes back without timing", () => {
    const { segments, words } = speechInSlice(s, {
      ...timeChunkWords(
        {
          results: [
            {
              alternatives: [
                {
                  words: [{ word: "hm" }, { word: "yes", startOffset: "0.1s", endOffset: "0.3s" }],
                },
              ],
            },
          ],
        },
        s.from,
        s.to,
      ),
      billedSeconds: 5,
    });
    assert.equal(words, 2);
    assert.deepEqual(segments, [
      { start: 4, end: 8, speaker: "", text: "hm yes", heard: "relisten" },
    ]);
    assert.doesNotThrow(() => validateAnalysis({ speech: segments }, 20));
  });

  it("finds nothing when the recognizer hears nothing", () => {
    assert.deepEqual(speechInSlice(s, { words: [], untimed: 0, billedSeconds: 5 }), {
      segments: [],
      words: 0,
    });
  });
});

describe("relistenGaps", () => {
  it("regression: the launch call Chirp 3 put 2 s early closes the showcase gap g2", async () => {
    const fixture = JSON.parse(
      await readFile(join(process.cwd(), "tests/fixtures/tos-opening-relisten.json"), "utf8"),
    ) as {
      clipSeconds: number;
      firstPass: SpeechSegment[];
      showcaseGap: Gap;
      showcaseLine: DraftCue;
      relisten: { from: number; response: RecognizeResponse }[];
    };
    const clip = fixture.clipSeconds;
    const before = findGaps({ speech: fixture.firstPass, sounds: [] }, clip);
    assert.deepEqual(
      before.find((g) => g.id === "g2"),
      fixture.showcaseGap,
      "the first pass leaves 4.21–6.59 s looking silent",
    );
    assert.equal(placeCues([fixture.showcaseLine], before).placed.length, 1);

    const ledgerFile = join(await mkdtemp(join(tmpdir(), "scene-relisten-")), "ledger.jsonl");
    const { recognize, calls } = fixtureRecognizer(fixture.relisten);
    const { speech, report } = await relistenGaps({
      speech: fixture.firstPass,
      clipSeconds: clip,
      ledgerFile,
      recognize,
    });

    assert.equal(calls.length, before.length, "every usable silence is heard again");
    const g2Call = calls.find((c) => Math.abs(c.from - 3.71) < 1e-6)!;
    near(g2Call.length, 7.09 - 3.71);
    const found = speech.filter((s) => s.heard === "relisten");
    assert.equal(found.length, 1);
    assert.equal(found[0].text, "We have main engine start.");
    near(found[0].start, 4.4);
    near(found[0].end, 6.16);
    assert.equal(speech.length, fixture.firstPass.length + 1, "the first pass is kept as heard");

    const after = findGaps({ speech, sounds: [] }, clip);
    const { start, end } = fixture.showcaseGap;
    const roomLeft = Math.max(
      0,
      ...after.map((g) => Math.min(g.end, end) - Math.max(g.start, start)),
    );
    assert.ok(roomLeft < MIN_ROOM_SECONDS, `room left in 4.21–6.59 s: ${roomLeft} s`);
    const placed = placeCues([fixture.showcaseLine], after);
    assert.deepEqual(placed.placed, []);
    assert.equal(placed.dropped[0].droppedReason, "invalid_placement");
    assert.deepEqual(report, { gapsChecked: before.length, wordsFound: 5, blockedSeconds: 2.38 });

    const [record] = await readCallRecords(ledgerFile);
    const billed = calls.reduce(
      (s, c) => s + (Math.abs(c.from - 3.71) < 1e-6 ? 3 : Math.ceil(c.length)),
      0,
    );
    assert.equal(record.label, RELISTEN_LEDGER_LABEL);
    assert.equal(record.billedSeconds, billed);
    near(record.costUsd, speechCostUsd(billed));
    assert.equal(record.costKnown, true);
  });

  it("recognizes a few slices at a time, never more than its cap", async () => {
    let inFlight = 0;
    let peak = 0;
    const recognize: SpanRecognizer = async () => {
      peak = Math.max(peak, ++inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return { words: [], untimed: 0, billedSeconds: 2 };
    };
    const speech = Array.from({ length: 8 }, (_, i) => ({
      start: i * 5 + 2,
      end: i * 5 + 3,
      speaker: "",
      text: "a",
    }));
    const ledgerFile = join(await mkdtemp(join(tmpdir(), "scene-relisten-")), "ledger.jsonl");
    const { report } = await relistenGaps({ speech, clipSeconds: 40, ledgerFile, recognize });
    assert.equal(report.gapsChecked, 9);
    assert.equal(peak, RELISTEN_CONCURRENCY);
  });

  it("fails the hearing when a slice fails, recording an unknown charge", async () => {
    const ledgerFile = join(await mkdtemp(join(tmpdir(), "scene-relisten-")), "ledger.jsonl");
    await assert.rejects(
      relistenGaps({
        speech: [],
        clipSeconds: 10,
        ledgerFile,
        recognize: async () => {
          throw new Error("fixture STT failure");
        },
      }),
      /fixture STT failure/,
    );
    const [record] = await readCallRecords(ledgerFile);
    assert.equal(record.ok, false);
    assert.equal(record.costKnown, false);
  });

  it("makes no call when no silence is long enough to hold a line", async () => {
    const ledgerFile = join(await mkdtemp(join(tmpdir(), "scene-relisten-")), "missing.jsonl");
    const speech = [{ start: 0.1, end: 4.9, speaker: "", text: "talking" }];
    const result = await relistenGaps({
      speech,
      clipSeconds: 5,
      ledgerFile,
      recognize: async () => assert.fail("no slice to hear"),
    });
    assert.deepEqual(result, {
      speech,
      report: { gapsChecked: 0, wordsFound: 0, blockedSeconds: 0 },
    });
  });
});

describe("re-listen in the run view", () => {
  const started: TimedRunEvent = {
    type: "run_started",
    runId: "r",
    language: "en",
    density: "standard",
    writerModel: "m",
    reviewerModel: "m",
    clipSeconds: 10,
    t: 0,
  };

  it("shows this run's re-listen as a step with what it found", () => {
    const view = foldRun(
      [
        started,
        { type: "stage", stage: "relisten", state: "started", t: 1 },
        { type: "stage", stage: "relisten", state: "done", seconds: 0.8, t: 2 },
        { type: "relisten", gapsChecked: 6, wordsFound: 5, blockedSeconds: 2.38, t: 2 },
        { type: "speech", segments: [], relistened: true, t: 3 },
      ],
      10,
    );
    assert.equal(view.stages.relisten.state, "done");
    assert.deepEqual(view.relisten, { gapsChecked: 6, wordsFound: 5, blockedSeconds: 2.38 });
  });

  it("marks a reused re-listened analysis as reused, and older runs as never re-listened", () => {
    const reused = foldRun([started, { type: "speech", segments: [], relistened: true, t: 1 }], 10);
    assert.equal(reused.stages.hear.state, "reused");
    assert.equal(reused.stages.relisten.state, "reused");
    const older = foldRun([started, { type: "speech", segments: [], t: 1 }], 10);
    assert.equal(older.stages.hear.state, "reused");
    assert.equal(older.stages.relisten.state, "waiting");
    assert.equal(older.relisten, null);
  });
});
