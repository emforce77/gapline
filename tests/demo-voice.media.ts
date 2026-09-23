import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runFfmpeg } from "../src/lib/media/ffmpeg";
import { keptSentence, measureSpeech, type VoicedSentence } from "../scripts/demo/voice";

const TONE_SECONDS = 1.2;
const LEAD_SECONDS = 0.3;

/** A tone with silence around it (a whole sentence), or cut off at full level (a clipped word). */
async function tone(dir: string, name: string, clippedEnd: boolean): Promise<string> {
  const file = join(dir, `${name}.wav`);
  const pad = clippedEnd
    ? `adelay=${LEAD_SECONDS * 1000}`
    : `adelay=${LEAD_SECONDS * 1000},apad=pad_dur=${LEAD_SECONDS}`;
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=220:duration=${TONE_SECONDS}`,
    "-af",
    pad,
    file,
  ]);
  return file;
}

const sentence = (file: string, rate: number): VoicedSentence => ({
  scene: "dark",
  index: 1,
  text: "Now, with Scene.",
  voice: "en-US-Chirp3-HD-Aoede",
  rate,
  file,
  seconds: TONE_SECONDS,
  wpm: 120,
});

it("measures where speech lies and flags a sentence cut off at full level", async () => {
  const dir = await mkdtemp(join(tmpdir(), "demo-voice-"));
  const whole = await measureSpeech(await tone(dir, "whole", false));
  assert.ok(Math.abs(whole.onset - LEAD_SECONDS) < 0.05);
  assert.ok(Math.abs(whole.offset - (LEAD_SECONDS + TONE_SECONDS)) < 0.05);
  const cut = await measureSpeech(await tone(dir, "cut", true));
  assert.ok(cut.edges[1] > whole.edges[1] + 40);
});

it("reuses a kept sentence at whatever rate it was kept, unless its text changed or it is clipped", async () => {
  const dir = await mkdtemp(join(tmpdir(), "demo-voice-"));
  const kept = sentence(await tone(dir, "kept", false), 0.85);
  const want = { scene: kept.scene, index: kept.index, text: kept.text, voice: kept.voice };
  assert.equal(await keptSentence([kept], want), kept);
  assert.equal(await keptSentence([kept], { ...want, text: "Now, with Scene!" }), null);
  const cut = sentence(await tone(dir, "cut", true), 1);
  assert.equal(await keptSentence([cut], want), null);
});

it("treats a full-scale burst before the words as clipped, though its edges are silent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "demo-voice-"));
  const file = join(dir, "burst.wav");
  // 0.2 s of noise four times louder than full scale, then a quiet tone, silence at both ends.
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `anoisesrc=amplitude=1:duration=0.2,volume=4,adelay=${LEAD_SECONDS * 1000},apad=pad_dur=${TONE_SECONDS}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=220:duration=${TONE_SECONDS},volume=0.3,adelay=${(LEAD_SECONDS + 0.3) * 1000},apad=pad_dur=${LEAD_SECONDS}`,
    "-filter_complex",
    // Samples past full scale are hard-clipped when written as 16-bit PCM, as in the Chirp file.
    "[0][1]amix=inputs=2:normalize=0",
    "-c:a",
    "pcm_s16le",
    file,
  ]);
  const levels = await measureSpeech(file);
  assert.ok(Math.max(...levels.edges) < -40);
  assert.ok(levels.fullScale > 24);
  const burst = sentence(file, 1);
  const want = { scene: burst.scene, index: burst.index, text: burst.text, voice: burst.voice };
  assert.equal(await keptSentence([burst], want), null);
});
