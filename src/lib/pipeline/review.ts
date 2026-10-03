import { ModelOutputError } from "../errors";
import { callStructured } from "../llm/gemini";
import { reasoningEffort } from "../models";
import {
  DENSITY_STYLE,
  languageName,
  renderGaps,
  renderNames,
  renderScene,
  renderTranscript,
  type ClipContext,
} from "./context";
import { ruleSummaryForPrompt } from "./guidelines";
import { UNIT_NAME } from "./length";
import { ReviewSchema, type MissingItem, type Verdict } from "./schemas";

/** A review that names lines it was not given, or skips one, is asked for once more. */
const REVIEW_ATTEMPTS = 2;

/**
 * Exported for tests, which pin the instructions the reviewer is given. `lengthLimits`: the lines
 * carry a length limit for their fix (re-reviews only; see reviewLines).
 */
export function reviewerSystem(
  context: ClipContext,
  finalOutput = false,
  lengthLimits = false,
): string {
  return `You review ${languageName(context.language)} audio description lines for blind and low-vision viewers
against published guidelines. You did not write them. You see the clip itself; judge every line against
the picture and the soundtrack at that moment.

Rules (a line fails if it breaks any of them):
${ruleSummaryForPrompt()}

For each line return pass=true with no violations, or pass=false with every violation: the rule id, the
exact words that break it, and a one-sentence reason. "fix" says how to repair the line in one sentence.
Write reason and fix in ${languageName(context.language)}. The fix must itself obey every rule above: any
wording it suggests must pass this same review${lengthLimits ? ", and must fit the line's length limit (the writer copies the wording,\nand a longer one cannot be voiced in the room)" : ""}. For example, a fix for on-screen text reads the text
itself; it never says the text appears or is shown on screen, because that is viewer or camera framing.
Be strict about spoiler and unseen. For every
person a line mentions, find them in the People list: naming someone before the time given, naming someone
the list says is never named, or identifying an unnamed person with a named one ("older Thom") is a
spoiler; anything known only from outside the clip — including knowledge of this film — is unseen.
Do not fail a line for style preferences the rules do not cover.

When you review the whole script, also list what is missing: important visual information no line covers
(a new place or time, a main character's first appearance, essential on-screen text, a key action)
${finalOutput ? "even if there is no room left to add it. This is the final surviving-output audit." : "that a gap could still hold, only where the gap has at least 1.2 s of free room outside existing lines."} Judge it
by the density the script was written for — ${DENSITY_STYLE[context.density]} When you review only some
lines, return missing as an empty list.`;
}

export async function reviewLines(input: {
  context: ClipContext;
  model: string;
  ledgerFile: string;
  label: string;
  /**
   * maxUnits: the most words (syllables in Korean) a rewrite of the line can have in its room, shown
   * as a limit for the fix. Given on re-reviews only: on the first review of a 65 s script it raised
   * the reviewer's thinking from 28–33k to 35–36k tokens (about 15 s; docs/EVALUATION.md, 2026-10-03).
   */
  lines: { id: string; start: number; end: number; text: string; maxUnits?: number }[];
  /** Already approved lines, for naming consistency. */
  approved: { id: string; start: number; text: string }[];
  /** True when the lines are the whole script, so coverage can be judged. */
  wholeScript: boolean;
  /** Final output audit: report essential omissions even if no room remains. */
  finalOutput?: boolean;
  /**
   * "rereview" for a second look at a few rewritten or shortened lines, which thinks less than the
   * first pass over the whole script and the final check (src/lib/models.ts).
   */
  stage?: "review" | "rereview";
}): Promise<{ verdicts: Verdict[]; missing: MissingItem[] }> {
  const unit = UNIT_NAME[input.context.language];
  const lines = input.lines
    .map(
      (l) =>
        `- ${l.id} [${l.start.toFixed(3)}–${l.end.toFixed(3)} s]: ${l.text}` +
        (l.maxUnits ? `\n  length limit for a fix: at most ${l.maxUnits} ${unit}` : ""),
    )
    .join("\n");
  const approved = input.approved
    .map((l) => `- ${l.id} at ${l.start.toFixed(3)} s: ${l.text}`)
    .join("\n");
  let retry = "";
  for (let attempt = 1; ; attempt++) {
    const { data } = await callStructured({
      label: input.label,
      model: input.model,
      system: reviewerSystem(
        input.context,
        input.finalOutput,
        input.lines.some((l) => l.maxUnits),
      ),
      user: [
        { type: "video_url", video_url: { url: input.context.videoDataUrl } },
        {
          type: "text",
          text:
            `Dialogue:\n${renderTranscript(input.context.speech)}\n\nPeople:\n${renderNames(input.context.scene)}\n\n` +
            `First-viewing notes:\n${renderScene(input.context.scene)}\n\n` +
            `Gaps where narration may speak:\n${renderGaps(input.context.gaps)}\n\n` +
            `Lines already approved:\n${approved || "(none)"}\n\n` +
            `${input.wholeScript ? "Review the whole script" : "Review only these lines"}:\n${lines}` +
            (input.finalOutput
              ? "\nFINAL OUTPUT AUDIT: these are the actual spoken lines after all deletions and shortening. List any essential missing action, person or on-screen text even when no free room remains. Use its scene time and the nearest gap id. Do not assume deleted draft lines are still present."
              : "") +
            retry,
        },
      ],
      schemaName: "line_review",
      schema: ReviewSchema,
      temperature: 0,
      ledgerFile: input.ledgerFile,
      reasoningEffort: reasoningEffort(input.stage ?? "review"),
    });
    const problem = reviewProblem(data, input);
    if (problem && attempt < REVIEW_ATTEMPTS) {
      console.warn(`review answer rejected, asking again: label=${input.label} ${problem}`);
      retry = `\n\nYour previous answer could not be used (${problem}). Give exactly one verdict for each line listed above, and no other.`;
      continue;
    }
    if (problem) throw new ModelOutputError(problem);
    const byId = new Map(data.verdicts.map((v) => [v.cueId, v]));
    return {
      verdicts: input.lines.map((l) => byId.get(l.id)!),
      missing: input.wholeScript ? data.missing : [],
    };
  }
}

/** Why a review answer cannot be used as it is: a verdict per given line, missing items in their gap. */
function reviewProblem(
  data: { verdicts: Verdict[]; missing: MissingItem[] },
  input: {
    context: ClipContext;
    lines: { id: string }[];
    wholeScript: boolean;
    finalOutput?: boolean;
  },
): string | null {
  if (data.verdicts.some((v) => !input.lines.some((l) => l.id === v.cueId)))
    return "review returned an unknown cue id";
  if (
    input.wholeScript &&
    !input.finalOutput &&
    data.missing.some(
      (m) => !input.context.gaps.some((g) => g.id === m.gapId && m.at >= g.start && m.at < g.end),
    )
  )
    return "review returned a missing item outside its named gap";
  const unjudged = input.lines.filter((l) => !data.verdicts.some((v) => v.cueId === l.id));
  if (unjudged.length > 0)
    return `review returned no verdict for ${unjudged.map((l) => l.id).join(", ")}`;
  return null;
}
