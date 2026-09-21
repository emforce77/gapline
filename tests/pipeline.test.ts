import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findGaps, MIN_GAP_SECONDS, SPEECH_GUARD_SECONDS } from "../src/lib/pipeline/gaps";
import { placeCues } from "../src/lib/pipeline/run";
import { spokenUnits, unitBudget } from "../src/lib/pipeline/length";
import { foldRun } from "../src/lib/pipeline/reduce";
import type { TimedRunEvent } from "../src/lib/pipeline/events";
import type { Cue } from "../src/lib/pipeline/schemas";
import { buildNarrationTrack, encodeWav, trimSilence } from "../src/lib/media/narration-track";
import { parseWav } from "../src/lib/media/wav";
import { parseSrt } from "../src/lib/srt";

describe("findGaps", () => {
  it("returns the clip minus guarded speech, keeping only usable windows", () => {
    const gaps = findGaps(
      {
        speech: [
          { start: 2, end: 4, speaker: "", text: "a" },
          { start: 4.8, end: 6, speaker: "", text: "b" }, // 0.8 s pause: too short to use
        ],
        sounds: [],
      },
      10,
    );
    assert.deepEqual(
      gaps.map((g) => [g.start, g.end]),
      [
        [0, 2 - SPEECH_GUARD_SECONDS],
        [6 + SPEECH_GUARD_SECONDS, 10],
      ],
    );
  });

  it("blocks protected sounds but lets narration duck under ambient ones", () => {
    const gaps = findGaps(
      {
        speech: [],
        sounds: [
          { start: 3, end: 4, label: "gunshot", kind: "protect" },
          { start: 0, end: 10, label: "music", kind: "ambient" },
        ],
      },
      10,
    );
    assert.equal(gaps.length, 2);
    assert.equal(gaps[0].end, 3 - SPEECH_GUARD_SECONDS);
    assert.equal(gaps[1].start, 4 + SPEECH_GUARD_SECONDS);
  });

  it("never returns a window shorter than the minimum", () => {
    const gaps = findGaps(
      { speech: [{ start: 1, end: 9.5, speaker: "", text: "x" }], sounds: [] },
      10,
    );
    assert.ok(gaps.every((g) => g.end - g.start >= MIN_GAP_SECONDS));
  });
});

describe("placeCues", () => {
  const gaps = [
    { id: "g1", start: 0, end: 10 },
    { id: "g2", start: 20, end: 22 },
  ];

  it("gives each line the room up to the next line in its gap", () => {
    const { placed } = placeCues(
      [
        { gapId: "g1", at: 6, text: "second" },
        { gapId: "g1", at: 1, text: "first" },
      ],
      gaps,
    );
    assert.deepEqual(
      placed.map((c) => [c.versions[0].text, c.start, c.windowEnd]),
      [
        ["first", 1, 6],
        ["second", 6, 10],
      ],
    );
  });

  it("drops a line with less than a second of room", () => {
    const { placed, dropped } = placeCues(
      [
        { gapId: "g2", at: 20, text: "fits" },
        { gapId: "g2", at: 21.5, text: "no room" },
      ],
      gaps,
    );
    assert.equal(placed.length, 1);
    assert.equal(dropped[0].droppedReason, "no_room");
  });

  it("moves a line into the gap that contains its start when the gap id is wrong", () => {
    const { placed } = placeCues([{ gapId: "g9", at: 20.2, text: "x" }], gaps);
    assert.equal(placed[0].gapId, "g2");
  });
});

describe("length budget", () => {
  it("counts Korean syllables without spaces or punctuation, and English words", () => {
    assert.equal(spokenUnits("로켓이 솟아오른다.", "ko"), 8);
    assert.equal(spokenUnits("The rocket climbs.", "en"), 3);
  });

  it("allows at least one unit and scales with the room", () => {
    assert.equal(unitBudget(0.1, "ko"), 1);
    assert.equal(unitBudget(2, "ko"), 10);
    assert.equal(unitBudget(2, "en"), 5);
  });
});

describe("narration audio", () => {
  const rate = 24000;
  const tone = (seconds: number) =>
    Int16Array.from({ length: seconds * rate }, (_, i) => Math.round(8000 * Math.sin(i / 10)));
  const silence = (seconds: number) => new Int16Array(seconds * rate);

  it("trims leading and trailing silence to the spoken length", () => {
    const pcm = new Int16Array([...silence(0.5), ...tone(1), ...silence(0.5)]);
    const trimmed = trimSilence(encodeWav(pcm, rate));
    assert.ok(Math.abs(trimmed.seconds - 1.08) < 0.02, `got ${trimmed.seconds}`);
  });

  it("lays lines on a clip-length track at their start times", () => {
    const line = trimSilence(encodeWav(tone(1), rate));
    const wav = buildNarrationTrack([{ start: 2, line }], 5, rate);
    const info = parseWav(wav);
    assert.equal(info.seconds, 5);
    const samples = new Int16Array(wav.buffer.slice(wav.byteOffset + info.dataOffset));
    assert.equal(samples[Math.round(1.5 * rate)], 0);
    assert.notEqual(samples[Math.round(2.5 * rate)], 0);
  });
});

describe("foldRun", () => {
  it("tracks a line from draft through rejection, rewrite and voicing", () => {
    const cue: Cue = {
      id: "L1",
      gapId: "g1",
      start: 1,
      windowEnd: 4,
      versions: [{ text: "We see a rocket.", by: "write", model: "m" }],
      status: "pending",
    };
    const events: TimedRunEvent[] = [
      {
        type: "run_started",
        runId: "r",
        language: "en",
        density: "standard",
        writerModel: "m",
        reviewerModel: "m",
        clipSeconds: 10,
        t: 0,
      },
      { type: "cue_written", cue, t: 1 },
      {
        type: "cue_reviewed",
        cueId: "L1",
        round: 1,
        verdict: {
          cueId: "L1",
          pass: false,
          violations: [{ rule: "viewer_frame", quote: "We see", reason: "r" }],
          fix: "f",
        },
        t: 2,
      },
      { type: "cue_revised", cueId: "L1", by: "revise", text: "A rocket rises.", model: "m", t: 3 },
      {
        type: "cue_reviewed",
        cueId: "L1",
        round: 2,
        verdict: { cueId: "L1", pass: true, violations: [], fix: "" },
        t: 4,
      },
      { type: "cue_voiced", cueId: "L1", seconds: 1.4, rate: 1, window: 3, fits: true, t: 5 },
    ];
    const view = foldRun(events, 10);
    const line = view.cues[0];
    assert.equal(line.status, "fits");
    assert.equal(line.versions.length, 2);
    assert.equal(line.versions[0].review?.pass, false);
    assert.equal(line.versions[1].voice?.seconds, 1.4);
  });
});

describe("parseSrt", () => {
  it("reads times and joins multi-line text", () => {
    const cues = parseSrt(
      "1\n00:00:23,000 --> 00:00:24,500\nYou're a jerk,\nThom.\n\n2\n00:01:00,250 --> 00:01:01,000\nHi",
    );
    assert.deepEqual(cues[0], { start: 23, end: 24.5, text: "You're a jerk, Thom." });
    assert.equal(cues[1].start, 60.25);
  });
});
