import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { renderNames, styleRules, type ClipContext } from "../src/lib/pipeline/context";
import { SceneMapSchema } from "../src/lib/pipeline/schemas";
import { heardSounds, silenceNote, silentSpans, WATCH_SYSTEM } from "../src/lib/pipeline/watch";
import { writerSystem } from "../src/lib/pipeline/write";

const context = (language: ClipContext["language"]): ClipContext => ({
  language,
  density: "standard",
  clipSeconds: 45,
  speech: [],
  scene: { shots: [], characters: [], sounds: [] },
  gaps: [],
  videoDataUrl: "data:video/mp4;base64,",
});
const flat = (text: string) => text.replace(/\s+/g, " ");

describe("writer instructions", () => {
  // QA 2026-10-03: "Open your eyes." read bare sounded like the narrator talking to the listener.
  it("lead English on-screen text in with where it is written, titles with 'Title:'", () => {
    const style = flat(styleRules(context("en")));
    assert.match(style, /'A sign reads:', 'A monitor reads:'/);
    assert.match(style, /'A caption reads:' for words laid over the picture/);
    assert.match(style, /Never call it 'the screen'/);
    assert.match(style, /the film's own title follows 'Title:'/);
    assert.match(
      style,
      /time or place card or a credit may be read bare \('Forty years later\.'\)/,
    );
    assert.match(style, /Never say text 'appears on screen'/);
  });

  it("give Korean the same lead-ins in Korean, and keep its framing ban", () => {
    const style = flat(styleRules(context("ko")));
    assert.match(style, /'제목,'/);
    assert.match(style, /'간판에 적힌 글, 출입 금지\.', '모니터에 적힌 글, 접속 완료\.'/);
    assert.match(style, /'자막,' only for words laid over the picture/);
    assert.match(style, /'40년 후\.'/);
    assert.match(style, /'자막이 뜬다' or '화면에 보인다'/);
  });

  // QA: 7 of 8 English runs first mentioned a person as "He" or "The eyepiece man".
  it("introduce a person before referring to them", () => {
    assert.match(
      flat(styleRules(context("en"))),
      /introduce them with 'a' or 'an' and one distinguishing visual/,
    );
    assert.match(flat(styleRules(context("en"))), /such as 'the eyepiece man'/);
    assert.match(flat(styleRules(context("ko"))), /introduce them by one visual trait/);
    const system = flat(writerSystem(context("en")));
    assert.match(system, /never refer to someone the narration has not yet introduced/);
  });

  // QA: captions of an explainer were never read while the writer described cursors; lines named
  // things 0.4–5.5 s before they appeared.
  it("put on-screen words first and never describe ahead of the picture", () => {
    const system = flat(writerSystem(context("en")));
    assert.match(
      system,
      /1\. On-screen words that tell the story and that the soundtrack does not speak: the film's title/,
    );
    assert.match(system, /before any motion, cursor or interface detail/);
    assert.match(system, /never start it before what it describes appears/);
    assert.match(system, /never what becomes of an object when that moment is not shown/);
  });

  // Review of 2026-10-03: with "opening credits" first, a Korean run spent a line on a film-fund
  // credit and dropped the city and the first person; a Sintel run read "Blender Foundation
  // presents" in 2 of its 4 lines.
  it("put place, people and action before credits that do not name the film", () => {
    const system = flat(writerSystem(context("en")));
    const first = system.indexOf("1. On-screen words");
    assert.ok(first >= 0);
    assert.doesNotMatch(system.slice(first, system.indexOf("2. A change of place")), /credits/);
    assert.match(
      system,
      /5\. Other credits \(who presents, cast, crew, funders\) last: only in room the items above do not need, condensed into one short line/,
    );
  });
});

describe("names", () => {
  const scene = (name: string) => ({
    shots: [],
    sounds: [],
    characters: [
      { id: "c1", look: "a man in a red cap", name, nameFirstSpokenAt: name ? 8 : null },
    ],
  });

  it("prefer the dialogue's spelling only when the clip has a name", () => {
    assert.match(renderNames(scene("Barney")), /use the dialogue's spelling/);
    assert.match(renderNames(scene("Barney")), /Name "Barney" may be used only from 8\.00 s/);
    assert.doesNotMatch(renderNames(scene("")), /spelling/);
    assert.match(renderNames(scene("")), /No name is spoken or shown in the clip/);
  });
});

describe("watch instructions", () => {
  // QA 2026-10-03: shot starts 0.4–1.1 s early, a one-second "COMING SOON" card missed, an apple
  // "set back down" that the rabbit eats, and sounds invented over a silent soundtrack.
  it("ask for late-rather-than-early times, one entry per text, and only what is seen or heard", () => {
    const system = flat(WATCH_SYSTEM);
    assert.match(system, /when unsure between two frames, give the later time/);
    assert.match(system, /whenever on-screen text appears, changes or goes/);
    assert.match(system, /burned-in captions or subtitles/);
    assert.match(system, /unless that moment is visible; when its fate is not shown, leave it out/);
    assert.match(system, /Never infer a sound from the picture, from on-screen text/);
    assert.match(system, /when the soundtrack is silent, sounds is \[\]/);
  });

  it("say where the soundtrack was measured silent, and nothing when it was not", () => {
    assert.equal(silenceNote([]), "");
    assert.match(
      silenceNote([{ start: 0, end: 60 }]),
      /measured silent at 0\.0–60\.0 s: there is no sound there/,
    );
    assert.match(
      silenceNote([
        { start: 2, end: 4.25 },
        { start: 10, end: 12 },
      ]),
      /2\.0–4\.3 s, 10\.0–12\.0 s/,
    );
  });

  it("find the silences worth telling from the measured audible spans", () => {
    // The silent Big Buck Bunny cut: nothing audible at all.
    assert.deepEqual(silentSpans([], 60), [{ start: 0, end: 60 }]);
    // The captioned explainer (measured): sound 2.2–11.8 s and 19.35–28.95 s, digital silence after.
    assert.deepEqual(
      silentSpans(
        [
          { start: 2.2, end: 11.8 },
          { start: 19.35, end: 28.95 },
        ],
        90,
      ),
      [
        { start: 0, end: 2.2 },
        { start: 11.8, end: 19.35 },
        { start: 28.95, end: 90 },
      ],
    );
    // Pauses under a second, and a soundtrack heard to the end, leave nothing to tell.
    assert.deepEqual(
      silentSpans(
        [
          { start: 0, end: 5 },
          { start: 5.6, end: 51.65 },
        ],
        52.2,
      ),
      [],
    );
  });

  it("drop listed sounds the soundtrack cannot have made, keeping near misses", () => {
    const sound = (start: number, end: number, label: string) => ({
      start,
      end,
      label,
      kind: "protect" as const,
    });
    // QA: an "ominous orchestral chord" marked protect over digital silence took 3.25 s of room.
    const silent = heardSounds([sound(57, 60, "orchestral chord")], []);
    assert.deepEqual(silent.kept, []);
    assert.deepEqual(
      silent.dropped.map((s) => s.label),
      ["orchestral chord"],
    );
    const audible = [
      { start: 1, end: 1.5 },
      { start: 30, end: 40 },
    ];
    const { kept, dropped } = heardSounds(
      [
        sound(0, 3, "a burst inside a longer span"),
        sound(40.4, 41, "a timing slip of 0.4 s"),
        sound(42, 44, "nothing heard within 0.5 s"),
      ],
      audible,
    );
    assert.deepEqual(
      kept.map((s) => s.label),
      ["a burst inside a longer span", "a timing slip of 0.4 s"],
    );
    assert.deepEqual(
      dropped.map((s) => s.label),
      ["nothing heard within 0.5 s"],
    );
  });

  it("ask for sounds heard on the soundtrack only, in the schema too", () => {
    const schema = JSON.stringify(z.toJSONSchema(SceneMapSchema));
    assert.match(schema, /Only sounds heard on the soundtrack; empty when it is silent/);
    assert.match(schema, /shown on screen as this person's name/);
    assert.match(schema, /captions or subtitles, time and place cards/);
  });
});
