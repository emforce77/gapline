/**
 * 06. The reviewer, followed through one line of the sample: the draft described what the picture
 * shows only after the next cut, the reviewer sent it back citing the rules, and Gapline rewrote it
 * from the reviewer's fix: it passed and was voiced, in the same run. The frame beside the headline
 * shows what the picture holds where the line starts. The rules' sources are the note.
 */
import { GUIDELINE_RULES } from "../../../src/lib/pipeline/guidelines";
import { line } from "../data/sample";
import { gloss, textLang } from "../glosses";
import { esc, intro, PASS_MARK, px, REJECT_MARK, slide } from "../html";
import { notesFor } from "../notes";
import { stillUrl } from "../stills";
import { MARGIN, W } from "../theme";

const HEADLINE_W = 1000;
/** The frame beside the headline: the 2.4:1 still at this width, its label under it. */
const FRAME = { top: 76, width: 680 };
const STILL_ASPECT = 2.4;
const FRAME_LABEL_GAP = 12;
/** The review chain, under the headline and the frame. */
const CHAIN_TOP = 540;
const ARROW_W = 78;
const COL_W = (W - 2 * MARGIN - 2 * ARROW_W) / 3;
/** The rules the headline's "ahead of the picture" stands for. */
const AHEAD_OF_PICTURE = ["spoiler", "unseen"];

function ruleOf(id: string) {
  const rule = GUIDELINE_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`unknown rule ${id}`);
  return rule;
}

/** A line with the quoted words struck through. */
function struck(text: string, quote: string): string {
  const at = text.indexOf(quote);
  if (at < 0) throw new Error(`quote "${quote}" not in "${text}"`);
  return `${esc(text.slice(0, at))}<del class="strike">${esc(quote)}</del>${esc(text.slice(at + quote.length))}`;
}

/** Our English under a Korean line; nothing under an English one. */
const glossLine = (text: string) =>
  gloss(text) === text ? "" : `<p class="rv-gloss">${esc(gloss(text))}</p>`;

const colX = (i: number) => MARGIN + i * (COL_W + ARROW_W);

export function reviewerSlide(): string {
  const note = notesFor("Reviewer");
  if (line.rejectedBy !== "review")
    throw new Error(
      `${line.cueId} was sent back by the ${line.rejectedBy}; the slide says the reviewer`,
    );
  if (!line.draft.rules.every((r) => AHEAD_OF_PICTURE.includes(r)))
    throw new Error(`${line.cueId}'s rules are not about the picture: ${line.draft.rules.join()}`);
  const rules = line.draft.rules.map(ruleOf);
  // The rules' sources as the guideline file gives them, without their parenthetical topics.
  const cite = note(
    `${rules.map((r) => esc(r.source.en.replace(/\s*\([^)]*\)/g, ""))).join("; ")}.`,
  );

  const verdict = (mark: string, title: string, marker = "") =>
    `<p class="verdict">${mark}<span>${esc(title)}${marker}</span></p>`;
  const cols = [
    `<p class="rv-step">Draft, sent back by the reviewer</p>
  <p class="rv-line" lang="${textLang(line.draft.text)}">${struck(line.draft.text, line.draft.quote)}</p>
  ${glossLine(line.draft.text)}
  ${verdict(REJECT_MARK, rules.map((r) => r.title.en).join(", "), cite)}`,
    `<p class="rv-step">The reviewer’s fix</p>
  <p class="rv-fix">${esc(line.draft.fixGloss)}</p>`,
    `<p class="rv-step">Gapline’s rewrite</p>
  <p class="rv-line amber" lang="${textLang(line.rewrite.text)}">${esc(line.rewrite.text)}</p>
  ${glossLine(line.rewrite.text)}
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
  const frameH = FRAME.width / STILL_ASPECT;
  const frameX = W - MARGIN - FRAME.width;
  const frame =
    `<div class="rv-frame" style="left:${px(frameX)};top:${FRAME.top}px;width:${FRAME.width}px;height:${px(frameH)}"><img class="still" src="${stillUrl("line-start")}" alt=""></div>` +
    `<p class="rv-at" style="left:${px(frameX)};top:${px(FRAME.top + frameH + FRAME_LABEL_GAP)};width:${FRAME.width}px">${line.start.toFixed(1)} s, where the line starts</p>`;

  return slide({
    id: "s-reviewer",
    name: "reviewer",
    kind: "exhibit",
    filmCredit: true,
    body: `
${intro("The reviewer caught a line ahead of the picture, and Gapline rewrote it.", undefined, HEADLINE_W)}
${frame}
${cols}
${arrows}`,
  });
}

export const REVIEWER_CSS = `
.rv-frame { position:absolute; overflow:hidden; border-radius:4px; }
.rv-frame .still { position:absolute; left:0; top:0; width:100%; height:100%; object-fit:cover; }
.rv-at { position:absolute; font-size:var(--fs-label); color:var(--ink-300); }
.rv-col { position:absolute; display:grid; row-gap:12px; align-content:start; }
.rv-step { font-size:var(--fs-label); font-weight:600; color:var(--ink-300); }
.rv-line { font-size:40px; line-height:1.25; font-weight:500; color:var(--ink-100); text-wrap:balance; }
.rv-line.amber { color:var(--amber); }
.rv-gloss { font-size:var(--fs-body); line-height:1.3; color:var(--ink-100); text-wrap:balance; }
.rv-fix { font-family:var(--serif); font-style:italic; font-size:36px; line-height:1.3; color:var(--ink-100); }
.rv-arrow { position:absolute; }
`;
