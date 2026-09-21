import type { Gap, SpeechSegment } from "../pipeline/schemas";
import type { SubtitleCue } from "../srt";

const FRAME_SECONDS = 0.05;

export interface DialogueScore {
  /** Share of predicted speech time that is truly dialogue. */
  speechPrecision: number;
  /** Share of true dialogue time the listener caught. */
  speechRecall: number;
  /** True dialogue seconds that fall inside a narration gap: the error that makes narration talk over actors. */
  dialogueInsideGapsSeconds: number;
  gapCount: number;
  gapSeconds: number;
}

function frames(spans: { start: number; end: number }[], total: number): Uint8Array {
  const out = new Uint8Array(Math.ceil(total / FRAME_SECONDS));
  for (const s of spans) {
    const from = Math.max(0, Math.floor(s.start / FRAME_SECONDS));
    const to = Math.min(out.length, Math.ceil(s.end / FRAME_SECONDS));
    for (let i = from; i < to; i++) out[i] = 1;
  }
  return out;
}

/** Scores the listener against subtitle timing. Subtitles are approximate, so read the numbers as ±0.3 s. */
export function scoreDialogue(
  predicted: SpeechSegment[],
  truth: SubtitleCue[],
  gaps: Gap[],
  clipSeconds: number,
): DialogueScore {
  const p = frames(predicted, clipSeconds);
  const t = frames(truth, clipSeconds);
  const g = frames(gaps, clipSeconds);
  let tp = 0;
  let pCount = 0;
  let tCount = 0;
  let inside = 0;
  for (let i = 0; i < p.length; i++) {
    pCount += p[i];
    tCount += t[i];
    if (p[i] && t[i]) tp++;
    if (t[i] && g[i]) inside++;
  }
  return {
    speechPrecision: pCount ? tp / pCount : 0,
    speechRecall: tCount ? tp / tCount : 0,
    dialogueInsideGapsSeconds: inside * FRAME_SECONDS,
    gapCount: gaps.length,
    gapSeconds: gaps.reduce((sum, gap) => sum + gap.end - gap.start, 0),
  };
}
