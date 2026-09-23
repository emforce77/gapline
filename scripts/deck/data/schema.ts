/**
 * The parts of Scene's run records the deck reads. Parsing with these schemas makes a missing file or
 * field stop the build with its path, instead of drawing a slide from an undefined.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";

const Span = z.object({ start: z.number(), end: z.number() });

const Violation = z.object({ rule: z.string(), quote: z.string(), reason: z.string() });
const Review = z.object({ pass: z.boolean(), violations: z.array(Violation), fix: z.string() });
const Version = z.object({
  text: z.string(),
  by: z.string(),
  review: Review.optional(),
  voice: z.object({ seconds: z.number(), rate: z.number() }).optional(),
});
const Cue = z.object({
  id: z.string(),
  gapId: z.string(),
  start: z.number(),
  windowEnd: z.number(),
  status: z.enum(["approved", "fits", "dropped", "removed"]),
  seconds: z.number().optional(),
  droppedReason: z.string().optional(),
  versions: z.array(Version).min(1),
});
export type RunCue = z.infer<typeof Cue>;
export type RunVersion = z.infer<typeof Version>;

const Missing = z.object({ gapId: z.string(), at: z.number(), what: z.string() });

/** What an editor changed in one session: a line rewritten, or (action "remove") taken out. */
const HumanEdit = z.object({
  cueId: z.string(),
  action: z.string().optional(),
  before: z.string(),
  after: z.string().optional(),
  from: z.number(),
  at: z.string(),
});
export type HumanEditRecord = z.infer<typeof HumanEdit>;

export const ScriptSchema = z.object({
  runId: z.string(),
  parentRunId: z.string().nullish(),
  humanEdits: z.array(HumanEdit).optional(),
  summary: z.object({
    qualityStatus: z.string(),
    clipSeconds: z.number(),
    gapSeconds: z.number(),
    narrationSeconds: z.number(),
    overlapWithSpeechSeconds: z.number(),
    costUsd: z.number(),
    wallSeconds: z.number(),
    costByStage: z.record(z.string(), z.number()),
    cuesShipped: z.number(),
    finalReview: z.object({ missing: z.array(Missing) }),
  }),
  gaps: z.array(Span.extend({ id: z.string() })),
  speech: z.array(Span.extend({ text: z.string() })),
  scene: z.object({
    shots: z.array(
      Span.extend({ setting: z.string(), action: z.string(), onScreenText: z.string() }),
    ),
    sounds: z.array(Span.extend({ label: z.string(), kind: z.string() })),
  }),
  cues: z.array(Cue),
});
export type Script = z.infer<typeof ScriptSchema>;

export const LiveCheckSchema = z.object({
  service: z.string().url(),
  parentRunId: z.string(),
  childRunId: z.string(),
  unchangedWavFilesIdentical: z.number(),
  idempotentRepeat: z.boolean(),
  privateUploadDeniedStatuses: z.array(z.number()).min(1),
  childApiCost: z.number(),
  childWallSeconds: z.number(),
});

const EvalRun = z.object({
  projectId: z.string(),
  setting: z.enum(["high", "medium"]),
  runId: z.string(),
  status: z.enum(["done", "failed"]),
  modelQuality: z.string().optional(),
  modelMissing: z.array(z.string()).optional(),
  observedEssentialOmissions: z.number().nullable(),
  /** Voiced lines that overlap what an independent recognizer hears (null when the run stopped). */
  independentAsrOverlapCandidates: z
    .array(z.object({ cueId: z.string(), seconds: z.number() }))
    .nullable(),
  error: z.string().optional(),
});
export const EvalSummarySchema = z.object({ runs: z.array(EvalRun) });
export type EvalRunRecord = z.infer<typeof EvalRun>;

export const EvalCasesSchema = z.array(
  z.object({
    id: z.string(),
    language: z.enum(["ko", "en"]),
    seconds: z.number(),
    facts: z.array(z.string()),
  }),
);

export const SecondAsrSchema = z.object({
  source: z.string(),
  segments: z.array(
    Span.extend({ text: z.string(), words: z.array(Span.extend({ word: z.string() })).min(1) }),
  ),
});

/** runtime/showcase.json: the run the app shows as the sample, per narration language. */
export const ShowcasePinSchema = z.object({
  projectId: z.string(),
  runs: z.object({ ko: z.string() }),
});

const TimedWord = Span.extend({ word: z.string(), probability: z.number() });
/** runtime/deck/evidence/slice-asr.json, written by scripts/deck/probe/slice_asr.py. */
export const SliceAsrSchema = z.object({
  source: z.string(),
  producedBy: z.string(),
  producedAt: z.string(),
  clip: z.string(),
  clipSha256: z.string().length(64),
  slices: z.array(z.object({ from: z.number(), to: z.number(), words: z.array(TimedWord) })),
});

/** The re-listen regression fixture (tests/fixtures/tos-opening-relisten.json), as the deck reads it. */
export const RelistenFixtureSchema = z.object({
  showcaseGap: Span.extend({ id: z.string() }),
  showcaseLine: z.object({ gapId: z.string(), at: z.number(), text: z.string() }),
  relisten: z.array(
    z.object({
      from: z.number(),
      response: z.object({
        results: z.array(
          z.object({
            alternatives: z.array(
              z.object({
                words: z.array(
                  z.object({ word: z.string(), startOffset: z.string(), endOffset: z.string() }),
                ),
              }),
            ),
          }),
        ),
      }),
    }),
  ),
});

/** Read and validate one JSON file; the error names the file. */
export function readJsonFile<T>(path: string, schema: z.ZodType<T>): T {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    throw new Error(`${path} does not match what the deck needs:\n${parsed.error.message}`);
  return parsed.data;
}
