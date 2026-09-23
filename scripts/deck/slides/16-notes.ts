/**
 * 16. Sources and notes: every endnote the slides filed, grouped by slide in reading order (the slide's
 * position in slides/index.ts, whatever its file is called), in two columns of the deck's fine type.
 * Built last, after every slide has filed its notes. Pages are split by the notes' estimated length,
 * so rewriting a slide's notes never needs a hand-picked split. The column box has a fixed height: if
 * the estimate runs short, notes spill sideways and the build's clipping check fails instead of
 * printing a page that drops them; lower PAGE_FILL if that happens.
 */
import { slide } from "../html";
import { allNotes, type Note } from "../notes";
import { H, MARGIN, TYPE_PX, W } from "../theme";

const TOP = 156;
const BOTTOM = 56;
const COLUMNS = 2;
const COLUMN_GAP = 64;
const COLUMN_W = (W - 2 * MARGIN - (COLUMNS - 1) * COLUMN_GAP) / COLUMNS;
const BOX_H = H - TOP - BOTTOM;
/** Line heights, relative to the fine type the notes are set in. */
const NOTE_LEADING = 1.36;
const HEAD_LEADING = 1.3;
/** Space under a note, above a group's heading rule, and under a group (px; the CSS uses them). */
const NOTE_GAP = 5;
const HEAD_PAD = 6;
const HEAD_GAP = 4;
const GROUP_GAP = 14;
/** Width of a note's number before its text (px): room for two digits and a space. */
const NUMBER_W = 36;
/**
 * Average advance of a character in the notes' type, in ems. Latin text: 0.48 em is the smallest value
 * that estimated no note of the deck short (45 notes rendered on 23 Sep 2026: 158 lines estimated, 149
 * set; 0.46 missed one). Hangul syllables take a full em.
 */
const LATIN_EM = 0.48;
const HANGUL_EM = 1;
/**
 * Share of a page's two columns the estimate may fill. Notes never break across a column, so each
 * column ends with some unused space; the margin also absorbs an estimate that runs short.
 */
const PAGE_FILL = 0.92;

const noteLine = TYPE_PX.fine * NOTE_LEADING;
const headHeight = TYPE_PX.fine * HEAD_LEADING + HEAD_PAD + HEAD_GAP + 1;
const pageCapacity = COLUMNS * BOX_H * PAGE_FILL;

/** A note's text as the reader sees it, without its markup. */
const plainText = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;|&#\d+;/g, "x")
    .trim();

/** Estimated height of one note in a column (px). */
function noteHeight(n: Note): number {
  const ems = [...plainText(n.html)].reduce(
    (sum, ch) => sum + (/[\uac00-\ud7a3]/.test(ch) ? HANGUL_EM : LATIN_EM),
    0,
  );
  const lines = Math.ceil((NUMBER_W + ems * TYPE_PX.fine) / COLUMN_W);
  return lines * noteLine + NOTE_GAP;
}

/** Notes in groups, one per slide, in the order they were filed. */
function groupsOf(notes: readonly Note[]): Note[][] {
  const groups: Note[][] = [];
  for (const n of notes) {
    const last = groups[groups.length - 1];
    if (last && last[0].position === n.position && last[0].slide === n.slide) last.push(n);
    else groups.push([n]);
  }
  return groups;
}

/**
 * Pages of notes, filled in order. A note that does not fit in what is left of the page starts the
 * next one; a slide's group may run on across pages, and its heading repeats at the top of the next.
 */
function paginate(notes: readonly Note[]): Note[][] {
  const pages: Note[][] = [[]];
  let used = 0;
  let lastGroup: Note | null = null;
  for (const n of notes) {
    const opensGroup =
      lastGroup === null || lastGroup.position !== n.position || lastGroup.slide !== n.slide;
    const need = noteHeight(n) + (opensGroup ? headHeight + GROUP_GAP : 0);
    if (used > 0 && used + need > pageCapacity) {
      pages.push([]);
      // The group's heading prints again on the new page.
      used = opensGroup ? 0 : headHeight + GROUP_GAP;
    }
    pages[pages.length - 1].push(n);
    used += need;
    lastGroup = n;
  }
  return pages;
}

function group(notes: Note[]): string {
  return groupsOf(notes)
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
  const notes = allNotes();
  if (notes.length === 0) throw new Error("no notes were filed");
  const pages = paginate(notes);
  if (pages.some((p) => p.length === 0)) throw new Error("the notes split left an empty page");
  return pages.map((page, i) =>
    slide({
      id: "s-notes",
      name: pages.length > 1 ? `notes-${i + 1}` : "notes",
      kind: "notes",
      body: `
<div class="intro nt-intro"><h1 class="headline nt-title">Sources and notes</h1>${pages.length > 1 ? `<p class="nt-page">${i + 1} of ${pages.length}</p>` : ""}</div>
<div class="nt-cols" data-fit style="left:${MARGIN}px;top:${TOP}px;width:${W - 2 * MARGIN}px;height:${BOX_H}px">${group(page)}</div>`,
    }),
  );
}

export const NOTES_CSS = `
.nt-title { font-size:52px; }
.nt-intro { display:flex; align-items:baseline; gap:24px; }
.nt-page { font-size:var(--fs-label); color:var(--ink-400); }
.nt-cols { position:absolute; column-count:${COLUMNS}; column-gap:${COLUMN_GAP}px; column-fill:auto; overflow:hidden; }
.nt-g { break-inside:auto; margin-bottom:${GROUP_GAP}px; }
.nt-h { display:flex; gap:12px; align-items:baseline; font-size:var(--fs-fine); font-weight:600; line-height:${HEAD_LEADING}; color:var(--ink-100);
  border-top:1px solid var(--rule); padding-top:${HEAD_PAD}px; margin-bottom:${HEAD_GAP}px; break-after:avoid; }
.nt-h .mono { color:var(--ink-400); font-weight:400; }
.nt-p { font-size:var(--fs-fine); line-height:${NOTE_LEADING}; color:var(--ink-300); margin-bottom:${NOTE_GAP}px; break-inside:avoid; text-wrap:pretty; }
.nt-p b { display:inline-block; min-width:${NUMBER_W}px; font-weight:600; color:var(--ink-100); font-variant-numeric:tabular-nums; }
.nt-p i { font-style:italic; }
`;
