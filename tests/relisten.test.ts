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
  groupSegments,
  padSlice,
  placeLongSpans,
  PLACE_MAX_LEVELS,
  SLICE_PADDING_SECONDS,
  SLICES_IN_FLIGHT,
  speechCostUsd,
  timeChunkWords,
  UNPLACED_MAX_SECONDS,
  wordsInSlice,
  type RecognizeResponse,
  type SpanRecognizer,
  type Word,
} from "../src/lib/pipeline/hear";
import { foldRun } from "../src/lib/pipeline/reduce";
import {
  planRelisten,
  relistenGaps,
  RELISTEN_LEDGER_LABEL,
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
  ...padSlice(start, end, clip),
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
    near(slices[0].to, 2.07 + SLICE_PADDING_SECONDS);
    near(slices[1].from, 4.21 - SLICE_PADDING_SECONDS);
    near(slices[1].to, 6.59 + SLICE_PADDING_SECONDS);
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

describe("wordsInSlice", () => {
  const s = slice(4, 8);
  const heard = (words: [string, number, number][]) =>
    wordsInSlice(s, timeChunkWords(response(words, 5), s.from, s.to).words);

  it("maps slice-relative offsets to clip time and keeps every word that touches the gap", () => {
    const words = heard([
      ["tail", 0.1, 0.45], // 3.6–3.95: only in the left padding
      ["edge", 0.3, 0.7], // 3.8–4.2: crosses the gap start, kept whole
      ["middle", 2, 2.5], // 5.5–6.0
      ["late", 4.4, 4.6], // 7.9–8.1: crosses the gap end
      ["after", 4.55, 4.9], // 8.05–8.4: only in the right padding
    ]);
    assert.deepEqual(
      words.map((w) => w.word),
      ["edge", "middle", "late"],
    );
    near(words[0].start, 3.8);
    near(words[0].end, 4.2);
    near(words[1].start, 5.5);
    near(words[2].end, 8.1);
    assert.deepEqual(
      groupSegments(words).map((x) => x.text),
      ["edge", "middle", "late"],
    );
  });

  it("cuts a word at the slice edges, never beyond the audio that was sent", () => {
    const [word] = heard([["long", 4, 9]]); // 7.5–12.5 reported, longer than any word
    near(word.start, 7.5);
    near(word.end, s.end, "a span too long to be one word is cut to the part");
    const [short] = heard([["late", 4.2, 5.2]]); // 7.7–8.7, past the audio sent
    near(short.start, 7.7);
    near(short.end, s.to);
  });

  it("blocks untimed words up to their timed neighbours, inside the part", () => {
    const body: RecognizeResponse = {
      results: [
        {
          alternatives: [
            {
              words: [
                { word: "hm" },
                { word: "yes", startOffset: "1.5s", endOffset: "1.8s" },
                { word: "so" },
              ],
            },
          ],
        },
      ],
    };
    const words = wordsInSlice(s, timeChunkWords(body, s.from, s.to).words);
    assert.deepEqual(
      words.map((w) => [w.start, w.end, w.word, w.untimed ?? false]),
      [
        [4, 5, "hm", true], // from the slice start, cut to the part
        [5, 5.3, "yes", false],
        [5.3, 8, "so", true], // to the slice end, cut to the part
      ],
    );
  });

  it("finds nothing when the recognizer hears nothing, or only its annotations", () => {
    assert.deepEqual(wordsInSlice(s, []), []);
    const annotated = timeChunkWords(
      {
        results: [
          {
            alternatives: [
              {
                words: [
                  { word: "[" },
                  { word: "BACKGROUND]" },
                  { word: "[", startOffset: "1s", endOffset: "2s" },
                  { word: "]", startOffset: "2s", endOffset: "2.1s" },
                ],
              },
            ],
          },
        ],
      },
      s.from,
      s.to,
    );
    assert.deepEqual(annotated.annotations, ["[ BACKGROUND]", "[ ]"]);
    assert.equal(annotated.untimed, 0);
    assert.deepEqual(wordsInSlice(s, annotated.words), []);
  });
});

describe("placeLongSpans", () => {
  /** A recognizer that answers `answer(from, to)` in slice-relative offsets, and logs every call. */
  function recognizer(answer: (from: number, to: number) => RecognizeResponse["results"]) {
    const calls: [number, number][] = [];
    const recognize: SpanRecognizer = async (from, length) => {
      calls.push([from, from + length]);
      // No case here needs more than 30 requests: fail instead of hanging on a loop.
      if (calls.length > 64) throw new Error(`still asking after 64 requests: ${calls.slice(-4)}`);
      const billed = Math.ceil(length);
      return {
        ...timeChunkWords({ results: answer(from, from + length) }, from, from + length),
        billedSeconds: billed,
      };
    };
    return { recognize, calls };
  }
  const untimedAt = (at: number, token: string) => (from: number, to: number) =>
    from <= at && at < to ? [{ alternatives: [{ words: [{ word: token }] }] }] : [];

  it("bounds a lone untimed token to a few seconds instead of its whole chunk", async () => {
    // Chirp 3 on a 30 s music clip: a single ".7" with no timing (QA 2026-10-03, format-mov-30s).
    const [first] = timeChunkWords({ results: untimedAt(0, ".7")(0, 30.02) }, 0, 30.02).words;
    assert.deepEqual([first.start, first.end], [0, 30.02]);
    // Worst case: the recognizer hallucinates the token again wherever 17 s is in the audio.
    const { recognize, calls } = recognizer(untimedAt(17, ".7"));
    const placed = await placeLongSpans([first], recognize, 30.02);
    const blocked = placed.words.reduce((sum, w) => sum + w.end - w.start, 0);
    assert.ok(blocked <= UNPLACED_MAX_SECONDS + EPS, `blocked ${blocked} s`);
    assert.ok(placed.words.every((w) => w.start <= 17 + EPS && w.end >= 17 - 1 - EPS));
    // 30 → 15 → 7.5 → 3.75 s: two halves a level, and only halves that hear it again go on.
    assert.equal(calls.length, 6);
    assert.equal(placed.requests, 6);
    assert.equal(
      placed.billedSeconds,
      calls.reduce((sum, [from, to]) => sum + Math.ceil(to - from), 0),
    );
    for (const [from, to] of calls) assert.ok(from >= 0 && to <= 30.02);
  });

  it("frees the whole span when its halves hear nothing", async () => {
    const { recognize, calls } = recognizer(() => []);
    const words: Word[] = [{ start: 19.67, end: 37.17, word: "A day A day", untimed: true }];
    const placed = await placeLongSpans(words, recognize, 52.21);
    assert.deepEqual(placed.words, []);
    assert.equal(calls.length, 2);
    near(calls[0][0], 19.67 - SLICE_PADDING_SECONDS);
    near(calls[1][1], 37.17 + SLICE_PADDING_SECONDS);
  });

  it("places the words of a 'word' stretched over many seconds where the halves hear them", async () => {
    // Sintel trailer, first pass (2026-10-03): "What" 12.12–36.92 s; the line is spoken at 12–15 s.
    const { recognize } = recognizer((from, to) =>
      from <= 13 && 13 < to
        ? [
            {
              alternatives: [
                {
                  words: [
                    { word: "What", startOffset: `${13 - from}s`, endOffset: `${13.3 - from}s` },
                    {
                      word: "brings",
                      startOffset: `${13.3 - from}s`,
                      endOffset: `${13.7 - from}s`,
                    },
                  ],
                },
              ],
            },
          ]
        : [],
    );
    const placed = await placeLongSpans(
      [
        { start: 2, end: 3, word: "kept" },
        { start: 12.12, end: 36.92, word: "What" },
      ],
      recognize,
      52.21,
    );
    assert.deepEqual(
      placed.words.map((w) => [w.word, Math.round(w.start * 100) / 100]),
      [
        ["kept", 2],
        ["What", 13],
        ["brings", 13.3],
      ],
    );
  });

  it("joins overlapping long spans and keeps a word across the cut once", async () => {
    // Sintel first pass: "What" 12.12–36.92 s and "A" 19.92–36.96 s; both cover "I'm searching".
    const at = (word: string, start: number, end: number) => (from: number, to: number) =>
      from <= start && end <= to
        ? [{ word, startOffset: `${start - from}s`, endOffset: `${end - from}s` }]
        : [];
    const middle = (12.12 + 36.96) / 2;
    const heard = [at("searching", 19, 19.3), at("cut", middle - 0.2, middle + 0.2)];
    const { recognize, calls } = recognizer((from, to) => [
      { alternatives: [{ words: heard.flatMap((h) => h(from, to)) }] },
    ]);
    const placed = await placeLongSpans(
      [
        { start: 12.12, end: 36.92, word: "What" },
        { start: 19.92, end: 36.96, word: "A" },
      ],
      recognize,
      52.21,
    );
    assert.equal(calls.length, 2, "one span, two halves");
    assert.deepEqual(
      placed.words.map((w) => w.word),
      ["searching", "cut"],
    );
  });

  it("lets a word placed inside a re-heard span give way to the halves, but only where they hear", async () => {
    // Sintel first pass: "searching" 18.64–18.80 s sits inside "What" 12.12–36.92 s.
    const { recognize } = recognizer((from, to) =>
      from <= 18.6 && 18.9 <= to
        ? [
            {
              alternatives: [
                {
                  words: [
                    {
                      word: "searching",
                      startOffset: `${18.62 - from}s`,
                      endOffset: `${18.9 - from}s`,
                    },
                  ],
                },
              ],
            },
          ]
        : [],
    );
    const placed = await placeLongSpans(
      [
        { start: 12.12, end: 36.92, word: "What" },
        { start: 18.64, end: 18.8, word: "searching" },
        { start: 30, end: 30.4, word: "unheard" },
      ],
      recognize,
      52.21,
    );
    assert.deepEqual(
      placed.words.map((w) => [w.word, w.start]),
      [
        ["searching", 18.62],
        ["unheard", 30],
      ],
    );
  });

  it("keeps short untimed spans blocked without asking again", async () => {
    const words: Word[] = [{ start: 0, end: 1.24, word: "어쩔 수 없고요.", untimed: true }];
    const placed = await placeLongSpans(words, async () => assert.fail("nothing to place"), 40);
    assert.deepEqual(placed, { words, billedSeconds: 0, requests: 0 });
  });

  /** Blocked seconds, and every span short enough or one the last level left. */
  const blockedSeconds = (words: Word[]) => words.reduce((sum, w) => sum + w.end - w.start, 0);

  it("ends when every request answers with a token it cannot time", async () => {
    // Chirp 3 on music answers any audio with one untimed ".7" (QA 2026-10-03, format-mov-30s).
    const { recognize, calls } = recognizer(() => [
      { alternatives: [{ words: [{ word: ".7" }] }] },
    ]);
    const placed = await placeLongSpans(
      [{ start: 0, end: 30.02, word: ".7", untimed: true }],
      recognize,
      30.02,
    );
    // 30 → 15 → 7.5 → 3.75 s, every half answering again: 2 + 4 + 8 requests, all of it blocked.
    assert.equal(calls.length, 14);
    near(blockedSeconds(placed.words), 30.02);
    assert.ok(placed.words.every((w) => w.end - w.start <= UNPLACED_MAX_SECONDS + EPS));
  });

  it("ends when the token sits at the cut, where both halves' padding hears it", async () => {
    // Halves of 0–30.02 s meet at 15.01 s; each is sent with 0.5 s of the other.
    const { recognize, calls } = recognizer(untimedAt(15.2, ".7"));
    const placed = await placeLongSpans(
      [{ start: 0, end: 30.02, word: ".7", untimed: true }],
      recognize,
      30.02,
    );
    assert.equal(calls.length, 2 + 4 + 4);
    assert.ok(blockedSeconds(placed.words) <= 2 * UNPLACED_MAX_SECONDS + EPS);
    assert.ok(placed.words.every((w) => w.start <= 15.2 + EPS && w.end >= 15.2 - 4 - EPS));
  });

  it("ends when a stretched 'word' starts exactly at each cut", async () => {
    // Sintel "What" shape: every slice answers one timed word from its part's start to its end.
    const { recognize, calls } = recognizer((from, to) => [
      {
        alternatives: [
          {
            words: [
              {
                word: "What",
                startOffset: `${Math.min(SLICE_PADDING_SECONDS, to - from)}s`,
                endOffset: `${to - from}s`,
              },
            ],
          },
        ],
      },
    ]);
    const placed = await placeLongSpans(
      [{ start: 12.1, end: 36.9, word: "What" }],
      recognize,
      52.21,
    );
    assert.equal(calls.length, 14);
    assert.ok(placed.words.every((w) => w.end - w.start <= UNPLACED_MAX_SECONDS + EPS));
  });

  it(`stops after ${PLACE_MAX_LEVELS} levels and keeps what is still unplaced blocked`, async () => {
    // A 90 s upload whose two chunks both came back untimed: one span joined across the chunks.
    const { recognize, calls } = recognizer(() => [
      { alternatives: [{ words: [{ word: "♫" }, { word: "la" }] }] },
    ]);
    const placed = await placeLongSpans(
      [
        { start: 0, end: 52.5, word: "la", untimed: true },
        { start: 52.5, end: 90, word: "la", untimed: true },
      ],
      recognize,
      90,
    );
    assert.equal(calls.length, 2 + 4 + 8 + 16);
    // The last level's halves are 90 / 16 = 5.625 s: each still unplaced, each kept as it is.
    assert.equal(placed.words.length, 16);
    for (const w of placed.words) near(w.end - w.start, 90 / 16);
    near(blockedSeconds(placed.words), 90);
    for (const [from, to] of calls) assert.ok(to - from <= CHUNK_SECONDS);
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
    assert.equal(peak, SLICES_IN_FLIGHT);
  });

  it("fails the hearing when a slice fails, recording an unknown charge", async () => {
    const ledgerFile = join(await mkdtemp(join(tmpdir(), "scene-relisten-")), "ledger.jsonl");
    await assert.rejects(
      relistenGaps({
        speech: [{ start: 4, end: 5, speaker: "", text: "a word" }],
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

  it("does not send again the one request that heard a short clip with no speech", async () => {
    const ledgerFile = join(await mkdtemp(join(tmpdir(), "scene-relisten-")), "none.jsonl");
    const result = await relistenGaps({
      speech: [],
      clipSeconds: 30.02,
      ledgerFile,
      recognize: async () => assert.fail("the first pass heard this exact audio"),
    });
    assert.deepEqual(result, {
      speech: [],
      report: { gapsChecked: 1, wordsFound: 0, blockedSeconds: 0 },
    });
    // A clip longer than one request was heard in overlapping chunks: its silence is heard again.
    const { recognize, calls } = fixtureRecognizer([]);
    await relistenGaps({ speech: [], clipSeconds: 60.01, ledgerFile, recognize });
    assert.equal(calls.length, 2);
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
