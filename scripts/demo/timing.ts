/**
 * The film has no presenter voice: the story is told in captions, and each scene is timed by how long
 * its captions take to read. A caption (one or two lines) stays up READ_BASE_S plus its characters at
 * the language's reading pace, never less than MIN_CAPTION_S; a sentence of several captions shows
 * them back to back. Pauses (app actions, film sound) come from the storyboard as they are.
 */
import type { Language } from "../../src/lib/pipeline/schemas";
import { captionGroups } from "./ass";
import type { Part, Scene } from "./storyboard";

/**
 * Characters per second a caption is timed for, spaces included: below broadcast maxima (Netflix
 * timed-text guides allow 20 for English and 12 for Korean adult programmes), because the viewer is
 * also watching the picture change under it.
 */
export const READING_CPS: Record<Language, number> = { en: 17, ko: 10 };
/** Time to find a new caption before reading it, and the shortest a caption may stay up. */
const READ_BASE_S = 0.5;
export const MIN_CAPTION_S = 1.8;
/** Blank before the first caption of a scene, between two sentences, and around film sound. */
const LEAD_IN_S = 0.2;
const BETWEEN_S = 0.1;
const AROUND_FILM_S = 0.4;

/** One caption of a sentence, in seconds from the start of its scene. */
export interface TimedCaption {
  start: number;
  end: number;
  lines: string[];
}

export interface PlannedPart {
  part: Part;
  /** Seconds from the start of the scene. */
  start: number;
  seconds: number;
  /** Set on caption parts. */
  captions?: TimedCaption[];
}

export interface ScenePlan {
  parts: PlannedPart[];
  /** Start of each caption sentence, in order: the times the picture keys its moves to. */
  captionStarts: number[];
  seconds: number;
}

export const readingSeconds = (lines: string[], lang: Language): number =>
  Math.max(MIN_CAPTION_S, READ_BASE_S + lines.join(" ").length / READING_CPS[lang]);

/** Where each caption sentence, film sound and pause of a scene falls. */
export function planScene(scene: Scene, lang: Language): ScenePlan {
  let t = "caption" in scene.parts[0] ? LEAD_IN_S : 0;
  let prev: Part | null = null;
  const parts: PlannedPart[] = scene.parts.map((part) => {
    if (prev && "caption" in part && "caption" in prev) t += BETWEEN_S;
    if (prev && ("film" in part || "film" in prev) && !("pause" in part)) t += AROUND_FILM_S;
    prev = part;
    const start = t;
    if ("caption" in part) {
      const captions: TimedCaption[] = [];
      for (const lines of captionGroups(part.caption[lang], lang, part.groups?.[lang])) {
        const seconds = readingSeconds(lines, lang);
        captions.push({ start: t, end: t + seconds, lines });
        t += seconds;
      }
      return { part, start, seconds: t - start, captions };
    }
    const seconds = "film" in part ? part.film.to - part.film.from : part.pause;
    t += seconds;
    return { part, start, seconds };
  });
  return {
    parts,
    captionStarts: parts.filter((p) => p.captions).map((p) => p.start),
    seconds: t + scene.hold,
  };
}
