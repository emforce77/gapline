import { z } from "zod";
import { RULE_IDS } from "./guidelines";

/** What the listener heard. Times are seconds from the start of the clip. */
export const SpeechSegmentSchema = z
  .object({
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    speaker: z
      .string()
      .describe("Short visual-free descriptor, e.g. 'young man' — never a guessed name"),
    text: z.string().describe("Verbatim words in the original language"),
    /** "relisten": found when the gap it sits in was recognized again on its own (relisten.ts). */
    heard: z.literal("relisten").optional(),
    /** BCP-47 tag of the language the recognizer heard (hear.ts); absent in older analyses. */
    lang: z.string().optional(),
  })
  .refine((s) => s.end > s.start, "end must follow start");

export const SoundEventSchema = z
  .object({
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    label: z.string(),
    kind: z
      .enum(["protect", "describe", "ambient"])
      .describe(
        "protect = a brief (under 3 s) story-critical cue narration must not cover; " +
          "describe = a sound whose source a listener cannot identify by ear; " +
          "ambient = music, background or any long continuous sound that narration may duck under",
      ),
  })
  .refine((s) => s.end > s.start, "end must follow start");

export const DialogueMapSchema = z.object({
  speech: z.array(SpeechSegmentSchema),
  sounds: z.array(SoundEventSchema),
});

export type SpeechSegment = z.infer<typeof SpeechSegmentSchema>;
export type SoundEvent = z.infer<typeof SoundEventSchema>;
export type DialogueMap = z.infer<typeof DialogueMapSchema>;

export const ShotSchema = z
  .object({
    start: z.number().nonnegative(),
    end: z.number().nonnegative(),
    setting: z
      .string()
      .describe("Where and when: place, time of day, weather — only what is visible"),
    action: z
      .string()
      .describe("Who or what is visible and what they do, concretely, in present tense"),
    onScreenText: z
      .string()
      .describe(
        "The film's own words on screen, verbatim: titles, credits, captions or subtitles, time and " +
          "place cards, signs; empty string when none",
      ),
  })
  .refine((s) => s.end > s.start, "end must follow start");

export const CharacterSchema = z.object({
  id: z.string().describe("Stable id: c1, c2, ..."),
  look: z.string().describe("Visual descriptor a narrator can use before the name is known"),
  name: z
    .string()
    .describe(
      "Name as spoken in dialogue or shown on screen as this person's name; empty string if neither",
    ),
  nameFirstSpokenAt: z
    .number()
    .nonnegative()
    .nullable()
    .describe("Seconds when the name is first said aloud or shown; null if never"),
});

export const SceneMapSchema = z
  .object({
    shots: z.array(ShotSchema),
    characters: z.array(CharacterSchema),
    sounds: z
      .array(SoundEventSchema)
      .describe("Only sounds heard on the soundtrack; empty when it is silent"),
  })
  .refine(
    (s) => new Set(s.characters.map((c) => c.id)).size === s.characters.length,
    "Duplicate character id",
  );

export type Shot = z.infer<typeof ShotSchema>;
export type Character = z.infer<typeof CharacterSchema>;
export type SceneMap = z.infer<typeof SceneMapSchema>;

/** A window where narration can be spoken without covering dialogue or protected sound. */
export interface Gap {
  id: string;
  start: number;
  end: number;
}

export type Language = "ko" | "en";
export type Density = "brief" | "standard";

/** Writer output: where a line starts (inside a gap) and what it says. The window end is computed. */
export const DraftCueSchema = z.object({
  gapId: z.string(),
  at: z
    .number()
    .nonnegative()
    .describe(
      "Second the line starts; inside its gap, never before what it describes appears on screen",
    ),
  text: z.string().trim().min(1),
});
export const DraftScriptSchema = z.object({ cues: z.array(DraftCueSchema) });
export type DraftCue = z.infer<typeof DraftCueSchema>;

export const ViolationSchema = z.object({
  rule: z.enum(RULE_IDS),
  quote: z.string().describe("The exact words in the line that break the rule"),
  reason: z.string().describe("One sentence, in the language of the line"),
});
export const VerdictSchema = z
  .object({
    cueId: z.string(),
    pass: z.boolean(),
    violations: z.array(ViolationSchema),
    fix: z
      .string()
      .describe(
        "How to fix it in one sentence, in the language of the line; any wording it suggests must " +
          "itself obey every rule (for on-screen text, read the text word for word, after a short " +
          "lead-in naming where it is written when one is needed, such as 'A sign reads:'; never say " +
          "it appears on screen); empty when pass",
      ),
  })
  .refine(
    (v) => (v.pass ? v.violations.length === 0 && v.fix.trim() === "" : v.violations.length > 0),
    "Contradictory review verdict",
  );
export const MissingItemSchema = z.object({
  gapId: z.string(),
  at: z.number().nonnegative().describe("Second inside that gap where a line could describe it"),
  what: z.string().describe("The visual information no line covers, in the language of the lines"),
});
export const ReviewSchema = z
  .object({
    verdicts: z.array(VerdictSchema),
    missing: z
      .array(MissingItemSchema)
      .describe(
        "Important visual information no line covers — a new place or time, a main character's first " +
          "appearance, essential on-screen text (each title, time or place card, caption or sign in the " +
          "notes that no line reads; not other credits), a key action — that a gap with free room " +
          "could still hold. Empty when nothing important is missing.",
      ),
  })
  .refine(
    (r) => new Set(r.verdicts.map((v) => v.cueId)).size === r.verdicts.length,
    "Duplicate verdict id",
  );
export type MissingItem = z.infer<typeof MissingItemSchema>;
export type Violation = z.infer<typeof ViolationSchema>;
export type Verdict = z.infer<typeof VerdictSchema>;

export const RevisionSchema = z
  .object({
    revisions: z.array(z.object({ cueId: z.string(), text: z.string().trim().min(1) })),
    additions: z
      .array(DraftCueSchema)
      .describe("New lines for the missing items; empty when none were requested"),
  })
  .refine(
    (r) => new Set(r.revisions.map((v) => v.cueId)).size === r.revisions.length,
    "Duplicate revision id",
  );

/**
 * How each version of a line came to be; the UI shows this history. A "remove" version records an
 * editor taking the line out of the track: its text is the removed words, and it is never voiced.
 */
export interface CueVersion {
  text: string;
  by: "write" | "revise" | "shorten" | "add" | "human" | "remove";
  start?: number;
  model: string;
  review?: Verdict;
  voice?: { seconds: number; rate: number };
}

/** "removed": an editor took a line out of the track. "dropped" is always the pipeline's decision. */
export type CueStatus = "approved" | "fits" | "dropped" | "removed";

export interface Cue {
  id: string;
  gapId: string;
  start: number;
  /** Latest second the line may still be speaking: the next line's start or the gap end. */
  windowEnd: number;
  versions: CueVersion[];
  status: CueStatus | "pending";
  droppedReason?: "no_room" | "review" | "too_long" | "invalid_placement" | "unchanged";
  /** Final narration file relative to the run directory, trimmed of leading/trailing silence. */
  audioFile?: string;
  seconds?: number;
  rate?: number;
}
