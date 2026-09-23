import type { RunErrorCode } from "../api-contract";
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

export type StageId =
  "hear" | "relisten" | "watch" | "gaps" | "write" | "review" | "voice" | "verify" | "fix" | "mix";

/** What re-recognizing each usable silence on its own found (relisten.ts). */
export interface RelistenReport {
  /** Silences long enough for a line, each recognized again as its own short slice. */
  gapsChecked: number;
  /** Recognized words inside those silences that the first pass had not placed there. */
  wordsFound: number;
  /** Narration room those words closed, in seconds. */
  blockedSeconds: number;
}

export interface RunSummary {
  qualityStatus?: "review_needed" | "model_checked";
  finalReview?: { verdicts: Verdict[]; missing: MissingItem[] };
  /**
   * What the final check found (failing lines, missing moments) and how many of them the fix stage
   * turned into voiced lines; `finalReview` is that check brought up to date with the fixes. Absent
   * when the check found nothing that could be fixed, and in runs before 2026-09-23.
   */
  finalFix?: { failing: number; missing: number; rewritten: number; added: number };
  costStatus?: "known" | "unresolved";
  analysisReused?: { speech: boolean; scene: boolean };
  parentRunId?: string;
  clipSeconds: number;
  gapCount: number;
  gapSeconds: number;
  /** Total room below the little-room threshold (assessRoom); absent before 2026-09-23. */
  littleRoom?: boolean;
  cuesWritten: number;
  cuesShipped: number;
  cuesDropped: number;
  /** Lines an editor removed (Cue status "removed"); absent before 2026-09-23. */
  cuesRemoved?: number;
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
  | {
      type: "speech";
      segments: SpeechSegment[];
      /** The segments include the per-gap re-listen; absent before 2026-09-23. */
      relistened?: boolean;
    }
  /** Sent after the re-listen stage when this run did it (not when it reused a saved analysis). */
  | ({ type: "relisten" } & RelistenReport)
  | { type: "scene"; map: SceneMap }
  | { type: "gaps"; gaps: Gap[] }
  /** Sent right after `gaps` when the clip leaves too little room to describe much (assessRoom). */
  | { type: "little_room"; gapSeconds: number; thresholdSeconds: number; gapCount: number }
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
  | {
      type: "run_failed";
      /** Stable reason; absent in runs recorded before 2026-09-23 (their `error` is raw text). */
      code?: RunErrorCode;
      /** Same value as `code` (kept for older readers); details are only in the server log. */
      error: string;
      retryable?: boolean;
      retryAfterSeconds?: number;
      /** budget_daily: when the allowance renews. */
      resetAt?: string;
    };

export type TimedRunEvent = RunEvent & { t: number };
