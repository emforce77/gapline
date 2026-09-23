/**
 * 05. How a line is made: a quiet left-to-right spine of stages, and the two loops that can send a
 * line back (review, then measured fit) drawn heavier, each with what it did in the default
 * reviewer's finished evaluation runs. A rail carries dropped lines to the final check.
 */
import { fitRule } from "../data/city";
import { independentOverlaps, loopCounts } from "../data/loops";
import { launchCall } from "../data/recognizers";
import { intro, secs, slide } from "../html";
import { notesFor } from "../notes";
import { MARGIN, W } from "../theme";

interface Stage {
  title: string;
  text: string;
  by: string;
}
const STAGES: Stage[] = [
  { title: "Write", text: "For one silence", by: "Gemini" },
  { title: "Review", text: "8 rules, each cited", by: "Gemini" },
  { title: "Voice", text: "", by: "Chirp 3 HD" },
  { title: "Measure", text: "Times the audio", by: "WAV samples" },
  { title: "Mix", text: "", by: "FFmpeg" },
  { title: "Final check", text: "Lists what is missing", by: "Gemini" },
];
const INPUTS: Stage[] = [
  { title: "Hear", text: "Word timings, then each silence alone", by: "Chirp 3" },
  { title: "Watch", text: "Picture and sound", by: "Gemini" },
];

const COLS = STAGES.length + 1;
const GAP = 40;
const BOX_W = (W - 2 * MARGIN - (COLS - 1) * GAP) / COLS;
const ROW = { top: 370, h: 196 };
const INPUT = { h: 206, gap: 16 };
const LOOP_TOP = 306;
const LOOP_BOTTOM = 636;
const DROP_RAIL = 804;
const SUMMARY_TOP = 872;
/** Drop lines leave a box off-centre so they never cross a loop. */
const DROP_OFFSET = 60;
const colX = (i: number) => MARGIN + i * (BOX_W + GAP);
const centre = (i: number) => colX(i) + BOX_W / 2;

function box(s: Stage, left: number, top: number, h: number): string {
  return `<div class="hw-box" style="left:${left}px;top:${top}px;width:${BOX_W}px;height:${h}px"><p class="hw-t">${s.title}</p>${s.text ? `<p class="hw-x">${s.text}</p>` : ""}<p class="hw-by">${s.by}</p></div>`;
}

const noun = (n: number) => (n === 1 ? "line" : "lines");

export function howSlide(): string {
  const note = notesFor(5, "Two loops decide…");
  const c = loopCounts;
  const mid = ROW.top + ROW.h / 2;
  const inputsTop = mid - INPUT.h - INPUT.gap / 2;
  const inputs = INPUTS.map((s, i) =>
    box(s, colX(0), inputsTop + i * (INPUT.h + INPUT.gap), INPUT.h),
  ).join("");
  const stages = STAGES.map((s, i) => box(s, colX(i + 1), ROW.top, ROW.h)).join("");
  const review = 2;
  const measure = 4;
  const final = 6;
  const bottom = ROW.top + ROW.h;
  const arrow = (x1: number, x2: number, y: number) =>
    `<path d="M${x1} ${y} H${x2 - 4}" class="hw-line" marker-end="url(#hw-head-dim)"/>`;
  const flows = [1, 2, 3, 4, 5].map((i) => arrow(colX(i) + BOX_W, colX(i + 1), mid)).join("");
  const inputArrows = INPUTS.map((_, i) => {
    const y = inputsTop + i * (INPUT.h + INPUT.gap) + INPUT.h / 2;
    return `<path d="M${colX(0) + BOX_W} ${y} C${colX(0) + BOX_W + 24} ${y} ${colX(1) - 24} ${mid} ${colX(1) - 4} ${mid}" class="hw-line" marker-end="url(#hw-head-dim)"/>`;
  }).join("");
  const loopUp = `<path d="M${centre(review)} ${ROW.top} V${LOOP_TOP + 20} Q${centre(review)} ${LOOP_TOP} ${centre(review) - 20} ${LOOP_TOP} H${centre(1) + 20} Q${centre(1)} ${LOOP_TOP} ${centre(1)} ${LOOP_TOP + 20} V${ROW.top - 8}" class="hw-loop" marker-end="url(#hw-head)"/>`;
  const loopDown = `<path d="M${centre(measure)} ${bottom} V${LOOP_BOTTOM - 20} Q${centre(measure)} ${LOOP_BOTTOM} ${centre(measure) - 20} ${LOOP_BOTTOM} H${centre(review) + 20} Q${centre(review)} ${LOOP_BOTTOM} ${centre(review)} ${LOOP_BOTTOM - 20} V${bottom + 8}" class="hw-loop" marker-end="url(#hw-head)"/>`;
  const dropFrom = [centre(review) - DROP_OFFSET, centre(measure) + DROP_OFFSET];
  const drops = dropFrom
    .map((x) => `<path d="M${x} ${bottom} V${DROP_RAIL}" class="hw-drop"/>`)
    .join("");
  const rail = `<path d="M${dropFrom[0]} ${DROP_RAIL} H${centre(final)} V${bottom + 6}" class="hw-drop" marker-end="url(#hw-head-dim)"/>`;
  if (c.written - c.voiced !== 2) throw new Error("the drop note says the final check listed both");
  const faster = c.fasterRates.map((r) => `${r.toFixed(2)}×`).join(", ");
  const sameModel = note(
    `Writer and reviewer: one Gemini model, separate instructions; the reviewer at temperature 0 with the most reasoning. One rewrite per rejection; at most ${fitRule.shortenings} shortenings.`,
  );
  const io = independentOverlaps;
  if (io.longest.cueId !== launchCall.line.id || io.longest.projectId !== "tos-opening")
    throw new Error("the longest flagged overlap is no longer the opening's launch-call line");
  const counts = note(
    `The default reviewer’s ${c.runs} finished evaluation runs, 22 Sep 2026, counted line by line; they predate the second listen to each silence (23 Sep). ${c.disputedRejections} of the ${c.sentBack} rejections is disputed: a rifle-scope line sent back for “crosshairs” not on screen, where the film’s master shows a faint reticle. No voiced line overlaps Chirp 3’s speech, but an independent recognizer flags possible overlaps in ${io.runs} of the ${c.runs}; the longest, the opening’s ${secs(io.longest.seconds)} line, was real: Chirp 3 had timed the launch call ${secs(launchCall.early)} early. Whether a dropped line is reported depends on the final check, a model: in these runs it listed both.`,
  );

  return slide({
    id: "s-how",
    name: "how-it-works",
    folio: 5,
    kind: "exhibit",
    body: `
${intro("Two loops decide whether a line is heard.", undefined, 1500)}
<svg class="hw-svg" width="${W}" height="1080" viewBox="0 0 ${W} 1080" aria-hidden="true">
  <defs>
    <marker id="hw-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#ece9e3"/></marker>
    <marker id="hw-head-dim" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#80848b"/></marker>
  </defs>
  ${inputArrows}${flows}${drops}${rail}${loopUp}${loopDown}
</svg>
${inputs}${stages}
<div class="hw-note" style="left:${centre(1) + 20}px;top:${LOOP_TOP - 94}px;width:${centre(final) - centre(1)}px">
  <p class="hw-nt">Rejected: one rewrite, reviewed again${sameModel}</p>
  <p class="hw-nc"><b>${c.sentBack} ${noun(c.sentBack)} sent back:</b> ${c.passedRewrite} passed on the rewrite, ${c.droppedAfterReview} dropped</p>
</div>
<div class="hw-note" style="left:${centre(review) + 24}px;top:${LOOP_BOTTOM + 12}px;width:${centre(measure) - centre(review) - 48}px">
  <p class="hw-nt">Too long: up to ${fitRule.maxRate}× faster, else shortened and reviewed again</p>
  <p class="hw-nc"><b>${c.ranLong} ran long:</b> ${c.fittedFaster} fitted at ${faster}, ${c.droppedTooLong} dropped</p>
</div>
<p class="hw-drop-note" style="right:${W - centre(final) + 16}px;top:${DROP_RAIL + 12}px">Dropped: the final check listed both as missing.</p>
<p class="hw-sum" style="left:${MARGIN}px;top:${SUMMARY_TOP}px"><b>${c.voiced} of ${c.written} lines voiced</b> across ${c.runs} finished test runs${counts}</p>`,
  });
}

export const HOW_CSS = `
.hw-svg { position:absolute; left:0; top:0; }
.hw-line { fill:none; stroke:var(--ink-400); stroke-width:2; }
.hw-loop { fill:none; stroke:var(--ink-100); stroke-width:4; }
.hw-drop { fill:none; stroke:var(--ink-400); stroke-width:2; stroke-dasharray:6 6; }
.hw-box { position:absolute; border:1px solid var(--rule); border-radius:6px; background:var(--lane); padding:14px 18px; }
.hw-t { font-size:28px; font-weight:600; color:var(--ink-100); }
.hw-x { margin-top:6px; font-size:24px; line-height:1.3; color:var(--ink-300); }
.hw-by { position:absolute; left:18px; bottom:12px; font-size:24px; color:var(--ink-400); }
.hw-note { position:absolute; }
.hw-nt { font-size:24px; line-height:1.35; font-weight:600; color:var(--ink-100); }
.hw-nc { margin-top:4px; font-size:24px; line-height:1.35; color:var(--ink-300); }
.hw-nc b { font-weight:600; color:var(--ink-100); }
.hw-drop-note { position:absolute; font-size:24px; color:var(--ink-300); text-align:right; }
.hw-sum { position:absolute; font-size:32px; line-height:1.3; color:var(--ink-300); }
.hw-sum b { font-weight:600; color:var(--ink-100); }
`;
