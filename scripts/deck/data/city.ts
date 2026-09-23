/**
 * The English run (default reviewer) on the Tears of Steel city sequence, which starts 65 s into the
 * film. It gives the cover line and the newspaper line that a word-count budget would have let through.
 */
import { readFileSync } from "node:fs";
import { spokenUnits, UNITS_PER_SECOND } from "../../../src/lib/pipeline/length";
import { CITY_RUN, FIT_SOURCE } from "../paths";
import { round2 } from "./runs";
import { readJsonFile, ScriptSchema, type RunCue } from "./schema";

/** eval-tos-city.mp4 is film 65–110 s (runtime/evaluation/cases.json "from", frame-checked by film.ts). */
export const CITY_FILM_OFFSET_S = 65;

export const cityRun = readJsonFile(CITY_RUN, ScriptSchema);

function cueOf(id: string): RunCue {
  const found = cityRun.cues.find((c) => c.id === id);
  if (!found) throw new Error(`cue ${id} missing in ${cityRun.runId}`);
  return found;
}

// ------------------------------------------------------------------ cover line
const COVER_ID = "L2";
/** Film second of the cover still: inside the line's window, on the widest city frame. */
const COVER_STILL_CLIP_S = 7.5;
const cover = cueOf(COVER_ID);
if (cover.status !== "fits" || cover.seconds === undefined)
  throw new Error("cover line did not ship");
const coverVoice = cover.versions[cover.versions.length - 1].voice;
if (!coverVoice) throw new Error("cover line has no voice record");
if (COVER_STILL_CLIP_S < cover.start || COVER_STILL_CLIP_S > cover.windowEnd)
  throw new Error("cover still outside its line");

export const coverLine = {
  text: cover.versions[cover.versions.length - 1].text,
  voiced: round2(cover.seconds),
  room: round2(cover.windowEnd - cover.start),
  rate: coverVoice.rate,
  filmTime: CITY_FILM_OFFSET_S + COVER_STILL_CLIP_S,
};

// ------------------------------------------------------------------ the newspaper headline
const NEWS_ID = "L4";
/** A frame inside the line's window where the headline is legible (checked by eye on the master). */
const NEWS_STILL_CLIP_S = 15.8;
const news = cueOf(NEWS_ID);
if (news.status !== "dropped") throw new Error("newspaper line was expected to be dropped");
if (NEWS_STILL_CLIP_S < news.start || NEWS_STILL_CLIP_S > news.windowEnd)
  throw new Error("news still outside its line");
const tries = news.versions.map((v, i) => {
  if (!v.voice) throw new Error(`newspaper version ${i + 1} was never voiced`);
  return {
    text: v.text,
    by: v.by,
    voiced: round2(v.voice.seconds),
    rate: v.voice.rate,
    words: spokenUnits(v.text, "en"),
  };
});
if (!tries.every((t) => t.voiced > news.windowEnd - news.start))
  throw new Error("a newspaper version fitted");
if (tries[0].by !== "write" || tries.slice(1).some((t) => t.by !== "shorten"))
  throw new Error("the newspaper line is no longer a draft followed by shortenings");
const missingNews = cityRun.summary.finalReview.missing.find(
  (m) => m.at >= news.start && m.at < news.windowEnd,
);
if (!missingNews || !/roboticist/i.test(missingNews.what))
  throw new Error("final check did not list the headline");

// What bounds the room: the headline's own shot, and the next line, which describes the next shot.
const newsShot = cityRun.scene.shots.find((s) => news.start >= s.start && news.start < s.end);
if (!newsShot || !/ROBOTICIST/.test(newsShot.onScreenText))
  throw new Error("the newspaper line does not start on the headline's shot");
const nextLine = cityRun.cues
  .filter((c) => c.start > news.start)
  .reduce((a, b) => (b.start < a.start ? b : a));
if (Math.abs(nextLine.start - news.windowEnd) > 0.01)
  throw new Error("the newspaper line's room no longer ends at the next line");
if (nextLine.start < newsShot.end)
  throw new Error(
    "the next line starts inside the headline's shot; the slide says it belongs to the next shot",
  );

const WORDS_PER_SECOND = UNITS_PER_SECOND.en;

/**
 * The speed-up rule of the voice stage (src/lib/pipeline/fit-voice.ts): a take longer than its room
 * is voiced once more at rate = round2(min(1.15, take / room × 1.03)), and only that second take is
 * stored. So the first take of a sped-up version is recovered from its rate, as the range of takes
 * that round to it. The build stops if the rule in fit-voice.ts changes.
 */
const RATE_ROUNDING = 0.005;
const fitSource = readFileSync(FIT_SOURCE, "utf8");
if (!fitSource.includes("(line.seconds / room) * RATE_HEADROOM"))
  throw new Error("the speed-up rule changed; the newspaper slide infers a take from it");
/** A numeric constant of the voice stage, read from its source so the notes cannot drift from it. */
function pipelineConstant(name: string): number {
  const m = fitSource.match(new RegExp(`const ${name} = ([\\d.]+);`));
  if (!m) throw new Error(`${FIT_SOURCE} has no ${name}`);
  return Number(m[1]);
}
const RATE_HEADROOM = pipelineConstant("RATE_HEADROOM");
export const fitRule = {
  headroom: RATE_HEADROOM,
  maxRate: pipelineConstant("MAX_SPEAKING_RATE"),
  shortenings: pipelineConstant("MAX_SHORTEN_ROUNDS"),
};
const room = news.windowEnd - news.start;
const sped = tries.filter((t) => t.rate > 1);
if (sped.length !== 1 || tries[1] !== sped[0])
  throw new Error("expected only the first shortening to be sped up");
const firstTake = {
  low: round2(((sped[0].rate - RATE_ROUNDING) * room) / RATE_HEADROOM),
  high: round2(((sped[0].rate + RATE_ROUNDING) * room) / RATE_HEADROOM),
};
if (firstTake.low <= room || firstTake.high >= sped[0].voiced)
  throw new Error("the sped-up take no longer came back longer than its unstored first take");
if (tries[2].text.toLowerCase() !== tries[1].text.toLowerCase())
  throw new Error("the second shortening is no longer the same words as the first");

export const newspaper = {
  start: news.start,
  windowEnd: news.windowEnd,
  room: round2(room),
  shot: {
    start: newsShot.start,
    end: newsShot.end,
    seconds: round2(newsShot.end - newsShot.start),
  },
  /** From the end of the headline's shot to the next line. */
  afterShot: round2(news.windowEnd - newsShot.end),
  wordsPerSecond: WORDS_PER_SECOND,
  estimate: round2(tries[0].words / WORDS_PER_SECOND),
  tries,
  /** The unstored 1.0x take of the first shortening, inferred from its rate. */
  firstTake,
  filmTime: CITY_FILM_OFFSET_S + NEWS_STILL_CLIP_S,
};
if (newspaper.estimate >= newspaper.room)
  throw new Error("the word-count estimate no longer fits on paper");
