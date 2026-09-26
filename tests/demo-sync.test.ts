import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Page } from "playwright-core";
import {
  cameraAt,
  cameraFilters,
  cameraForBeat,
  cameraKeys,
  MOVE_SECONDS,
  pieces,
  settledAt,
  shotView,
  toPicture,
} from "../scripts/demo/camera";
import { locateExcerpt } from "../scripts/demo/check";
import { minutesSeconds, film } from "../scripts/demo/facts";
import { labels } from "../scripts/demo/labels";
import { mixGraph, type FilmSound } from "../scripts/demo/mix";
import { frameGaps } from "../scripts/demo/record";
import {
  BeatClock,
  driftFor,
  frameAround,
  MAX_STRETCH,
  overlapShare,
  toOutput,
  type BeatRecord,
  type MediaEvent,
} from "../scripts/demo/recorder-kit";
import {
  heardExcerpt,
  overlayEvents,
  playbackOverlay,
  revealEvents,
} from "../scripts/demo/segments";
import { LISTEN } from "../scripts/demo/storyboard";

const RATE = 8000;

/** Noise shaped by a slow, uneven envelope, so an excerpt has one place where it fits. */
function shapedNoise(seconds: number, seed: number): Float32Array {
  const x = new Float32Array(Math.round(seconds * RATE));
  let s = seed;
  for (let i = 0; i < x.length; i++) {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    const t = i / RATE;
    const env = 0.2 + 0.8 * Math.abs(Math.sin(1.3 * t + seed) * Math.sin(0.37 * t * t));
    x[i] = env * (s / 2 ** 30 - 1);
  }
  return x;
}

/** A page stand-in for BeatClock: only waitForTimeout is used outside a real recording. */
const fakePage = {
  waitForTimeout: (ms: number) => new Promise((r) => setTimeout(r, ms)),
} as unknown as Page;
const sleep = (ms: number) => () => new Promise<void>((r) => setTimeout(r, ms));

describe("locateExcerpt", () => {
  it("finds an excerpt within a sample of where it was laid, even 2.7 s from its plan", () => {
    const film = new Float32Array(20 * RATE);
    const ref = shapedNoise(4, 7);
    const laid = 5.2375;
    film.set(
      ref.map((v) => v * 0.6),
      Math.round(laid * RATE),
    );
    const planned = laid + 2.7;
    const found = locateExcerpt(film, ref, planned, RATE);
    assert.ok(Math.abs(found.at - laid) <= 1 / RATE, `found at ${found.at}`);
    assert.ok(found.match > 0.99);
  });

  it("reports a poor match where the excerpt is not in the sound at all", () => {
    const found = locateExcerpt(shapedNoise(20, 3), shapedNoise(3, 11), 8, RATE);
    assert.ok(found.match < 0.5, `match ${found.match}`);
  });
});

describe("mixGraph", () => {
  it("re-times the mixed track from zero, so each excerpt is heard where it was laid", () => {
    const sound: FilmSound = {
      label: "dark",
      file: "clip.mp4",
      at: 2.7,
      from: 53.03,
      seconds: 9.57,
      ref: "film-ref-0.wav",
    };
    const graph = mixGraph([sound, { ...sound, at: 21.667 }], 2.1, 170.7);
    assert.match(graph, /amix=inputs=2:[^,]*,aresample=async=1:first_pts=0,apad=whole_dur=170.7/);
    assert.match(graph, /adelay=2700:all=1/);
    assert.match(graph, /adelay=21667:all=1/);
  });
});

describe("the recorder's clock", () => {
  it("maps wall time through a slowed and a shortened stretch", () => {
    const rec = {
      wallStart: 100,
      warps: [
        { from: 101, to: 102, seconds: 4, label: "" },
        { from: 110, to: 120, seconds: 2, label: "" },
      ],
    };
    assert.equal(toOutput(rec, 101), 1);
    assert.equal(toOutput(rec, 101.5), 3);
    assert.equal(toOutput(rec, 102), 5);
    assert.equal(toOutput(rec, 110), 13);
    assert.equal(toOutput(rec, 120), 15);
    assert.equal(toOutput(rec, 121), 16);
  });

  it("paces page moments onto picture times, slowing at most MAX_STRETCH", async () => {
    const clock = new BeatClock(fakePage, "replay", 5);
    const from = Date.now() / 1000;
    await clock.pace(
      [
        { by: 0.3, wait: sleep(100) },
        { by: 0.4, wait: sleep(250) },
        { by: 3, wait: sleep(20) },
      ],
      "sped up",
      from,
    );
    const [slowed, shortened, capped] = clock.rec.warps;
    assert.ok(slowed.seconds > slowed.to - slowed.from, "the quick first step is slowed");
    assert.ok(Math.abs(toOutput(clock.rec, slowed.to) - 0.3) < 0.02);
    assert.ok(
      shortened.seconds < shortened.to - shortened.from,
      "the slow second step is shortened",
    );
    assert.ok(Math.abs(toOutput(clock.rec, shortened.to) - 0.4) < 0.02);
    assert.ok(Math.abs(capped.seconds / (capped.to - capped.from) - MAX_STRETCH) < 1e-9);
    assert.ok(
      clock.rec.late.some((l) => l.by < 0),
      "the capped step is noted as early",
    );
    const tag = clock.rec.overlays.find((o) => o.kind === "tag");
    assert.equal(tag?.kind === "tag" && tag.text, "sped up");
  });

  it("fails a spotlight whose element has moved when it lights up", async () => {
    const box = { x: 100, y: 100, w: 300, h: 80 };
    const clock = new BeatClock(fakePage, "review", 5);
    clock.spotlight("held", 0.05, 1, box, async () => box);
    clock.spotlight("moved", 0.1, 1, box, async () => ({ ...box, y: box.y + 40 }));
    await assert.rejects(clock.at(0.2, "end"), /the spotlight on moved covers 50 %/);
    assert.deepEqual(clock.rec.spotChecks, [
      { what: "held", at: 0.05, share: 1 },
      { what: "moved", at: 0.1, share: 0.5 },
    ]);
  });

  it("cuts a wait out of the picture: its whole stretch is one instant", async () => {
    const clock = new BeatClock(fakePage, "upload", 5);
    await clock.squeeze(
      [{ by: 0.1, wait: sleep(200) }, { wait: sleep(150) }],
      () => "shortened",
      0,
    );
    const [shortened, cut] = clock.rec.warps;
    assert.ok(Math.abs(toOutput(clock.rec, shortened.to) - 0.1) < 0.02);
    assert.equal(cut.seconds, 0);
    assert.ok(Math.abs(toOutput(clock.rec, cut.to) - toOutput(clock.rec, cut.from)) < 1e-9);
    assert.ok(Math.abs(clock.now() - 0.1) < 0.02, `now ${clock.now()}`);
  });

  it("measures overlap against the larger box", () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    assert.equal(overlapShare(a, a), 1);
    assert.equal(overlapShare(a, { x: 0, y: 0, w: 100, h: 200 }), 0.5);
    assert.equal(overlapShare(a, { x: 200, y: 0, w: 10, h: 10 }), 0);
  });
});

describe("the camera", () => {
  const box = { x: 1055, y: 231, w: 342, h: 378 };

  for (const beat of ["upload", "replay", "review", "result", "edit"] as const) {
    it(`holds every ${beat} close-up still and cuts directly between targets`, () => {
      const keys = cameraForBeat({
        beat,
        shots: [
          { at: 0.003, rect: box, maxZoom: 1.8, move: 1.2 },
          { at: 1.4, rect: box, maxZoom: 1.8, move: 12, drift: 1.04 },
          { at: 14, rect: null, move: 1.2 },
        ],
      });
      const held = cameraAt(keys, 0);
      assert.ok(held.z > 1.5, "the first frame is already framed; no wide-shot flash");
      for (let frame = 0; frame < 14 * 30; frame++)
        assert.deepEqual(cameraAt(keys, frame / 30), held);
      assert.equal(cameraAt(keys, 14).z, 1, "the next target is reached on its cut");
      assert.ok(keys.every((key) => key.move === 0 && !key.drift));
      assert.doesNotMatch(cameraFilters(keys).join(","), /cos\(/, "no interpolated rescale");
    });
  }

  it("records new targets as fixed cuts", () => {
    const clock = new BeatClock(fakePage, "result", 5);
    clock.shot(box, 1.8, 0);
    clock.shot(null, undefined, 3);
    assert.deepEqual(clock.rec.shots, [
      { at: 0, rect: box, maxZoom: 1.8, move: 0 },
      { at: 3, rect: null, maxZoom: undefined, move: 0 },
    ]);
  });

  it("cuts at once, and waits for a move but not for a drift", () => {
    const keys = cameraKeys([
      { at: 0, rect: box, maxZoom: 1.8, move: 0 },
      { at: 2, rect: box, maxZoom: 1.8, move: 6, drift: 1.08 },
      { at: 9, rect: null },
    ]);
    assert.ok(cameraAt(keys, 0).z > 1.5, "the cut is in place from its first frame");
    assert.equal(settledAt(keys, 3), 3, "an overlay does not wait for a drift");
    assert.equal(settledAt(keys, 9.5), 9 + MOVE_SECONDS);
    assert.ok(cameraAt(keys, 8).z > cameraAt(keys, 2).z, "the drift pushes in");
    assert.ok(cameraAt(keys, 8).z < cameraAt(keys, 2).z * 1.09, "by a few per cent at most");
  });

  it("splits a lit overlay into one piece per frame while the camera drifts", () => {
    const keys = cameraKeys([
      { at: 0, rect: box, maxZoom: 1.8, move: 0 },
      { at: 1, rect: box, maxZoom: 1.8, move: 1, drift: 1.08 },
    ]);
    const parts = pieces(keys, 0.5, 3, [0.75]);
    assert.deepEqual(parts.slice(0, 2), [
      { start: 0.5, end: 0.75, at: 0.5 },
      { start: 0.75, end: 1, at: 0.75 },
    ]);
    const moving = parts.filter((p) => p.start >= 1 && p.end <= 2);
    assert.equal(moving.length, 31);
    assert.ok(moving.slice(1, -1).every((p) => Math.abs(p.end - p.start - 1 / 30) < 1e-9));
    assert.deepEqual(parts.at(-1), { start: 2, end: 3, at: 2 });
  });

  const rec = (shots: BeatRecord["shots"]): BeatRecord => ({
    beat: "review",
    wallStart: 0,
    wallEnd: 5,
    seconds: 5,
    warps: [],
    shots,
    overlays: [{ kind: "spotlight", at: 0.5, until: 4, rect: box }],
    late: [],
  });

  it("holds a spotlight fixed when an older recording contains decorative drift", () => {
    const events = overlayEvents(
      rec([
        { at: 0, rect: box, maxZoom: 1.8, move: 0 },
        { at: 1, rect: box, maxZoom: 1.8, move: 2, drift: 1.08 },
      ]),
    );
    const frames = events.filter((e) => e.layer === 2);
    assert.equal(frames.length, 1, "one fixed rectangle for the whole reading hold");
    assert.equal(frames[0].start, 0.5);
    assert.equal(frames[0].end, 4);
  });

  it("fails a spotlight the camera would cut away from", () => {
    assert.throws(
      () =>
        overlayEvents(
          rec([
            { at: 0, rect: box, maxZoom: 1.8, move: 0 },
            { at: 2, rect: null },
          ]),
        ),
      /the camera moves at 2\.00 s while a spotlight is lit/,
    );
  });
});

describe("framing a close-up against the page's right edge", () => {
  // The edit scene's button and note in the inspector, and a label of the player's controls in the
  // column beside it (2026-09-23 dry run: the zoom-2 view began at x 720, inside "Description
  // off").
  const rect = { x: 1072, y: 506.9, w: 308, h: 117.3 };
  const label = { x: 711, y: 586, w: 89, h: 16 };
  const cuts = (view: typeof rect, line: typeof rect) =>
    line.y < view.y + view.h &&
    line.y + line.h > view.y &&
    [view.x, view.x + view.w].some((edge) => line.x < edge && edge < line.x + line.w);
  const holds = (view: typeof rect, r: typeof rect) =>
    view.x <= r.x + 0.5 &&
    view.y <= r.y + 0.5 &&
    view.x + view.w >= r.x + r.w - 0.5 &&
    view.y + view.h >= r.y + r.h - 0.5;

  it("widens the view a little so its left edge cuts no word of the column beside it", () => {
    assert.ok(cuts(shotView(rect, 2), label), "the plain view cuts the label");
    const view = shotView(frameAround(rect, 2, [label]), 2);
    assert.ok(!cuts(view, label), `view from x ${view.x.toFixed(1)}`);
    assert.ok(holds(view, rect), "the element stays whole");
    assert.ok(view.w < shotView(rect, 2).w * 1.15, "by no more than the framing allows");
  });

  it("frames for two layouts at once: a line where it is now and where it will be pushed", () => {
    const section = { x: 162, y: 73.1, w: 1116, h: 219.8 };
    const now = [
      { x: 162, y: 438.9, w: 396, h: 35.5 },
      { x: 162, y: 476.4, w: 341, h: 35.5 },
      { x: 162, y: 558.9, w: 166, h: 35.5 },
    ];
    const pushed = now.map((l) => ({ ...l, y: l.y + 33 }));
    const view = shotView(frameAround(section, 1.5, [...now, ...pushed]), 1.5);
    const edge = view.y + view.h;
    for (const l of [...now, ...pushed])
      assert.ok(!(l.y < edge && edge < l.y + l.h), `the foot at ${edge.toFixed(1)} cuts a line`);
    assert.ok(holds(view, section));
  });

  it("drifts in about the view's left edge when its centre would push it into a word", () => {
    const word = { x: 730, y: 400, w: 30, h: 16 };
    const found = driftFor(rect, 2, [word]);
    assert.ok(found && found.anchor, "an anchored drift");
    assert.ok(found.drift > 1.05, `push ${found.drift}`);
    assert.equal(found.anchor.x, shotView(rect, 2).x);
    const view = shotView(rect, 2, found.drift, found.anchor);
    assert.ok(holds(view, word) && holds(view, rect));
  });

  it("keeps the drift's anchor where it is in the picture, within a picture pixel", () => {
    const anchor = { x: 720, y: 495 };
    const keys = cameraKeys([
      { at: 0, rect, maxZoom: 2, move: 0 },
      { at: 1, rect, maxZoom: 2, move: 3, drift: 1.06, anchor },
    ]);
    const at = (t: number) => toPicture({ ...anchor, w: 0, h: 0 }, cameraAt(keys, t));
    assert.ok(cameraAt(keys, 4).z > cameraAt(keys, 1).z * 1.05, "it pushes in");
    // Exact where the drift starts and ends; between, zoom and centre ease together, which moves it
    // by under a pixel.
    assert.ok(Math.abs(at(4).x - at(1).x) < 1e-6 && Math.abs(at(4).y - at(1).y) < 1e-6);
    for (const t of [1.5, 2, 2.5, 3, 3.5]) {
      assert.ok(Math.abs(at(t).x - at(1).x) < 1, `x at ${t}: ${at(t).x} vs ${at(1).x}`);
      assert.ok(Math.abs(at(t).y - at(1).y) < 1, `y at ${t}: ${at(t).y} vs ${at(1).y}`);
    }
  });
});

describe("words keyed to sound", () => {
  it("shows each of Scene's lines in the reveal from its first spoken sound", () => {
    const { from, to } = film.hook;
    const events = revealEvents("en", from, to, to - from);
    for (const l of film.hook.lines) {
      assert.ok(l.onset > 0 && l.onset < 0.5, `${l.id} onset ${l.onset}`);
      const e = events.find((x) => x.text.includes(l.text.replace(/\.$/, "")));
      assert.ok(e, `no event for ${l.id}`);
      assert.ok(Math.abs(e.start - (l.start + l.onset - from)) < 1e-9, `${l.id} at ${e.start}`);
    }
  });

  it("lays the result's sound from the listen's start, on the picture's clock", () => {
    const picture = { at: 7, media: LISTEN.from - 0.4, seconds: 3 };
    const heard = heardExcerpt(picture);
    assert.ok(Math.abs(heard.media - LISTEN.from) < 1e-9);
    assert.ok(Math.abs(heard.at - heard.media - (picture.at - picture.media)) < 1e-9);
    assert.ok(Math.abs(heard.at + heard.seconds - (picture.at + picture.seconds)) < 1e-9);
  });
});

describe("playback", () => {
  it("finds the stretches where the page presented no frame", () => {
    const frame = (wall: number): MediaEvent => ({ type: "frame", wall, media: wall });
    const gaps = frameGaps([frame(1), frame(1.042), frame(1.083), frame(1.5), frame(1.542)]);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].wall, 1.083);
    assert.ok(Math.abs(gaps[0].seconds - 0.417) < 1e-9);
  });

  it("lays the film over the player's picture in recording pixels, corners rounded", () => {
    const { graph, box } = playbackOverlay(
      { rect: { x: 25, y: 85.6, w: 990, h: 413.02 }, radius: 9 },
      4.9918,
    );
    assert.deepEqual(box, { x: 50, y: 172, w: 1980, h: 826, r: 18 });
    assert.match(graph, /\[1:v\]scale=1980:826/);
    assert.match(graph, /geq=lum='255\*clip\(18\.00\+0\.5-hypot/);
    assert.match(graph, /setpts=PTS\+4\.9918\/TB/);
    assert.match(graph, /overlay=50:172:eof_action=repeat/);
  });
});

describe("labels", () => {
  const PRODUCT_NAMES =
    /Speech-to-Text|Text-to-Speech|Chirp 3 HD|Chirp 3|Cloud Run|FFmpeg|Gemini \d+(\.\d+)? Flash/g;

  it("prints the sample's processing time from the facts, in each language", () => {
    assert.ok(labels("en").replay.includes(minutesSeconds(film.original.seconds, "en")));
    assert.ok(labels("ko").replay.includes(minutesSeconds(film.original.seconds, "ko")));
  });

  it("keeps the Korean film's overlays Korean, except product names", () => {
    const ko = labels("ko");
    const words = [
      ko.replay,
      ko.upload(7),
      ko.day,
      ko.revealLabel,
      ko.generate,
      ko.resultLine,
      ko.editAdded,
      ko.dialogueKo!.locked,
      ko.dialogueKo!.freaky,
      ...Object.values(ko.services),
      ko.reused,
    ];
    for (const w of words) assert.doesNotMatch(w.replace(PRODUCT_NAMES, ""), /[A-Za-z]/, w);
  });

  it("names the heard line as the app numbers it", () => {
    assert.match(labels("en").resultLine, /^Line \d+ · /);
    assert.match(labels("ko").resultLine, /^해설 \d+ · /);
    assert.equal(labels("en").dialogueKo, null);
  });
});
