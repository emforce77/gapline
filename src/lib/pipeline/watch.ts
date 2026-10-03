import { ModelOutputError } from "../errors";
import { callStructured } from "../llm/gemini";
import { clampToClip, CLIP_END_TOLERANCE_SECONDS } from "../store/analysis";
import { reasoningEffort } from "../models";
import type { Span } from "./audible";
import { SceneMapSchema, type SceneMap, type SoundEvent } from "./schemas";

/** Exported for tests, which pin the instructions the watching stage is given. */
export const WATCH_SYSTEM = `You are the watching stage of an audio description pipeline for blind and low-vision viewers.
You receive a film clip with its soundtrack. Build a factual map of what a sighted viewer sees and hears.

shots: consecutive, covering the whole clip, one entry per shot or per clearly different moment.
- start/end in seconds from the start of the clip (one decimal). A start is the first moment the shot,
  person or thing is actually visible; when unsure between two frames, give the later time. Begin a new
  entry when a new person, creature or important object comes into view, and whenever on-screen text
  appears, changes or goes, so each text has its own start and end, even a card shown for one second.
- setting: place, time of day, weather — only what is visible.
- action: who or what is visible and what they do. Concrete and physical: clothing, posture, gestures,
  facial expressions, objects, movement. Include every person or creature in frame, even a small or
  blurred one. No interpretation of motives, no camera jargon. Report only what you see happen: do not
  say an object is put down, left behind, handed over, thrown or eaten unless that moment is visible;
  when its fate is not shown, leave it out.
- onScreenText: the film's own words on screen, verbatim: title cards, titles and credits, time and
  place cards, burned-in captions or subtitles, intertitles, signs, and text on screens or papers the
  story shows. Captions and title cards first; small interface labels last, and only when the story
  needs them. Empty string when none.

characters: every person, creature or robot that matters. look = a visual descriptor usable before their
name is known ("young man with dark curly hair and a leather jacket"). name = only if the name is spoken
aloud in the clip or written on screen to label that person (a name caption or a name tag on them); a
film's title is never a person's name, and neither is what you know of the film. nameFirstSpokenAt = the
second the name is first spoken or shown; otherwise empty string and null.

sounds (non-speech): only sounds you hear on the soundtrack. Never infer a sound from the picture, from
on-screen text or from what you know of the film; when the soundtrack is silent, sounds is [].
protect = a brief (under 3 s) story-critical cue such as a gunshot, a door slam, a scream or a phone
ring; describe = a sound whose source a listener could not identify by ear; ambient = music, background
and any long continuous sound such as engines, rain or crowds (narration may duck under these).

Never state anything that is not visible or audible in this clip.`;

/** A silence shorter than this is a pause between sounds, not worth a note to the watching stage. */
const SILENCE_NOTE_MIN_SECONDS = 1;
/**
 * A listed sound is kept when the soundtrack is audible within this distance of its span: watch
 * times are coarse (shot starts 0.4–1.1 s early in the QA of 2026-10-03), and a real cue dropped for
 * a timing slip would let narration cover it.
 */
const SOUND_TIMING_TOLERANCE_SECONDS = 0.5;

/** Where the soundtrack is silent: the clip outside its audible spans, in stretches of a second or more. */
export function silentSpans(audible: Span[], clipSeconds: number): Span[] {
  const silent: Span[] = [];
  let from = 0;
  for (const span of [...audible, { start: clipSeconds, end: clipSeconds }]) {
    if (span.start - from >= SILENCE_NOTE_MIN_SECONDS)
      silent.push({ start: from, end: span.start });
    from = Math.max(from, span.end);
  }
  return silent;
}

/**
 * The measured silence, said in words. Over a silent soundtrack the model invented sounds in 5 of 5
 * QA runs ("synth drone", an "orchestral chord" marked protect that took 3.25 s of narration room).
 * Measured 2026-10-03 on the silent Big Buck Bunny cut: 2 watches with this note listed no sound;
 * 2 with the prompt rule alone listed 1 and 9.
 */
export function silenceNote(silent: Span[]): string {
  if (silent.length === 0) return "";
  const spans = silent.map((s) => `${s.start.toFixed(1)}–${s.end.toFixed(1)} s`).join(", ");
  return (
    ` The soundtrack was measured silent at ${spans}: there is no sound there, so no sound may ` +
    `overlap those times.`
  );
}

/**
 * The listed sounds the soundtrack can have made. This measures the model's answer against the
 * audio instead of trusting it: a sound with no audible audio near its span is dropped, so an
 * invented "protect" cue cannot take narration room.
 */
export function heardSounds(
  sounds: SoundEvent[],
  audible: Span[],
): { kept: SoundEvent[]; dropped: SoundEvent[] } {
  const kept: SoundEvent[] = [];
  const dropped: SoundEvent[] = [];
  for (const sound of sounds) {
    const heard = audible.some(
      (a) =>
        a.end > sound.start - SOUND_TIMING_TOLERANCE_SECONDS &&
        a.start < sound.end + SOUND_TIMING_TOLERANCE_SECONDS,
    );
    (heard ? kept : dropped).push(sound);
  }
  return { kept, dropped };
}

export async function watchClip(input: {
  /** data:video/mp4;base64,... of the watching proxy (encodeWatchingVideo). */
  videoDataUrl: string;
  clipSeconds: number;
  /** Where the clip's soundtrack can be heard (measureAudible); empty when it is silent or missing. */
  audible: Span[];
  model: string;
  ledgerFile: string;
  onDelta?: (text: string) => void;
}): Promise<SceneMap> {
  const { data } = await callStructured({
    label: "watch",
    model: input.model,
    system: WATCH_SYSTEM,
    user: [
      {
        type: "video_url",
        video_url: { url: input.videoDataUrl },
      },
      {
        type: "text",
        text:
          `The clip is exactly ${input.clipSeconds.toFixed(1)} seconds long. ` +
          `Shots must tile the clip from 0 to ${input.clipSeconds.toFixed(1)}; no time may exceed it.` +
          silenceNote(silentSpans(input.audible, input.clipSeconds)),
      },
    ],
    schemaName: "scene_map",
    schema: SceneMapSchema,
    temperature: 0.2,
    ledgerFile: input.ledgerFile,
    reasoningEffort: reasoningEffort("watch"),
    onDelta: input.onDelta,
  });
  const { kept, dropped } = heardSounds(data.sounds, input.audible);
  if (dropped.length > 0)
    console.warn(
      `watch: dropped ${dropped.length} sound(s) over measured silence: ` +
        dropped.map((s) => `${s.kind} ${s.start}–${s.end} s "${s.label}"`).join("; "),
    );
  return fitSceneToClip({ ...data, sounds: kept }, input.clipSeconds);
}

/**
 * Times within CLIP_END_TOLERANCE_SECONDS past the end are clamped to it, so the scene passes the
 * same validation as stored analysis; anything further out is a wrong answer, not rounding.
 */
export function fitSceneToClip(scene: SceneMap, clipSeconds: number): SceneMap {
  const limit = clipSeconds + CLIP_END_TOLERANCE_SECONDS;
  const outside = [...scene.shots, ...scene.sounds].filter((s) => s.end > limit).length;
  const lateName = scene.characters.filter(
    (c) => c.nameFirstSpokenAt !== null && c.nameFirstSpokenAt > limit,
  ).length;
  if (outside + lateName > 0)
    throw new ModelOutputError(
      `watch: ${outside + lateName} times end after the clip (${clipSeconds} s)`,
    );
  return {
    ...scene,
    shots: clampToClip(scene.shots, clipSeconds),
    sounds: clampToClip(scene.sounds, clipSeconds),
    characters: scene.characters.map((c) =>
      c.nameFirstSpokenAt !== null && c.nameFirstSpokenAt > clipSeconds
        ? { ...c, nameFirstSpokenAt: clipSeconds }
        : c,
    ),
  };
}
