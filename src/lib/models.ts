/**
 * Google models only (OpenRouter IDs). One place so the ledger, UI and docs agree.
 * Prices are OpenRouter list prices per 1M tokens, checked 2026-09-21 via /api/v1/models.
 */
export const MODELS = {
  /** Watches, listens, writes and reviews. $0.75 in / $3.75 out. */
  flash: "google/gemini-3.8-flash",
} as const;

/** How Gemini is reached, as shown on the deck, video and README. Change it here and nowhere else. */
export const GEMINI_ACCESS_LABEL = "via OpenRouter (development)";

export type Effort = "low" | "medium" | "high";

/**
 * Thinking level per stage. Overridable for measurement with SCENE_EFFORT_<STAGE>
 * (e.g. SCENE_EFFORT_WRITE=low); unset means the model default.
 */
const STAGE_EFFORT: Record<string, Effort | undefined> = {
  // Measured on tos-opening (65 s). The writer at the default level spent 13–18k thinking tokens
  // (85–117 s) per draft; "medium" with the clip in view gave the cleanest drafts (no rejections in
  // Korean). "low" drafts faster but misplaced lines in time. A revision is a small edit: "low".
  // The reviewer thinks hardest: it is the quality gate (at "low" it passed a "화면이" framing).
  write: "medium",
  revise: "low",
  review: "high",
};

export function reasoningEffort(
  stage: "watch" | "write" | "revise" | "review",
): Effort | undefined {
  const override = process.env[`SCENE_EFFORT_${stage.toUpperCase()}`];
  if (override) return override as Effort;
  return STAGE_EFFORT[stage];
}
