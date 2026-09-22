import { callStructured } from "../llm/openrouter";
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
import { ReviewSchema, type MissingItem, type Verdict } from "./schemas";

function reviewerSystem(context: ClipContext, finalOutput = false): string {
  return `You review ${languageName(context.language)} audio description lines for blind and low-vision viewers
against published guidelines. You did not write them. You see the clip itself; judge every line against
the picture and the soundtrack at that moment.

Rules (a line fails if it breaks any of them):
${ruleSummaryForPrompt()}

For each line return pass=true with no violations, or pass=false with every violation: the rule id, the
exact words that break it, and a one-sentence reason. "fix" says how to repair the line in one sentence.
Write reason and fix in ${languageName(context.language)}. Be strict about spoiler and unseen. For every
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
  lines: { id: string; start: number; end: number; text: string }[];
  /** Already approved lines, for naming consistency. */
  approved: { id: string; start: number; text: string }[];
  /** True when the lines are the whole script, so coverage can be judged. */
  wholeScript: boolean;
  /** Final output audit: report essential omissions even if no room remains. */
  finalOutput?: boolean;
}): Promise<{ verdicts: Verdict[]; missing: MissingItem[] }> {
  const lines = input.lines
    .map((l) => `- ${l.id} [${l.start.toFixed(3)}–${l.end.toFixed(3)} s]: ${l.text}`)
    .join("\n");
  const approved = input.approved
    .map((l) => `- ${l.id} at ${l.start.toFixed(3)} s: ${l.text}`)
    .join("\n");
  const { data } = await callStructured({
    label: input.label,
    model: input.model,
    system: reviewerSystem(input.context, input.finalOutput),
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
            : ""),
      },
    ],
    schemaName: "line_review",
    schema: ReviewSchema,
    temperature: 0,
    ledgerFile: input.ledgerFile,
    reasoningEffort: reasoningEffort("review"),
  });
  const byId = new Map(data.verdicts.map((v) => [v.cueId, v]));
  if (data.verdicts.some((v) => !input.lines.some((l) => l.id === v.cueId)))
    throw new Error("review returned an unknown cue id");
  if (
    !input.finalOutput &&
    data.missing.some(
      (m) => !input.context.gaps.some((g) => g.id === m.gapId && m.at >= g.start && m.at < g.end),
    )
  )
    throw new Error("review returned a missing item outside its named gap");
  const missing = input.lines.filter((l) => !byId.has(l.id));
  if (missing.length > 0) {
    throw new Error(`review returned no verdict for ${missing.map((l) => l.id).join(", ")}`);
  }
  return {
    verdicts: input.lines.map((l) => byId.get(l.id)!),
    missing: input.wholeScript ? data.missing : [],
  };
}
