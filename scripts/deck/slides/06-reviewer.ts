/**
 * 06. The reviewer, followed through one line of the Korean opening (the default reviewer's run):
 * the draft sent back as low priority because the on-screen SIMULATION READY mattered more, the
 * rewrite built from its fix sent back for viewer framing and dropped, and the reviewer's second fix,
 * typed by an editor, passed and voiced. The slide owns the failure in one line: the first fix broke
 * another rule, so every suggested fix must now pass all eight rules itself.
 */
import { GUIDELINE_RULES } from "../../../src/lib/pipeline/guidelines";
import { lineHistory as h, opening } from "../data/demo";
import { esc, intro, PASS_MARK, px, REJECT_MARK, secs, slide } from "../html";
import { notesFor } from "../notes";
import { stillUrl } from "../stills";
import { MARGIN, W } from "../theme";

/** The whole frame, uncropped, beside the headline: the master's 2.4:1 picture, scaled down. */
const FRAME = { top: 76, width: 680, aspect: 1920 / 800 };
const HEADLINE_W = 1010;
const CHAIN_TOP = 468;
const ARROW_W = 78;
const COL_W = (W - 2 * MARGIN - 2 * ARROW_W) / 3;
const OWN_TOP = 900;
/** The reviewer's first reason is quoted from this phrase on, so the slide keeps to its text budget. */
const REASON_FROM = "describe the key information";

function ruleOf(id: string) {
  const rule = GUIDELINE_RULES.find((r) => r.id === id);
  if (!rule) throw new Error(`unknown rule ${id}`);
  return rule;
}

/** "KMCC guideline p.7 (…), p.8 (…); Netflix AD Style Guide §1.2" → "KMCC p.7, p.8; Netflix §1.2" */
function shortCite(source: string): string {
  return source
    .replace(/\s*\([^)]*\)/g, "")
    .replace(/KMCC guideline/g, "KMCC")
    .replace(/Netflix AD Style Guide/g, "Netflix");
}

/** A Korean line with the reviewer's quoted words struck through. */
function struck(text: string, quote: string): string {
  const at = text.indexOf(quote);
  if (at < 0) throw new Error(`quote "${quote}" not in "${text}"`);
  return `${esc(text.slice(0, at))}<del class="strike">${esc(quote)}</del>${esc(text.slice(at + quote.length))}`;
}

const colX = (i: number) => MARGIN + i * (COL_W + ARROW_W);

export function reviewerSlide(): string {
  const note = notesFor(6, "The reviewer sends a line back…");
  const first = ruleOf(h.draft.rule);
  const second = ruleOf(h.rewrite.rule);
  if (first.id !== "redundant" || second.id !== "viewer_frame")
    throw new Error("the line's two rejections changed; the notes describe them");
  const at = h.draft.reasonGloss.indexOf(REASON_FROM);
  if (at < 0) throw new Error(`the reviewer's reason no longer contains "${REASON_FROM}"`);
  const reason = `“…${esc(h.draft.reasonGloss.slice(at))}”`;

  const run = note(
    `Korean automatic run on the ${opening.clip} s opening, line at ${h.start} s with ${secs(h.room)} of room, default reviewer, 22 Sep 2026. Reasons and fixes are the reviewer’s, in Korean; the glosses are ours. Rule titles and pages are as in Scene’s rulebook today: on 23 Sep, after this run, this rule was renamed “${esc(first.title.en)}” and given KMCC p.7, which lists on-screen text among what must be described. The verdict names the same rule.`,
  );
  const framing = note(
    "KMCC p.9 advises against phrasing such as ‘무엇이 보인다’ (‘something is seen’) and ‘시야에 들어온다’ (‘comes into view’). Scene’s rule names ‘appears on screen’ and ‘보인다’; the reviewer counted ‘뜬다’ (‘comes up’) as the same framing.",
  );
  const dropped = note(
    `One rewrite per rejection, so the loop dropped the line; the final check listed the moment as missing. The editor typed the reviewer’s second fix (“${esc(h.rewrite.fixGloss)}”); Scene voiced, measured and reviewed it.`,
  );
  const own = note(
    "Its first fix (“" +
      esc(h.draft.fixGloss) +
      "”) itself says the words ‘appear’, the framing the reviewer then rejected in the rewrite built from it. On 23 Sep 2026 we changed the reviewer’s instructions: a suggested fix must itself pass every rule. The recorded runs keep their old fixes; this clip has not been re-run.",
  );

  const verdict = (mark: string, title: string, cite: string, marker = "") =>
    `<div class="rv-verdict"><p class="verdict">${mark}${esc(title)}</p><p class="rv-cite">${esc(cite)}${marker}</p></div>`;
  const cols = [
    `<p class="rv-step">Draft</p>
  <p class="rv-line" lang="ko">${struck(h.draft.text, h.draft.quote)}</p>
  <p class="rv-gloss">${esc(h.draft.gloss)}</p>
  ${verdict(REJECT_MARK, first.title.en, shortCite(first.source.en))}
  <p class="rv-why">${reason}${run}</p>`,
    `<p class="rv-step">Rewrite, from its fix</p>
  <p class="rv-line" lang="ko">${struck(h.rewrite.text, h.rewrite.quote)}</p>
  <p class="rv-gloss">${esc(h.rewrite.gloss)}</p>
  ${verdict(REJECT_MARK, second.title.en, shortCite(second.source.en), framing)}
  <p class="rv-out">Dropped${dropped}</p>`,
    `<p class="rv-step">Typed by an editor</p>
  <p class="rv-line amber" lang="ko">${esc(h.typed.text)}</p>
  <p class="rv-gloss">${esc(h.typed.gloss)}</p>
  ${verdict(PASS_MARK, "Passed", `voiced ${secs(h.typed.voiced)} in ${secs(h.room)}`)}`,
  ]
    .map(
      (c, i) =>
        `<div class="rv-col" style="left:${px(colX(i))};top:${CHAIN_TOP}px;width:${px(COL_W)}">${c}</div>`,
    )
    .join("");
  const arrows = [0, 1]
    .map(
      (i) =>
        `<svg class="rv-arrow" width="${ARROW_W}" height="40" style="left:${px(colX(i) + COL_W)};top:${CHAIN_TOP + 44}px" aria-hidden="true"><path d="M14 20 H60" stroke="#a9acb2" stroke-width="3"/><path d="M52 10 L66 20 L52 30" fill="none" stroke="#a9acb2" stroke-width="3"/></svg>`,
    )
    .join("");

  return slide({
    id: "s-reviewer",
    name: "reviewer",
    folio: 6,
    kind: "exhibit",
    filmCredit: true,
    body: `
${intro("The reviewer sends a line back with the rule and page it breaks.", undefined, HEADLINE_W)}
<img class="still rv-frame" src="${stillUrl("ready")}" alt="" style="left:${W - MARGIN - FRAME.width}px;top:${FRAME.top}px;width:${FRAME.width}px;height:${px(FRAME.width / FRAME.aspect)}">
${cols}
${arrows}
<p class="rv-own" style="left:${MARGIN}px;top:${OWN_TOP}px">Its first fix broke another rule. We now tell the reviewer that every fix must pass all eight; not re-run yet.${own}</p>`,
  });
}

export const REVIEWER_CSS = `
.rv-frame { border-radius:4px; }
.rv-col { position:absolute; display:grid; row-gap:10px; align-content:start; }
.rv-step { font-size:24px; font-weight:600; color:var(--ink-300); }
.rv-line { font-size:40px; line-height:1.25; font-weight:500; color:var(--ink-100); }
.rv-line.amber { color:var(--amber); }
.rv-gloss { font-size:24px; line-height:1.3; color:var(--ink-300); }
.rv-cite { margin:2px 0 0 34px; font-size:24px; line-height:1.3; color:var(--ink-300); }
.rv-why { font-family:var(--serif); font-style:italic; font-size:28px; line-height:1.3; color:var(--ink-100); }
.rv-out { font-size:26px; font-weight:600; color:var(--ink-100); }
.rv-arrow { position:absolute; }
.rv-own { position:absolute; width:${W - 2 * MARGIN}px; padding-top:16px; border-top:1px solid var(--rule);
  font-size:30px; line-height:1.35; color:var(--ink-100); }
`;
