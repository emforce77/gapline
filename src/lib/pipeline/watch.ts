import { callStructured } from "../llm/openrouter";
import { reasoningEffort } from "../models";
import { SceneMapSchema, type SceneMap } from "./schemas";

const WATCH_SYSTEM = `You are the watching stage of an audio description pipeline for blind and low-vision viewers.
You receive a film clip with its soundtrack. Build a factual map of what a sighted viewer sees.

shots: consecutive, covering the whole clip, one entry per shot or per clearly different moment.
- start/end in seconds from the start of the clip (one decimal).
- setting: place, time of day, weather — only what is visible.
- action: who or what is visible and what they do. Concrete and physical: clothing, posture, gestures,
  facial expressions, objects, movement. No interpretation of motives, no camera jargon.
- onScreenText: exact titles, captions or signs; empty string when none.

characters: every person or robot that matters. look = a visual descriptor usable before their name is
known ("young man with dark curly hair and a leather jacket"). name = only if a name is spoken aloud in the
clip, and nameFirstSpokenAt = the second it is first spoken; otherwise empty string and null.

sounds (non-speech): protect = a brief (under 3 s) story-critical cue such as a gunshot, a door slam, a scream
or a phone ring; describe = a sound whose source a listener could not identify by ear; ambient = music,
background and any long continuous sound such as engines, rain or crowds (narration may duck under these).

Never state anything that is not visible or audible in this clip.`;

export async function watchClip(input: {
  /** data:video/mp4;base64,... of the watching proxy (encodeWatchingVideo). */
  videoDataUrl: string;
  clipSeconds: number;
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
          `Shots must tile the clip from 0 to ${input.clipSeconds.toFixed(1)}; no time may exceed it.`,
      },
    ],
    schemaName: "scene_map",
    schema: SceneMapSchema,
    temperature: 0.2,
    ledgerFile: input.ledgerFile,
    reasoningEffort: reasoningEffort("watch"),
    onDelta: input.onDelta,
  });
  const outside = [...data.shots, ...data.sounds].filter((s) => s.end > input.clipSeconds + 0.5);
  if (outside.length > 0) {
    throw new Error(`watch: ${outside.length} spans end after the clip (${input.clipSeconds} s)`);
  }
  return data;
}
