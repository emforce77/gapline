import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pictureSlots } from "../src/components/picture-lane";
import { readResult } from "../src/components/workspace/result-notes";
import {
  knownMissingFiles,
  probeRunFile,
  probeRunFiles,
  type RunFileState,
} from "../src/components/workspace/run-files";
import {
  dialogueLang,
  narrationText,
  spokenDuration,
} from "../src/components/workspace/text-tracks";
import { en } from "../src/i18n/en";
import { formatClock } from "../src/lib/format";
import { ko } from "../src/i18n/ko";
import { webVtt } from "../src/lib/srt";
import type { RunSummary } from "../src/lib/pipeline/events";
import type { Cue, Gap, Verdict } from "../src/lib/pipeline/schemas";

const cue = (id: string, start: number, status: Cue["status"], text = `${id} text`): Cue => ({
  id,
  gapId: "g1",
  start,
  windowEnd: start + 3,
  versions: [{ text, by: "write", model: "m" }],
  status,
  seconds: 2,
});
const failing = (cueId: string): Verdict => ({
  cueId,
  pass: false,
  violations: [{ rule: "unseen", quote: "x", reason: "y" }],
  fix: "Say what is on screen.",
});
const summary = (over: Partial<RunSummary>): RunSummary => ({
  clipSeconds: 65,
  gapCount: 5,
  gapSeconds: 27.5,
  cuesWritten: 7,
  cuesShipped: 7,
  cuesDropped: 0,
  cuesRejected: 0,
  violationsByRule: {},
  cuesFitting: 7,
  narrationSeconds: 20,
  overlapWithSpeechSeconds: 0,
  costUsd: 0.2,
  costByStage: {},
  wallSeconds: 300,
  llmCalls: 10,
  ...over,
});
/** 27.5 s of room in a 65 s clip, the sample's measure: well above the little-room threshold. */
const ROOMY: Gap[] = [{ id: "g1", start: 10, end: 37.5 }];

describe("readResult", () => {
  it("does not call a result with no voiced line a pass", () => {
    const reading = readResult(
      summary({
        cuesShipped: 0,
        cuesDropped: 2,
        qualityStatus: "model_checked",
        finalReview: { verdicts: [], missing: [] },
      }),
      [cue("L1", 1, "dropped"), cue("L2", 1, "dropped")],
      ROOMY,
    );
    assert.equal(reading.coverage, "none");
    assert.equal(reading.noLines, "dropped");
  });

  it("names why nothing was described", () => {
    const none = { cuesShipped: 0 };
    assert.equal(readResult(summary({ ...none, gapCount: 0 }), [], []).noLines, "no_room");
    assert.equal(readResult(summary(none), [], ROOMY).noLines, "unwritten");
    assert.equal(readResult(summary(none), [cue("L1", 1, "removed")], ROOMY).noLines, "removed");
  });

  it("reports little coverage by the little-room rule, from the saved gaps", () => {
    const reading = readResult(
      summary({ clipSeconds: 60, gapSeconds: 2.5, cuesShipped: 1 }),
      [cue("L1", 1, "fits")],
      [{ id: "g1", start: 0, end: 2.5 }],
    );
    assert.equal(reading.coverage, "little");
    assert.equal(readResult(summary({}), [cue("L1", 1, "fits")], ROOMY).coverage, "enough");
  });

  it("calls 4.76 s of room in a 60 s clip little, though the final check lists nothing", () => {
    // The QA's BBB result: 7.9% of the clip had room, one line was voiced, and it read as a pass.
    const reading = readResult(
      summary({
        clipSeconds: 60,
        gapSeconds: 4.76,
        cuesShipped: 1,
        qualityStatus: "model_checked",
        finalReview: { verdicts: [], missing: [] },
      }),
      [cue("L1", 1, "fits")],
      [
        { id: "g1", start: 0, end: 2.38 },
        { id: "g2", start: 30, end: 32.38 },
      ],
    );
    assert.equal(reading.coverage, "little");
  });

  it("notes lines dropped before the final check, so 1 of 8 voiced is not a clean pass", () => {
    const dropped = Array.from({ length: 7 }, (_, i) => ({
      ...cue(`L${i + 2}`, 2 + i * 4, "dropped"),
      droppedReason: "too_long" as const,
    }));
    const reading = readResult(
      summary({
        clipSeconds: 60,
        gapSeconds: 30,
        cuesWritten: 8,
        cuesShipped: 1,
        cuesDropped: 7,
        qualityStatus: "model_checked",
        finalReview: { verdicts: [], missing: [] },
      }),
      [cue("L1", 1, "fits"), ...dropped],
      [{ id: "g1", start: 0, end: 30 }],
    );
    assert.equal(reading.coverage, "enough");
    assert.equal(reading.notes, true);
    assert.equal(reading.unvoiced.length, 7);
    assert.equal(reading.takenOut.length, 0);
  });

  it("lists a failing verdict on a dropped line as taken out, not as a flag on the track", () => {
    const cues = [cue("L1", 1, "dropped"), cue("L2", 5, "fits")];
    const reading = readResult(
      summary({ finalReview: { verdicts: [failing("L1"), failing("L2")], missing: [] } }),
      cues,
      ROOMY,
    );
    assert.deepEqual(
      reading.flagged.map((f) => f.cue.id),
      ["L2"],
    );
    assert.deepEqual(
      reading.takenOut.map((f) => f.cue.id),
      ["L1"],
    );
    assert.deepEqual(reading.unvoiced, []);
    assert.equal(reading.notes, true);
  });

  it("has no notes when the check lists nothing", () => {
    const reading = readResult(
      summary({ finalReview: { verdicts: [], missing: [] } }),
      [cue("L1", 1, "fits")],
      ROOMY,
    );
    assert.equal(reading.notes, false);
  });
});

describe("probeRunFile", () => {
  const answers = (...statuses: number[]) => {
    const calls: string[] = [];
    const fetchFile = async (url: string) => {
      calls.push(url);
      return new Response(null, { status: statuses[calls.length - 1] });
    };
    return { calls, fetchFile };
  };
  const noWait = async () => {};

  it("reads a 206 as present and only a 404 as missing", async () => {
    assert.equal(await probeRunFile("/a", { ...answers(206), wait: noWait }), "present");
    assert.equal(await probeRunFile("/a", { ...answers(404), wait: noWait }), "missing");
  });

  it("asks again after a busy answer instead of calling the file missing", async () => {
    const waits: number[] = [];
    const probe = answers(429, 503, 206);
    const state = await probeRunFile("/a", {
      fetchFile: probe.fetchFile,
      wait: async (ms) => void waits.push(ms),
      delays: [1, 2, 4],
    });
    assert.equal(state, "present");
    assert.deepEqual(waits, [1, 2]);
    assert.equal(probe.calls.length, 3);
  });

  it("leaves a file unknown when the server stays busy or fails otherwise", async () => {
    const busy = answers(429, 429, 429, 429);
    assert.equal(
      await probeRunFile("/a", { fetchFile: busy.fetchFile, wait: noWait, delays: [1, 2, 4] }),
      "unknown",
    );
    assert.equal(busy.calls.length, 4);
    const refused = answers(403);
    assert.equal(
      await probeRunFile("/a", { fetchFile: refused.fetchFile, wait: noWait }),
      "unknown",
    );
    assert.equal(refused.calls.length, 1);
  });

  it("retries the same answers as every other read of a run, a storage 500 included", async () => {
    const storage = answers(500, 206);
    assert.equal(
      await probeRunFile("/a", { fetchFile: storage.fetchFile, wait: noWait }),
      "present",
    );
    assert.equal(storage.calls.length, 2);
  });
});

describe("probeRunFiles", () => {
  const files = { described: "described.mp4", narration: "narration.wav" };
  const counting = (states: Record<string, RunFileState>) => {
    const calls: string[] = [];
    const probe = async (url: string) => {
      calls.push(url);
      return states[url.split("/").at(-1)!];
    };
    return { calls, probe };
  };

  it("probes a run once, even when asked again while the first probe is under way", async () => {
    const { calls, probe } = counting({ "described.mp4": "present", "narration.wav": "missing" });
    const [first, second] = await Promise.all([
      probeRunFiles("/runs/once", files, probe),
      probeRunFiles("/runs/once", files, probe),
    ]);
    assert.deepEqual([...first], ["narration"]);
    assert.equal(second, first);
    assert.deepEqual([...(await probeRunFiles("/runs/once", files, probe))], ["narration"]);
    assert.equal(calls.length, 2, "one request per file, however often the run is asked for");
    assert.deepEqual([...knownMissingFiles("/runs/once")!], ["narration"]);
  });

  it("keeps no answer for a run with a file of unknown state, so it is probed again", async () => {
    const { calls, probe } = counting({ "described.mp4": "unknown", "narration.wav": "present" });
    await probeRunFiles("/runs/busy", files, probe);
    assert.equal(knownMissingFiles("/runs/busy"), undefined);
    await probeRunFiles("/runs/busy", files, probe);
    assert.equal(calls.length, 4);
  });
});

describe("player text tracks", () => {
  it("writes heard lines as WebVTT in time order, like the run's descriptions.vtt", () => {
    const cues = [
      cue("L2", 61.25, "fits", "Later."),
      cue("L1", 11.2, "fits", "First."),
      cue("L3", 30, "dropped"),
    ];
    assert.equal(
      webVtt(narrationText(cues)),
      "WEBVTT\n\n1\n00:00:11.200 --> 00:00:13.200\nFirst.\n\n2\n00:01:01.250 --> 00:01:03.250\nLater.\n",
    );
  });

  it("keeps an edited line with a blank line or markup as one escaped cue", () => {
    const vtt = webVtt(
      narrationText([cue("L1", 1, "fits", "She waves.\n\nHe turns -> to the <door> & leaves.")]),
    );
    assert.equal(
      vtt,
      "WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nShe waves. He turns -&gt; to the &lt;door&gt; &amp; leaves.\n",
    );
  });

  it("does not pass the recognizer's 'auto' off as a language tag", () => {
    assert.equal(dialogueLang("auto"), "");
    assert.equal(dialogueLang("en-US"), "en-US");
  });

  it("shows the clock with tenths and never a 60th second", () => {
    assert.equal(formatClock(7.44), "0:07.4");
    assert.equal(formatClock(59.96), "1:00.0");
    assert.equal(formatClock(65.03), "1:05.0");
  });

  it("speaks the slider position in words, whole seconds", () => {
    assert.equal(spokenDuration(15.4, "en"), "15 seconds");
    assert.equal(spokenDuration(65.03, "en"), "1 minute 5 seconds");
    assert.equal(spokenDuration(65.03, "ko"), "1분 5초");
  });
});

describe("pictureSlots", () => {
  /** The sample: 33 thumbnails of 172×72 (2.39:1) for 65 s at 2 s each. */
  const SAMPLE = { clipSeconds: 65, stepSeconds: 2, stripWidth: 5676, stripHeight: 72 };
  /** A 9:16 clip: 15 thumbnails of 40×72 for 15 s. */
  const PORTRAIT = { clipSeconds: 15, stepSeconds: 1, stripWidth: 600, stripHeight: 72 };

  const check = (slots: ReturnType<typeof pictureSlots>, laneWidth: number, tileAspect: number) => {
    assert.equal(
      slots.reduce((sum, s) => sum + s.width, 0),
      laneWidth,
    );
    for (const s of slots) {
      const tiles = Math.round(s.image.width / (s.image.height * tileAspect));
      // Drawn at the thumbnail's own shape, and covering its slot.
      assert.ok(Math.abs(s.image.width / tiles / s.image.height - tileAspect) < 1e-9);
      assert.ok(s.image.width / tiles >= s.width - 1e-9);
      assert.ok(s.image.height >= 48 - 1e-9);
    }
  };

  it("shows whole widescreen frames, as many as fit the lane", () => {
    const desktop = pictureSlots({ laneWidth: 848, laneHeight: 48, ...SAMPLE });
    assert.equal(desktop.length, 7);
    check(desktop, 848, 172 / 72);
    assert.equal(pictureSlots({ laneWidth: 262, laneHeight: 48, ...SAMPLE }).length, 2);
  });

  it("shows portrait frames upright instead of stretching them", () => {
    const slots = pictureSlots({ laneWidth: 848, laneHeight: 48, ...PORTRAIT });
    assert.equal(slots.length, 32);
    check(slots, 848, 40 / 72);
  });

  it("keeps each frame at its moment on the ruler", () => {
    const slots = pictureSlots({ laneWidth: 848, laneHeight: 48, ...SAMPLE });
    // The last slot is centred at about 60.4 s: thumbnail 30 (60–62 s) of the sample.
    const last = slots.at(-1)!;
    const scale = last.image.height / 72;
    const tile = Math.round(-(last.image.left - (last.width - 172 * scale) / 2) / scale / 172);
    assert.equal(tile, 30);
  });

  it("draws nothing before the lane and the strip are measured", () => {
    assert.deepEqual(pictureSlots({ laneWidth: 0, laneHeight: 48, ...SAMPLE }), []);
    assert.deepEqual(
      pictureSlots({ laneWidth: 848, laneHeight: 48, ...SAMPLE, stripWidth: 0 }),
      [],
    );
  });
});

describe("result panel strings", () => {
  it("has every new string in both catalogs", () => {
    for (const dict of [en, ko]) {
      for (const reason of ["no_room", "unwritten", "removed", "dropped"] as const)
        assert.ok(dict.editor.noLinesWhy[reason]);
      assert.ok(dict.editor.noLinesWhy.no_room.includes("{pause}"));
      assert.ok(dict.editor.unvoicedLead);
      assert.ok(dict.editor.coverage.includes("{room}"));
      assert.ok(dict.editor.seekValue.includes("{time}"));
      assert.ok(dict.workspace.videoFailed && dict.workspace.noDescription);
      assert.ok(dict.timeline.recognized);
    }
  });
});
