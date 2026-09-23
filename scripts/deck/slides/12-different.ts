/**
 * 12. Where Scene is different: a fair table with named alternatives, terse cells, a dash wherever a
 * vendor does not document something, and the column Scene loses (pausing the film) kept in. The
 * headline names what Scene adds: its own shortenings and every human edit face the same checks.
 */
import { MAX_UPLOAD_SECONDS } from "../../../src/lib/api-contract";
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

/** A hyphenated word ("re-voices") never breaks at its hyphen. */
const keepWhole = (text: string) =>
  esc(text).replace(/(\S+-\S+)/g, '<span class="df-nb">$1</span>');

function cell(c: CompetitorCell, col: number): string {
  const note = c.note === "" ? "" : `<span>${keepWhole(c.note)}</span>`;
  return `<td class="${c.support}${col === CLAIM_COLUMN ? " claim" : ""}"><b>${WORD[c.support]}</b>${note}</td>`;
}

export function differentSlide(): string {
  const note = notesFor(12, "Scene re-checks its own shortenings…");
  if (
    COMPETITORS.some((c) => c.cells.length !== COMPARE_COLUMNS.length) ||
    SCENE_ROW.length !== COMPARE_COLUMNS.length
  )
    throw new Error("comparison rows and columns disagree");
  // The legend says a "No" comes from the vendor's own code: only the open-source row has one.
  if (
    COMPETITORS.some(
      (c) => !c.name.includes("open source") && c.cells.some((x) => x.support === "no"),
    )
  )
    throw new Error("a 'No' outside the open-source row; the legend says we read it in their code");
  const scene = note(
    `Every automatic shortening and every editor’s sentence is reviewed again and must fit its measured room; a failing editor’s sentence comes back with the reason. The list of what a track misses is written by a model (the final check). Standard (inline) description only; clips up to ${MAX_UPLOAD_SECONDS} s.`,
  );
  const vendors = note(
    "Read 23 Sep 2026. MediaScribe (mediascribe.ai): silences of 3 s or more, 2.5 words a second, overruns summarized and re-voiced. ViddyScribe (docs.viddyscribe.com): Gemini API Developer Competition winner, 2024; 53 languages including Korean; auto-fit; extended description; videos up to 8 h. Microsoft (github.com/microsoft/ai-audio-descriptions): measures every line at render, edited ones included, and speeds a line up to at most 1.15× in tempo, else the render fails; no review stage; English defaults. 3Play Media, Verbit: human QA; extended description.",
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
    folio: 12,
    kind: "exhibit",
    body: `
<div class="intro"><h1 class="headline" style="max-width:1600px">Scene re-checks its own shortenings and every human edit.</h1></div>
<table class="df-table" style="left:${MARGIN}px;top:276px;width:${W - 2 * MARGIN}px">
  <thead><tr><th></th>${head}</tr></thead>
  <tbody>${rows}<tr class="scene"><th>Scene${scene}</th>${SCENE_ROW.map(cell).join("")}</tr></tbody>
</table>
<p class="df-legend" style="left:${MARGIN}px;top:944px">A dash: the vendor does not document it. No: we checked their code.${vendors}</p>`,
  });
}

export const DIFFERENT_CSS = `
.df-table { position:absolute; border-collapse:collapse; table-layout:fixed; }
.df-table th, .df-table td { text-align:left; vertical-align:top; padding:12px 16px 12px 0; border-top:1px solid var(--rule); }
.df-table thead th { border-top:none; font-size:24px; font-weight:600; line-height:1.25; color:var(--ink-300); padding-bottom:14px; vertical-align:bottom; }
.df-table thead th.claim { color:var(--ink-100); }
.df-table thead th:first-child { width:300px; }
.df-table tbody th { font-size:26px; font-weight:600; line-height:1.25; color:var(--ink-100); padding-right:24px; }
.df-table tbody th span { display:block; font-size:24px; line-height:1.3; font-weight:400; color:var(--ink-400); }
.df-table td b { display:block; font-size:26px; font-weight:600; color:var(--ink-100); }
.df-table td span { display:block; font-size:24px; line-height:1.3; color:var(--ink-400); }
.df-table td.unknown b, .df-table td.no b { font-weight:400; color:var(--ink-400); }
.df-table td.claim, .df-table th.claim { background:rgba(236,233,227,.05); padding-left:16px; }
.df-table td.claim + td, .df-table th.claim + th { padding-left:16px; }
.df-table tr.scene th, .df-table tr.scene td { background:var(--lane); border-top:3px solid var(--ink-100); padding-top:16px; padding-bottom:16px; }
.df-table tr.scene th { padding-left:16px; }
.df-table tr.scene td.no b { color:var(--ink-300); }
.df-table tr.scene td span { color:var(--ink-300); }
.df-legend { position:absolute; font-size:24px; color:var(--ink-300); }
.df-table td span.df-nb { display:inline; white-space:nowrap; font-size:inherit; color:inherit; }
`;
