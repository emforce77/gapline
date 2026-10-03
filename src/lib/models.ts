/**
 * Google models only (native Gemini API IDs). One place so the ledger, UI and docs agree.
 */
export const MODELS = {
  /** Watches, writes and reviews. */
  flash: "gemini-3.8-flash",
} as const;

/** How Gemini is reached, as shown on the deck, video and README. Change it here and nowhere else. */
export const GEMINI_ACCESS_LABEL = "via Gemini API (Google AI Studio)";

export type Effort = "low" | "medium" | "high";

/**
 * Thinking level per stage. Overridable for measurement with SCENE_EFFORT_<STAGE>
 * (e.g. SCENE_EFFORT_WRITE=low); unset means the model default.
 */
const STAGE_EFFORT: Record<string, Effort | undefined> = {
  // Measured on tos-opening (65 s). The writer at the default level spent 13–18k thinking tokens
  // (85–117 s) per draft; "medium" with the clip in view gave the cleanest drafts (no rejections in
  // Korean). "low" drafts faster but misplaced lines in time. A revision is a small edit: "low".
  // The reviewer thinks hardest: it is the quality gate (at "low" it passed a "화면이" framing). Its
  // first pass over the whole script and the final check stay at "high": on 2026-09-22 "medium" there
  // lost the "40 years later" time jump without listing it (docs/EVALUATION.md). Re-reviewing a few
  // rewritten or shortened lines is "rereview": at "high" a one-line re-check thought for a median
  // 3.4k tokens (about 45 s); see docs/EVALUATION.md, 2026-10-03, for the measured runs.
  write: "medium",
  revise: "low",
  review: "high",
  rereview: "medium",
};

export function reasoningEffort(
  stage: "watch" | "write" | "revise" | "review" | "rereview",
): Effort | undefined {
  const override = process.env[`SCENE_EFFORT_${stage.toUpperCase()}`];
  if (override) return override as Effort;
  return STAGE_EFFORT[stage];
}
