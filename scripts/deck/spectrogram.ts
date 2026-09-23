/**
 * Spectrograms of the sample clip's soundtrack, rendered by ffmpeg (showspectrumpic) in grey, so the
 * deck can show where a voice is. The first seconds of the opening, voice band only: harmonics that
 * stack up in fans are speech, level bands are hum or music. Rendered on every build (under a second)
 * into assets/spectrograms at twice the size the slide shows.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { runFfmpeg } from "../../src/lib/media/ffmpeg";
import { seven } from "./data/sample";
import { OPENING_SPAN } from "./data/recognizers";
import { OUT, SHOWCASE_CLIP, SPECTROGRAMS } from "./paths";

/** A voice's stacked harmonics sit under 3 kHz; the band is stretched to show them. */
export const VOICE_BAND_HZ = 3000;
const SAMPLE_RATE = 16_000;
/** Grey tone curve: the noise floor goes dark and the loudest harmonics stay white. */
const TONE_CURVE = "0/0 0.3/0.08 0.6/0.55 1/1";

export interface SpectrogramSpec {
  name: string;
  from: number;
  to: number;
  /** Size in slide pixels; the file is rendered at twice this. */
  width: number;
  height: number;
}

export const LAUNCH_SPECTROGRAM: SpectrogramSpec = {
  name: "launch-call",
  from: OPENING_SPAN[0],
  to: OPENING_SPAN[1],
  width: 1384,
  height: 188,
};

/** Evidence only, not on a slide: the seven seconds, checked for a voice (none shows). */
const SEVEN_SPECTROGRAM: SpectrogramSpec = {
  name: "seven-seconds-spectrogram",
  from: seven.locked.end,
  to: seven.freaky.start,
  width: 1432,
  height: 188,
};
const EVIDENCE = join(OUT, "evidence");

export const spectrogramUrl = (spec: SpectrogramSpec): string =>
  `assets/spectrograms/${spec.name}.png`;

async function render(spec: SpectrogramSpec, dir: string): Promise<void> {
  const graph = [
    `[0:a]atrim=${spec.from}:${spec.to}`,
    `aresample=${SAMPLE_RATE}`,
    "pan=mono|c0=0.5*c0+0.5*c1",
    `showspectrumpic=s=${spec.width * 2}x${spec.height * 2}:legend=0:stop=${VOICE_BAND_HZ}:saturation=0`,
    "format=gray",
    `curves=all='${TONE_CURVE}'`,
  ].join(",");
  await runFfmpeg([
    "-v",
    "error",
    "-i",
    SHOWCASE_CLIP,
    "-lavfi",
    graph,
    "-y",
    join(dir, `${spec.name}.png`),
  ]);
}

/** Renders every spectrogram the slides use; returns a line for the check note. */
export async function renderSpectrograms(): Promise<string[]> {
  mkdirSync(SPECTROGRAMS, { recursive: true });
  mkdirSync(EVIDENCE, { recursive: true });
  await render(LAUNCH_SPECTROGRAM, SPECTROGRAMS);
  await render(SEVEN_SPECTROGRAM, EVIDENCE);
  return [LAUNCH_SPECTROGRAM, SEVEN_SPECTROGRAM].map(
    (s) =>
      `spectrogram: ${s.name}.png, ${s.from}–${s.to} s of the sample clip, 0–${VOICE_BAND_HZ} Hz, grey (ffmpeg showspectrumpic)`,
  );
}
