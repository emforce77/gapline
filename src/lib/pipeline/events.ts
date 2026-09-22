import type {
  Cue,
  Density,
  Gap,
  Language,
  MissingItem,
  SceneMap,
  SpeechSegment,
  Verdict,
} from "./schemas";

export type StageId = "hear" | "watch" | "gaps" | "write" | "review" | "voice" | "verify" | "mix";

export interface RunSummary {
  qualityStatus?: "review_needed" | "model_checked";
  finalReview?: { verdicts: Verdict[]; missing: MissingItem[] };
  costStatus?: "known" | "unresolved";
  analysisReused?: { speech: boolean; scene: boolean };
  parentRunId?: string;
  clipSeconds: number;
  gapCount: number;
  gapSeconds: number;
  cuesWritten: number;
  cuesShipped: number;
  cuesDropped: number;
  /** Lines rejected at least once by the reviewer, and the rule counts behind those rejections. */
  cuesRejected: number;
  violationsByRule: Record<string, number>;
  /** Shipped lines whose measured audio fits inside their window (should equal cuesShipped). */
  cuesFitting: number;
  narrationSeconds: number;
  /** Seconds of narration that overlap recognized speech (must be 0). */
  overlapWithSpeechSeconds: number;
  costUsd: number;
  costByStage: Record<string, number>;
  wallSeconds: number;
  llmCalls: number;
}

export interface RunFiles {
  described: string;
  narration: string;
  vtt: string;
  script: string;
}

/** Append-only log of a run. The run state is a reduction of these events, on the server and in the UI. */
export type RunEvent =
  | {
      type: "run_started";
      runId: string;
      language: Language;
      density: Density;
      writerModel: string;
      reviewerModel: string;
      clipSeconds: number;
    }
  | { type: "stage"; stage: StageId; state: "started" | "done"; seconds?: number }
  | { type: "speech"; segments: SpeechSegment[] }
  | { type: "scene"; map: SceneMap }
  | { type: "gaps"; gaps: Gap[] }
  | { type: "cue_written"; cue: Cue }
  | { type: "cue_reviewed"; cueId: string; round: number; verdict: Verdict }
  | { type: "coverage"; round: number; missing: MissingItem[] }
  | { type: "cue_window"; cueId: string; windowEnd: number }
  | { type: "cue_revised"; cueId: string; by: "revise" | "shorten"; text: string; model: string }
  | {
      type: "cue_voiced";
      cueId: string;
      seconds: number;
      rate: number;
      window: number;
      fits: boolean;
    }
  | { type: "cue_dropped"; cueId: string; reason: NonNullable<Cue["droppedReason"]> }
  | { type: "writer_delta"; text: string }
  | { type: "run_done"; summary: RunSummary; files: RunFiles; cues: Cue[] }
  | { type: "run_failed"; error: string; retryable?: boolean; retryAfterSeconds?: number };

export type TimedRunEvent = RunEvent & { t: number };
