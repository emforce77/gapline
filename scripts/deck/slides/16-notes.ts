/**
 * 16. Sources and notes: every endnote the slides filed, grouped by slide in reading order, in two
 * columns of small type. Built last, after every slide has filed its notes. The column box has a fixed
 * height, so notes that do not fit spill sideways and the build's clipping check fails instead of
 * printing a page that drops them; split into more pages with NOTE_PAGES if that happens.
 */
import { slide } from "../html";
import { allNotes, type Note } from "../notes";
import { MARGIN, W } from "../theme";

/** Slides whose notes start a new notes page (by page number); empty means one page. */
const NOTE_PAGES: number[] = [6, 10];
const TOP = 156;
const BOTTOM = 56;
const H = 1080;

function group(notes: Note[]): string {
  const bySlide = new Map<string, Note[]>();
  for (const n of notes) {
    const key = `${n.folio ?? ""}|${n.slide}`;
    bySlide.set(key, [...(bySlide.get(key) ?? []), n]);
  }
  return [...bySlide.values()]
    .map((list) => {
      const { folio, slide: name } = list[0];
      const head = `<h2 class="nt-h">${folio === null ? "" : `<span class="mono">${String(folio).padStart(2, "0")}</span>`}${name}</h2>`;
      const items = list
        .map((n) => `<p class="nt-p" id="note-${n.n}"><b>${n.n}</b>${n.html}</p>`)
        .join("");
      return `<section class="nt-g">${head}${items}</section>`;
    })
    .join("");
}

export function notesSlides(): string[] {
  const notes = [...allNotes()];
  if (notes.length === 0) throw new Error("no notes were filed");
  const cuts = [...NOTE_PAGES].sort((a, b) => a - b);
  const pages: Note[][] = [];
  let rest = notes;
  for (const cut of cuts) {
    const at = rest.findIndex((n) => n.folio !== null && n.folio >= cut);
    if (at <= 0) throw new Error(`notes page split at ${cut} leaves an empty page`);
    pages.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  pages.push(rest);
  return pages.map((page, i) =>
    slide({
      id: "s-notes",
      name: pages.length > 1 ? `notes-${i + 1}` : "notes",
      folio: null,
      kind: "notes",
      body: `
<div class="intro nt-intro"><h1 class="headline nt-title">Sources and notes</h1>${pages.length > 1 ? `<p class="nt-page">${i + 1} of ${pages.length}</p>` : ""}</div>
<div class="nt-cols" data-fit style="left:${MARGIN}px;top:${TOP}px;width:${W - 2 * MARGIN}px;height:${H - TOP - BOTTOM}px">${group(page)}</div>`,
    }),
  );
}

export const NOTES_CSS = `
.nt-title { font-size:52px; }
.nt-intro { display:flex; align-items:baseline; gap:24px; }
.nt-page { font-size:24px; color:var(--ink-400); }
.nt-cols { position:absolute; column-count:2; column-gap:64px; column-fill:auto; overflow:hidden; }
.nt-g { break-inside:auto; margin-bottom:14px; }
.nt-h { display:flex; gap:12px; align-items:baseline; font-size:19px; font-weight:600; line-height:1.3; color:var(--ink-100);
  border-top:1px solid var(--rule); padding-top:6px; margin-bottom:4px; break-after:avoid; }
.nt-h .mono { color:var(--ink-400); font-weight:400; }
.nt-p { font-size:18px; line-height:1.36; color:var(--ink-300); margin-bottom:5px; break-inside:avoid; text-wrap:pretty; }
.nt-p b { display:inline-block; min-width:30px; font-weight:600; color:var(--ink-100); font-variant-numeric:tabular-nums; }
.nt-p i { font-style:italic; }
`;
