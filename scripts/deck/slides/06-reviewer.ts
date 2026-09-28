/**
 * 06. The reviewer, followed through one line of the sample (Line 5, 47.2 s): the draft passed its
 * review and was voiced, the final check read the whole voiced track and sent it back for viewer
 * framing, and Gapline rewrote it from the check's own fix: it passed and was voiced again, in the same
 * run. The frame beside the headline shows the on-screen words the rewrite reads. The rule's source
 * in the guideline is the one note.
 */
import { GUIDELINE_RULES } from "../../../src/lib/pipeline/guidelines";
import { line } from "../data/sample";
import { esc, intro, PASS_MARK, px, REJECT_MARK, slide } from "../html";
import { notesFor } from "../notes";
import { stillUrl } from "../stills";
import { MARGIN, W } from "../theme";

/** The frame beside the headline, cropped to the playback panel so its on-screen words read. */
const FRAME = { top: 76, width: 680 };
/** The crop, in pixels of the 1920 x 800 still: the panel and its "MEMORY PLAYBACK - GLOBAL" line. */
const FRAME_CROP = { x: 330, y: 360, w: 960, h: 400 };
const STILL_W = 1920;
const HEADLINE_W = 1000;
/** The review chain, centred in the space under the headline and the frame. */
const CHAIN_TOP = 540;
const ARROW_W = 78;
const COL_W = (W - 2 * MARGIN - 2 * ARROW_W) / 3;
/** The frame's on-screen words, which the check's fix tells the writer to read (checked below). */
const ON_SCREEN = /memory playback/i;

function ruleOf(id: string) {
  const rule = GUIDELINE_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`unknown rule ${id}`);
  return rule;
}

/** A Korean line with the quoted words struck through. */
function struck(text: string, quote: string): string {
  const at = text.indexOf(quote);
  if (at < 0) throw new Error(`quote "${quote}" not in "${text}"`);
  return `${esc(text.slice(0, at))}<del class="strike">${esc(quote)}</del>${esc(text.slice(at + quote.length))}`;
}

const colX = (i: number) => MARGIN + i * (COL_W + ARROW_W);

export function reviewerSlide(): string {
  const note = notesFor("Final check");
  if (line.rejectedBy !== "final check")
    throw new Error(
      `${line.cueId} was sent back by the ${line.rejectedBy}; the slide says the final check`,
    );
  const rule = ruleOf(line.draft.rule);
  // The fix must point the writer at the words on screen, and the rewrite must be those words.
  if (!line.draft.fixGloss.includes(line.gloss) || !ON_SCREEN.test(line.gloss))
    throw new Error("the check's fix no longer reads the on-screen words the frame shows");

  const cite = note(`${esc(rule.source.en)}.`);

  const verdict = (mark: string, title: string, marker = "") =>
    `<p class="verdict">${mark}<span>${esc(title)}${marker}</span></p>`;
  const cols = [
    `<p class="rv-step">Draft, sent back by the final check</p>
  <p class="rv-line" lang="ko">${struck(line.draft.text, line.draft.quote)}</p>
  <p class="rv-gloss">${esc(line.draft.gloss)}</p>
  ${verdict(REJECT_MARK, rule.title.en, cite)}`,
    `<p class="rv-step">The check’s fix</p>
  <p class="rv-fix">${esc(line.draft.fixGloss)}</p>`,
    `<p class="rv-step">Gapline’s rewrite</p>
  <p class="rv-line amber" lang="ko">${esc(line.rewrite.text)}</p>
  <p class="rv-gloss">${esc(line.rewrite.gloss)}</p>
  ${verdict(PASS_MARK, "Passed and voiced")}`,
  ]
    .map(
      (c, i) =>
        `<div class="rv-col" style="left:${px(colX(i))};top:${CHAIN_TOP}px;width:${px(COL_W)}">${c}</div>`,
    )
    .join("");
  const arrows = [0, 1]
    .map(
      (i) =>
        `<svg class="rv-arrow" width="${ARROW_W}" height="40" style="left:${px(colX(i) + COL_W)};top:${CHAIN_TOP + 52}px" aria-hidden="true"><path d="M14 20 H60" stroke="#a9acb2" stroke-width="3"/><path d="M52 10 L66 20 L52 30" fill="none" stroke="#a9acb2" stroke-width="3"/></svg>`,
    )
    .join("");
  const zoom = FRAME.width / FRAME_CROP.w;
  const frame = `<div class="rv-frame" style="left:${W - MARGIN - FRAME.width}px;top:${FRAME.top}px;width:${FRAME.width}px;height:${px(FRAME_CROP.h * zoom)}"><img class="still" src="${stillUrl("playback")}" alt="" style="left:${px(-FRAME_CROP.x * zoom)};top:${px(-FRAME_CROP.y * zoom)};width:${px(STILL_W * zoom)}"></div>`;

  return slide({
    id: "s-reviewer",
    name: "reviewer",
    kind: "exhibit",
    filmCredit: true,
    body: `
${intro("The final check names the broken rule, and Gapline rewrites the line.", undefined, HEADLINE_W)}
${frame}
${cols}
${arrows}`,
  });
}

export const REVIEWER_CSS = `
.rv-frame { position:absolute; overflow:hidden; border-radius:4px; }
.rv-col { position:absolute; display:grid; row-gap:12px; align-content:start; }
.rv-step { font-size:var(--fs-label); font-weight:600; color:var(--ink-300); }
.rv-line { font-size:44px; line-height:1.25; font-weight:500; color:var(--ink-100); }
.rv-line.amber { color:var(--amber); }
.rv-gloss { font-size:var(--fs-body); line-height:1.3; color:var(--ink-100); text-wrap:balance; }
.rv-fix { font-family:var(--serif); font-style:italic; font-size:36px; line-height:1.3; color:var(--ink-100); }
.rv-arrow { position:absolute; }
`;
