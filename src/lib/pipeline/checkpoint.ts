import { encodeWav, wavLine, type TrimmedLine } from "../media/narration-track";
import type { RunSummary } from "./events";
import type { Cue, Gap, SceneMap, SpeechSegment } from "./schemas";

interface ReviewedTrack {
  speech: SpeechSegment[];
  scene: SceneMap;
  gaps: Gap[];
  cues: Cue[];
}

export type RunCheckpoint =
  | { boundary: "analyzed" }
  | ({ boundary: "reviewed" } & ReviewedTrack)
  | ({ boundary: "voiced"; audio: Record<string, string> } & ReviewedTrack)
  | ({
      boundary: "fixed";
      audio: Record<string, string>;
      finalReview: RunSummary["finalReview"];
      finalFix: RunSummary["finalFix"];
    } & ReviewedTrack);

/** PCM kept between stages is serialized as a mono WAV alongside the immutable checkpoint state. */
export const savedVoices = (lines: Map<string, TrimmedLine>) =>
  Object.fromEntries(
    Array.from(lines, ([id, line]) => [
      id,
      encodeWav(line.pcm, line.sampleRate).toString("base64"),
    ]),
  );

export const restoreVoices = (audio: Record<string, string>) =>
  new Map(Object.entries(audio).map(([id, wav]) => [id, wavLine(Buffer.from(wav, "base64"))]));
