/**
 * "compare": the deck's benchmarking table (vendor pages and code read 23 Sep 2026, from
 * scripts/deck/facts.ts), every column, Gapline's own "No" included. The other tools come in first;
 * Gapline's row lights with the second sentence. Support is written as a word, never a symbol: the
 * film's fonts have no check marks.
 */
import type { Language } from "../../../src/lib/pipeline/schemas";
import type { Support } from "../../deck/facts";
import { film } from "../facts";
import { esc, note, pageHtml, pick, STAGE, type PageTiming } from "./shell";

const M = STAGE.margin;
const T = { top: 196, head: 96, row: 92, name: 380 };
/** How far the other tools step back once Gapline's row is in. */
const BACK = 0.55;

const COLUMN_NAMES: Record<Language, string[]> = {
  en: film.compare.columns,
  ko: [
    "실측 낭독에 맞춤",
    "변경마다 다시 검수",
    "가이드라인 인용",
    "놓친 것 보고",
    "한국 가이드라인·낭독",
    "영상 멈춤",
  ],
};
const SUPPORT: Record<Language, Record<Support, string>> = {
  en: { yes: "Yes", partly: "Partly", no: "No", unknown: "—" },
  ko: { yes: "지원", partly: "일부", no: "없음", unknown: "—" },
};
/** Vendor names stay as published; the Korean film translates only the description. */
const rowName = (name: string, lang: Language) =>
  lang === "ko" ? name.replace(", open source", " 오픈소스") : name;

export function comparePage(timing: PageTiming): string {
  const lang = timing.lang;
  const columns = COLUMN_NAMES[lang];
  if (columns.length !== film.compare.columns.length)
    throw new Error("the Korean column names no longer match the deck's columns");
  const colW = (STAGE.w - 2 * M - T.name) / columns.length;
  const cx = (i: number) => M + T.name + i * colW;
  const head = columns
    .map(
      (c, i) =>
        `<p class="a cp-col" style="left:${cx(i)}px;top:${T.top}px;width:${colW - 24}px">${esc(c)}</p>`,
    )
    .join("");
  const rows = [
    ...film.compare.competitors.map((c) => ({ name: c.name, cells: c.cells, ours: false })),
    { name: "Gapline", cells: film.compare.gapline, ours: true },
  ]
    .map((r, i) => {
      const y = T.top + T.head + i * T.row;
      const cells = r.cells
        .map(
          (c, j) =>
            `<p class="a cp-cell ${c.support}" data-i="${i}" data-j="${j}" style="left:${cx(j)}px;top:${y + 26}px">${SUPPORT[lang][c.support]}</p>`,
        )
        .join("");
      return `<div class="a cp-row${r.ours ? " ours" : ""}" data-i="${i}" style="top:${y}px"><p class="cp-name">${esc(rowName(r.name, lang))}</p></div>${cells}`;
    })
    .join("");
  const css = `
#cp-head { left:${M}px; top:52px; max-width:1740px; opacity:0; }
.cp-col { font-size:24px; line-height:1.25; font-weight:600; color:var(--ink-300); opacity:0; }
.cp-row { left:${M - 20}px; width:${STAGE.w - 2 * M + 40}px; height:${T.row - 8}px; border-top:1px solid var(--rule); opacity:0; }
.cp-row.ours { background:var(--lane); border-top-color:var(--amber); border-radius:0 0 8px 8px; }
.cp-name { position:absolute; left:20px; top:24px; font-size:30px; font-weight:600; color:var(--ink-100); white-space:nowrap; }
.cp-row.ours .cp-name { color:var(--amber); }
.cp-cell { font-size:28px; color:var(--ink-300); white-space:nowrap; opacity:0; }
.cp-cell.yes { color:var(--ink-100); font-weight:600; }
.cp-cell.unknown { color:var(--ink-400); }`;
  const body = `
<h2 class="a h2" id="cp-head">${pick(lang, {
    en: "Others fit the voice or check by hand; Gapline does both.",
    ko: "다른 도구는 길이를 맞추거나 사람이 검수합니다. 갭라인은 둘 다 합니다.",
  })}</h2>
${head}
${rows}
${note(
  pick(lang, {
    en: "Vendor pages and code, read 23 Sep 2026 · — : not published",
    ko: "업체 페이지·코드 확인 2026년 9월 23일 · —: 공개 자료 없음",
  }),
)}`;
  const others = film.compare.competitors.length;
  const render = `
const S = D.S, L = D.L;
reveal($('#cp-head'), prog(t, 0, 0.7));
$$('.cp-col').forEach((el) => { el.style.opacity = prog(t, S[0], 0.6); });
// The other tools one by one over the first sentence; Gapline's row with the second.
const rowAt = (i) => i < ${others} ? S[0] + 0.4 + i * (L[0] * 0.7) / ${others} : S[1] + 0.2;
$$('.cp-row').forEach((el) => reveal(el, prog(t, rowAt(Number(el.dataset.i)), 0.5), 8));

// Gapline's cells come one by one across its sentence, so the page keeps changing as it is read.
const cellAt = (i, j) => rowAt(i) + 0.2 + (i < ${others} ? 0 : j * (L[1] * 0.75) / ${film.compare.columns.length});
$$('.cp-cell').forEach((el) => { el.style.opacity = prog(t, cellAt(Number(el.dataset.i), Number(el.dataset.j)), 0.5); });
// Once Gapline's row is in, the other tools step back.
const back = ${BACK} * prog(t, S[1] + L[1] * 0.45, 0.6);
$$('.cp-row, .cp-cell').forEach((el) => {
  if (Number(el.dataset.i) < ${others}) el.style.opacity = Number(el.style.opacity) * (1 - back);
});`;
  return pageHtml({ lang, css, body, render, data: timing });
}
