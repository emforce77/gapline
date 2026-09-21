/** Clips cut from openly licensed films. Only these ship with the app. */
export interface SampleClip {
  id: string;
  title: string;
  /** File inside runtime/source/ (downloaded by scripts/prepare-samples.ts). */
  sourceFile: string;
  sourceUrl: string;
  subtitleUrl: string;
  startSeconds: number;
  durationSeconds: number;
  attribution: string;
  license: string;
}

export const SAMPLE_CLIPS: SampleClip[] = [
  {
    id: "tos-opening",
    title: "Tears of Steel — opening",
    sourceFile: "tears_of_steel_720p.mov",
    sourceUrl: "https://download.blender.org/demo/movies/ToS/tears_of_steel_720p.mov",
    subtitleUrl: "https://download.blender.org/demo/movies/ToS/subtitles/TOS-en.srt",
    startSeconds: 0,
    durationSeconds: 65,
    attribution: "(CC) Blender Foundation | mango.blender.org",
    license: "CC BY 3.0",
  },
];

export function findSampleClip(id: string): SampleClip {
  const clip = SAMPLE_CLIPS.find((c) => c.id === id);
  if (!clip) throw new Error(`Unknown sample clip: ${id}`);
  return clip;
}
