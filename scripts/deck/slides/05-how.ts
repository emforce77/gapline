/**
 * 05. How Gapline checks itself: the pipeline as run.ts runs it (hear and watch, then
 * write, review, voice, measure, the final check, fix, and mix last), with the three checks drawn
 * heavier and what each does with a line that fails: rewrite it from the reviewer's fix, read it
 * faster or shorten it, or hand it to the fix stage. Under each loop, what happens next.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GUIDELINE_RULES } from "../../../src/lib/pipeline/guidelines";
import { fitRule } from "../data/city";
import { intro, slide } from "../html";
import { notesFor } from "../notes";
import { REPO } from "../paths";
import { MARGIN, W } from "../theme";

interface Stage {
  title: string;
  text?: string;
  by?: string;
  /** One of the three checks a line must pass: drawn heavier. */
  check?: boolean;
}
const INPUTS: Stage[] = [
  { title: "Hear", text: "Re-listens to each silence", by: "Chirp 3" },
  { title: "Watch", by: "Gemini" },
];
/** In the order run.ts runs them (the sample's events record the same order). */
const STAGES: Stage[] = [
  { title: "Write", by: "Gemini" },
  { title: "Review", text: `${GUIDELINE_RULES.length} rules`, by: "Gemini", check: true },
  { title: "Voice", by: "Chirp 3 HD" },
  { title: "Measure", text: "Real voice", check: true },
  { title: "Final check", text: "Whole track", by: "Gemini", check: true },
  { title: "Fix", by: "Gemini" },
  { title: "Mix", by: "FFmpeg" },
];
const COL = { review: 2, voice: 3, measure: 4, final: 5, fix: 6 };

const COLS = STAGES.length + 1;
const GAP = 28;
const BOX_W = (W - 2 * MARGIN - (COLS - 1) * GAP) / COLS;
const ROW = { top: 530, h: 190 };
const INPUT = { h: 176, gap: 16 };
/** Where the loops turn: above the row (review, final check) and below it (measure). */
const LOOP_TOP = 470;
const LOOP_BOTTOM = 800;
/** Space between a loop and its label. */
const LABEL_GAP = 12;
const LABEL_H = 110;
const colX = (i: number) => MARGIN + i * (BOX_W + GAP);
const centre = (i: number) => colX(i) + BOX_W / 2;
/** Corner radius of the loops. */
const R = 20;

/** The review rounds a line gets, read from the pipeline so the slide cannot drift from it. */
const RUN_SOURCE = join(REPO, "src/lib/pipeline/run.ts");
function maxReviewRounds(): number {
  const m = readFileSync(RUN_SOURCE, "utf8").match(/const MAX_REVIEW_ROUNDS = (\d+);/);
  if (!m) throw new Error(`${RUN_SOURCE} has no MAX_REVIEW_ROUNDS`);
  return Number(m[1]);
}

function box(s: Stage, left: number, top: number, h: number): string {
  return `<div class="hw-box${s.check ? " check" : ""}" style="left:${left}px;top:${top}px;width:${BOX_W}px;height:${h}px"><p class="hw-t">${s.title}</p>${s.text ? `<p class="hw-x">${s.text}</p>` : ""}${s.by ? `<p class="hw-by">${s.by}</p>` : ""}</div>`;
}

/** A loop from one column's box edge to another's, turning at `y` (above or below the row). */
function loop(from: number, to: number, edge: number, y: number): string {
  const dir = y < edge ? 1 : -1;
  const side = to < from ? -1 : 1;
  const x1 = centre(from);
  const x2 = centre(to);
  return `<path d="M${x1} ${edge} V${y + dir * R} Q${x1} ${y} ${x1 + side * R} ${y} H${x2 - side * R} Q${x2} ${y} ${x2} ${y + dir * R} V${edge - dir * 8}" class="hw-loop" marker-end="url(#hw-head)"/>`;
}

export function howSlide(): string {
  const note = notesFor("How it checks itself");
  const rounds = maxReviewRounds();
  const rewrites = rounds - 1;
  const faster = Math.round((fitRule.maxRate - 1) * 100);
  const rules = note(
    `The ${GUIDELINE_RULES.length} rules come from Korea’s audio-description guideline (Korea Media &amp; Communications Commission) and Netflix’s Audio Description Style Guide v2.5.`,
  );

  const mid = ROW.top + ROW.h / 2;
  const bottom = ROW.top + ROW.h;
  const inputsTop = mid - INPUT.h - INPUT.gap / 2;
  const inputs = INPUTS.map((s, i) =>
    box(s, colX(0), inputsTop + i * (INPUT.h + INPUT.gap), INPUT.h),
  ).join("");
  // The review box carries the rules' source.
  const stages = STAGES.map((s, i) =>
    box(
      s.title === "Review" ? { ...s, text: `${s.text}${rules}` } : s,
      colX(i + 1),
      ROW.top,
      ROW.h,
    ),
  ).join("");
  const flows = STAGES.slice(1)
    .map(
      (_, i) =>
        `<path d="M${colX(i + 1) + BOX_W} ${mid} H${colX(i + 2) - 4}" class="hw-line" marker-end="url(#hw-head-dim)"/>`,
    )
    .join("");
  const inputArrows = INPUTS.map((_, i) => {
    const y = inputsTop + i * (INPUT.h + INPUT.gap) + INPUT.h / 2;
    return `<path d="M${colX(0) + BOX_W} ${y} C${colX(0) + BOX_W + 20} ${y} ${colX(1) - 20} ${mid} ${colX(1) - 4} ${mid}" class="hw-line" marker-end="url(#hw-head-dim)"/>`;
  }).join("");
  const loops = [
    loop(COL.review, 1, ROW.top, LOOP_TOP),
    loop(COL.measure, COL.voice, bottom, LOOP_BOTTOM),
    loop(COL.final, COL.fix, ROW.top, LOOP_TOP),
  ].join("");

  const label = (
    place: "above" | "below",
    left: number,
    width: number,
    title: string,
    count: string,
  ) =>
    `<div class="hw-note ${place}" style="left:${left}px;top:${place === "above" ? LOOP_TOP - LABEL_GAP - LABEL_H : LOOP_BOTTOM + LABEL_GAP}px;width:${width}px"><p class="hw-nt">${title}</p><p class="hw-nc">${count}</p></div>`;

  return slide({
    id: "s-how",
    name: "how-it-works",
    kind: "exhibit",
    body: `
${intro("Every line is reviewed, timed and checked again before the mix.", undefined, 1500)}
<svg class="hw-svg" width="${W}" height="1080" viewBox="0 0 ${W} 1080" aria-hidden="true">
  <defs>
    <marker id="hw-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#ece9e3"/></marker>
    <marker id="hw-head-dim" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#80848b"/></marker>
  </defs>
  ${inputArrows}${flows}${loops}
</svg>
${inputs}${stages}
${label("above", centre(1) - R, centre(COL.final) - centre(1) - GAP, `Breaks a rule: rewritten as the reviewer suggests, up to ${rewrites === 2 ? "twice" : `${rewrites} times`}`, "Only lines that pass go on to the voice")}
${label("above", centre(COL.final) - R, W - MARGIN - centre(COL.final) + R, "Fails the whole-track check: rewritten", "Reviewed and voiced again")}
${label("below", centre(COL.voice) - R, centre(COL.fix) - centre(COL.voice), `Too long: up to ${faster}% faster, else shortened`, "Voiced and measured again")}`,
  });
}

export const HOW_CSS = `
.hw-svg { position:absolute; left:0; top:0; }
.hw-line { fill:none; stroke:var(--ink-400); stroke-width:2; }
.hw-loop { fill:none; stroke:var(--ink-100); stroke-width:4; }
.hw-box { position:absolute; border:1px solid var(--rule); border-radius:6px; background:var(--lane); padding:14px 16px; }
.hw-box.check { border:2px solid var(--ink-100); }
.hw-t { font-size:28px; line-height:1.2; font-weight:600; color:var(--ink-100); }
.hw-x { margin-top:6px; font-size:var(--fs-label); line-height:1.25; color:var(--ink-300); }
.hw-by { position:absolute; left:16px; bottom:12px; font-size:var(--fs-label); color:var(--ink-400); }
.hw-note { position:absolute; display:flex; flex-direction:column; height:${LABEL_H}px; }
.hw-note.above { justify-content:flex-end; }
.hw-nt { font-size:var(--fs-label); line-height:1.3; font-weight:600; color:var(--ink-100); }
.hw-nc { margin-top:4px; font-size:var(--fs-label); line-height:1.3; color:var(--ink-300); }
`;
