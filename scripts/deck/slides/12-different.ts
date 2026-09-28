/**
 * 12. Where Gapline is different: a fair table with named alternatives, terse cells, a dash wherever a
 * vendor does not document something, and the column Gapline loses (pausing the film) kept in. The
 * headline names what Gapline adds: the others either fit the voice or check it by hand; Gapline fits
 * every line and checks it against a guideline on its own.
 */
import {
  COMPARE_COLUMNS,
  COMPETITORS,
  SCENE_ROW,
  type CompetitorCell,
  type Support,
} from "../facts";
import { esc, slide } from "../html";
import { notesFor } from "../notes";
import { MARGIN, W } from "../theme";

const WORD: Record<Support, string> = {
  yes: "Yes",
  partly: "Partly",
  no: "No",
  unknown: "—",
};
/** The column that carries the headline's claim. */
const CLAIM_COLUMN = 1;
/** Column widths: vendor names, the claim column (its Gapline cell is the longest), the rest share. */
const NAME_COL = 260;
const CLAIM_COL = 330;
const TABLE_TOP = 268;

/** A hyphenated word ("re-voices") never breaks at its hyphen. */
const keepWhole = (text: string) =>
  esc(text).replace(/(\S+-\S+)/g, '<span class="df-nb">$1</span>');

function cell(c: CompetitorCell, col: number): string {
  const note = c.note === "" ? "" : `<span>${keepWhole(c.note)}</span>`;
  return `<td class="${c.support}${col === CLAIM_COLUMN ? " claim" : ""}"><b>${WORD[c.support]}</b>${note}</td>`;
}

export function differentSlide(): string {
  const note = notesFor("How Gapline differs");
  if (
    COMPETITORS.some((c) => c.cells.length !== COMPARE_COLUMNS.length) ||
    SCENE_ROW.length !== COMPARE_COLUMNS.length
  )
    throw new Error("comparison rows and columns disagree");
  const vendors = note(
    "Read 23 Sep 2026. MediaScribe (mediascribe.ai): silences of 3 s or more, 2.5 words a second, overruns summarized and re-voiced. ViddyScribe (docs.viddyscribe.com): 53 languages including Korean; auto-fit; extended description. Microsoft (github.com/microsoft/ai-audio-descriptions): measures every line at render and speeds it up to at most 1.15× in tempo, else the render fails; no review stage; English defaults. 3Play Media, Verbit: human QA; extended description.",
  );
  const rows = COMPETITORS.map(
    (c) =>
      `<tr><th>${esc(c.name)}${c.kind ? `<span>${esc(c.kind)}</span>` : ""}</th>${c.cells.map(cell).join("")}</tr>`,
  ).join("");
  const head = COMPARE_COLUMNS.map(
    (c, i) => `<th class="${i === CLAIM_COLUMN ? "claim" : ""}">${esc(c)}</th>`,
  ).join("");

  return slide({
    id: "s-different",
    name: "different",
    kind: "exhibit",
    body: `
<div class="intro"><h1 class="headline" style="max-width:1600px">Others fit the voice or check by hand. Gapline does both, automatically.</h1></div>
<div class="df-wrap" style="left:${MARGIN}px;top:${TABLE_TOP}px;width:${W - 2 * MARGIN}px">
<table class="df-table">
  <colgroup><col style="width:${NAME_COL}px">${COMPARE_COLUMNS.map((_, i) => (i === CLAIM_COLUMN ? `<col style="width:${CLAIM_COL}px">` : "<col>")).join("")}</colgroup>
  <thead><tr><th></th>${head}</tr></thead>
  <tbody>${rows}<tr class="scene"><th>Gapline</th>${SCENE_ROW.map(cell).join("")}</tr></tbody>
</table>
<p class="df-legend">— = not published${vendors}</p>
</div>`,
  });
}

export const DIFFERENT_CSS = `
.df-wrap { position:absolute; }
.df-table { width:100%; border-collapse:collapse; table-layout:fixed; }
.df-table th, .df-table td { text-align:left; vertical-align:top; padding:10px 16px 10px 0; border-top:1px solid var(--rule); }
.df-table thead th { border-top:none; font-size:var(--fs-label); font-weight:600; line-height:1.25; color:var(--ink-300); padding-bottom:14px; vertical-align:bottom; }
.df-table thead th.claim { color:var(--ink-100); }
.df-table tbody th { font-size:26px; font-weight:600; line-height:1.25; color:var(--ink-100); padding-right:24px; }
.df-table tbody th span { display:block; font-size:var(--fs-label); line-height:1.3; font-weight:400; color:var(--ink-400); }
.df-table td b { display:block; font-size:26px; font-weight:600; color:var(--ink-100); }
.df-table td span { display:block; font-size:var(--fs-label); line-height:1.3; color:var(--ink-400); }
.df-table td.unknown b, .df-table td.no b { font-weight:400; color:var(--ink-400); }
.df-table td.claim, .df-table th.claim { background:rgba(236,233,227,.05); padding-left:16px; }
.df-table td.claim + td, .df-table th.claim + th { padding-left:16px; }
.df-table tr.scene th, .df-table tr.scene td { background:var(--lane); border-top:3px solid var(--ink-100); padding-top:16px; padding-bottom:16px; }
.df-table tr.scene th { padding-left:16px; }
.df-table tr.scene td.no b { color:var(--ink-300); }
.df-table tr.scene td span { color:var(--ink-300); }
.df-legend { margin-top:22px; font-size:var(--fs-label); color:var(--ink-300); }
.df-table td span.df-nb { display:inline; white-space:nowrap; font-size:inherit; color:inherit; }
`;
