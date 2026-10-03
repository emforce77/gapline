import { decodeMonoPcm } from "../media/ffmpeg";
import type { SpeechSegment } from "./schemas";

/** Loudness is measured over frames this long: short enough to find where a word can start. */
export const LOUDNESS_FRAME_SECONDS = 0.05;
/**
 * A frame at or below this RMS level (dBFS) holds nothing a listener or a recognizer can hear.
 * Measured 2026-10-03: digital silence decodes to exact zeros; the quietest frames of the films in
 * the QA corpus are −89 dB (Tears of Steel fade-in) and −74 dB (Big Buck Bunny music fade), and
 * their median frames −35 to −20 dB.
 */
export const SILENT_FRAME_DBFS = -70;
/** Recognizer audio is 16 kHz mono; the same is enough to tell sound from silence. */
const SAMPLE_RATE = 16000;

export interface Span {
  start: number;
  end: number;
}

/** Spans of consecutive audible frames, in seconds from the start of the samples. */
export function audibleSpans(pcm: Float32Array, sampleRate: number): Span[] {
  const frame = Math.round(sampleRate * LOUDNESS_FRAME_SECONDS);
  const floor = frame * 10 ** (SILENT_FRAME_DBFS / 10);
  const spans: Span[] = [];
  for (let i = 0; i < pcm.length; i += frame) {
    const end = Math.min(pcm.length, i + frame);
    let energy = 0;
    for (let j = i; j < end; j++) energy += pcm[j] * pcm[j];
    // Compared as energy over a whole frame, so a short last frame is not louder than it is.
    if (energy <= floor) continue;
    const span = { start: i / sampleRate, end: end / sampleRate };
    const last = spans.at(-1);
    if (last && last.end === span.start) last.end = span.end;
    else spans.push(span);
  }
  return spans;
}

/** Where the clip's soundtrack can be heard at all; empty for a silent or missing soundtrack. */
export async function measureAudible(clipFile: string): Promise<Span[]> {
  return audibleSpans(await decodeMonoPcm(clipFile, SAMPLE_RATE), SAMPLE_RATE);
}

/**
 * Speech kept to the audio it can have come from. A recognizer sometimes attaches a word to
 * digital silence (measured on a 90 s Tears of Steel cut: "What?" at 0–1.64 s, where every sample
 * is zero). A segment with no audible frame is dropped; any other is shortened to its first and
 * last audible frame. Segments are never extended, and audible speech is never removed.
 */
export function trimToAudible(
  speech: SpeechSegment[],
  audible: Span[],
): { speech: SpeechSegment[]; dropped: number; shortened: number } {
  const kept: SpeechSegment[] = [];
  let shortened = 0;
  for (const segment of speech) {
    const heard = audible.filter((a) => a.end > segment.start && a.start < segment.end);
    if (heard.length === 0) continue;
    const start = Math.max(segment.start, heard[0].start);
    const end = Math.min(segment.end, heard.at(-1)!.end);
    if (start === segment.start && end === segment.end) kept.push(segment);
    else {
      shortened++;
      kept.push({ ...segment, start, end });
    }
  }
  return { speech: kept, dropped: speech.length - kept.length, shortened };
}
