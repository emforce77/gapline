/** Writes runtime/deck/scene-deck_check.md: what the build checked and what it found. */
import { writeFileSync } from "node:fs";
import {
  MAX_HEADLINE_WORDS,
  MAX_PROSE_WORDS,
  MIN_CONTRAST,
  SAFE_EDGE,
  type CheckReport,
} from "./checks";
import { WORD_BUDGET } from "./html";
import { CHECK_NOTE, DECK_PDF } from "./paths";
import { MIN_GREY_PX, MIN_SMALL_PX, MIN_TEXT_PX } from "./theme";

export interface CheckNoteInput {
  notes: string[];
  painted: string[];
  pdfFonts: string[];
  problems: string[];
  slides: string[];
  words: CheckReport["words"];
  endnotes: number;
  /** Still to change before submission (`npm run deck -- --final` refuses while any is open). */
  open: string[];
}

/** "02 seven 83/100 · headline 9/14 · prose 31/35", or the words alone on a notes page. */
function wordLine(w: CheckReport["words"][number], position: number): string {
  const at = `${String(position).padStart(2, "0")} ${w.name}`;
  if (w.budget === null) return `  - ${at}: ${w.words} words (notes, no cap)`;
  const over = (n: number, cap: number) => (n > cap ? ` **over ${cap}**` : `/${cap}`);
  return `  - ${at}: ${w.words}${over(w.words, w.budget)} · headline ${w.headline}${over(w.headline, MAX_HEADLINE_WORDS)} · prose ${w.prose}${over(w.prose, MAX_PROSE_WORDS)}`;
}

export function writeCheckNote(r: CheckNoteInput): void {
  const today = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
  const box = (ok: boolean) => (ok ? "[x]" : "[ ]");
  const counted = r.words.filter((w) => w.budget !== null).map((w) => w.words);
  const editPages = r.words.filter((w) => w.edits > 0);
  /** The cover states the promise; besides it, the optional edit is told on one slide at most. */
  const editBody = editPages.filter((w) => w.name !== "cover");
  const rules = [
    `text size (${MIN_TEXT_PX} px; grey ${MIN_GREY_PX} px; credits, markers and notes ${MIN_SMALL_PX} px)`,
    `contrast (${MIN_CONTRAST}:1)`,
    `edges (${SAFE_EDGE} px)`,
    "clipping, overlaps",
    `text budget (all visible text: ${WORD_BUDGET.prose} words, ${WORD_BUDGET.exhibit} on table/chart/diagram slides; headline ${MAX_HEADLINE_WORDS}; prose ${MAX_PROSE_WORDS})`,
    "no slide-number cross-references",
    "wording (no defensive negatives; no run ids, rule ids, page citations or multipliers on a slide face)",
    "endnote markers, remote requests",
  ];
  const lines = [
    `# scene-deck.pdf — check (${today})`,
    "",
    `Built by \`npm run deck\` (scripts/deck/build-deck.ts) from runtime run records. ${r.slides.length} pages: ${r.slides.join(", ")}.`,
    "",
    `- ${box(r.problems.length === 0)} layout, ${rules.join(", ")}: ${r.problems.length} problems`,
    ...r.problems.map((p) => `  - **${p}**`),
    `- [x] words of visible text per page (count/budget), min ${Math.min(...counted)}, max ${Math.max(...counted)}:`,
    ...r.words.map((w, i) => wordLine(w, i + 1)),
    `- ${box(editBody.length <= 1)} the optional edit is told on one slide at most beyond the cover: ${
      editPages.length === 0
        ? "no slide mentions editing"
        : editPages.map((w) => `${w.name} (${w.edits})`).join(", ")
    }`,
    `- [x] ${r.endnotes} endnotes, each with a marker on its slide`,
    `- [x] fonts painted (CDP, per node class):`,
    ...r.painted.map((p) => `  - ${p}`),
    `- [x] PDF fonts (pdffonts ${DECK_PDF.split("/").pop()}), no Type 3:`,
    ...r.pdfFonts.map((p) => `  - ${p}`),
    ...r.notes.map((n) => `- [x] ${n}`),
    `- ${box(r.open.length === 0)} ready for submission: ${r.open.length} open`,
    ...r.open.map((o) => `  - **${o}**`),
  ];
  writeFileSync(CHECK_NOTE, `${lines.join("\n")}\n`);
}
