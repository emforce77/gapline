import { callStructured } from "../llm/openrouter";
import { reasoningEffort } from "../models";
import {
  languageName,
  lengthRule,
  renderGaps,
  renderNames,
  renderScene,
  renderTranscript,
  styleRules,
  type ClipContext,
} from "./context";
import { ruleSummaryForPrompt } from "./guidelines";
import {
  DraftScriptSchema,
  RevisionSchema,
  type Cue,
  type DraftCue,
  type MissingItem,
  type Violation,
} from "./schemas";
import { UNIT_NAME } from "./length";

function writerSystem(context: ClipContext): string {
  return `You are a professional audio describer writing ${languageName(context.language)} audio description
for blind and low-vision viewers. Narration may only be spoken inside the gaps listed below: the time
between lines of dialogue and away from story-critical sounds. You see the clip itself and timed notes from
a first viewing; trust the picture over the notes, and place each line where the picture shows it.

${styleRules(context)}
${lengthRule(context.language)}

Placement: "at" is the second the line starts, inside its gap and as close as possible to the moment it
describes. A line's room runs from its "at" to the next line's "at" in the same gap, or to the gap end.
Leave at least 1.2 s of room for every line. Describe place and time changes first, then people and action.
Read essential on-screen text (titles, time jumps, signs) in the nearest gap.

A reviewer will reject lines that break these rules:
${ruleSummaryForPrompt()}`;
}

/**
 * The writer and reviser watch the clip too. Measured on tos-opening: working from the first-viewing
 * notes alone, the writer trusted their loose timestamps and placed lines at the wrong moments (7 of 9
 * English lines rejected as "unseen"); with the clip it placed them where the picture shows them.
 */
function writerSees(context: ClipContext) {
  return [{ type: "video_url" as const, video_url: { url: context.videoDataUrl } }];
}

function clipFacts(context: ClipContext): string {
  return `Clip length: ${context.clipSeconds.toFixed(1)} s.

Gaps where narration may speak:
${renderGaps(context.gaps)}

Dialogue (recognized speech, original language):
${renderTranscript(context.speech)}

People (use names only from the time given):
${renderNames(context.scene)}

First-viewing notes:
${renderScene(context.scene)}`;
}

export async function writeScript(input: {
  context: ClipContext;
  model: string;
  ledgerFile: string;
  onDelta?: (text: string) => void;
}): Promise<DraftCue[]> {
  const { data } = await callStructured({
    label: "write",
    model: input.model,
    system: writerSystem(input.context),
    user: [
      ...writerSees(input.context),
      { type: "text", text: `${clipFacts(input.context)}\n\nWrite the audio description script.` },
    ],
    schemaName: "audio_description_script",
    schema: DraftScriptSchema,
    temperature: 0.5,
    ledgerFile: input.ledgerFile,
    reasoningEffort: reasoningEffort("write"),
    onDelta: input.onDelta,
  });
  return data.cues;
}

export interface RevisionRequest {
  cue: Cue;
  text: string;
  /** Why the line must change: reviewer findings, or a measured overrun. */
  violations: Violation[];
  fix: string;
  maxUnits: number;
}

/** Rewrites only the listed lines, keeping their placement. Used for rejections and for overruns. */
export async function reviseLines(input: {
  context: ClipContext;
  model: string;
  ledgerFile: string;
  label: string;
  requests: RevisionRequest[];
  otherLines: { id: string; start: number; text: string }[];
  /** Coverage gaps the reviewer found; each becomes a new line if its gap has room. */
  missing?: MissingItem[];
}): Promise<{ revisions: Map<string, string>; additions: DraftCue[] }> {
  const unit = UNIT_NAME[input.context.language];
  const requested = input.requests
    .map((r) => {
      const findings = r.violations
        .map((v) => `  - ${v.rule}: "${v.quote}" — ${v.reason}`)
        .join("\n");
      return (
        `- ${r.cue.id} at ${r.cue.start.toFixed(1)} s, room ${(r.cue.windowEnd - r.cue.start).toFixed(1)} s, ` +
        `at most ${r.maxUnits} ${unit}\n  current: ${r.text}\n${findings}\n  fix: ${r.fix}`
      );
    })
    .join("\n");
  const context = input.otherLines
    .map((l) => `- ${l.id} at ${l.start.toFixed(1)} s: ${l.text}`)
    .join("\n");
  const { data } = await callStructured({
    label: input.label,
    model: input.model,
    system: writerSystem(input.context),
    user: [
      ...writerSees(input.context),
      {
        type: "text",
        text:
          `${clipFacts(input.context)}\n\nThe rest of the script (keep names consistent with it):\n` +
          `${context || "(none)"}\n\nRewrite these lines. Keep each line's meaning where the rules allow, ` +
          `fix every finding, and stay within its length.\n${requested || "(none)"}` +
          (input.missing?.length
            ? `\n\nAlso add one new line for each missing item, in the named gap near the given second, ` +
              `where it has at least 1.2 s of room before the next line:\n` +
              input.missing.map((m) => `- ${m.gapId} at ${m.at.toFixed(1)} s: ${m.what}`).join("\n")
            : ""),
      },
    ],
    schemaName: "revised_lines",
    schema: RevisionSchema,
    temperature: 0.3,
    ledgerFile: input.ledgerFile,
    reasoningEffort: reasoningEffort("revise"),
  });
  return {
    revisions: new Map(data.revisions.map((r) => [r.cueId, r.text])),
    additions: input.missing?.length ? data.additions : [],
  };
}
