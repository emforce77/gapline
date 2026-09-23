/** Writes runtime/deck/scene-deck_check.md: what the build checked and what it found. */
import { writeFileSync } from "node:fs";
import type { CheckReport } from "./checks";
import { CHECK_NOTE, DECK_PDF } from "./paths";

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

export function writeCheckNote(r: CheckNoteInput): void {
  const today = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
  const box = (ok: boolean) => (ok ? "[x]" : "[ ]");
  const words = r.words.map(
    (w) => `${w.name} ${w.words}${w.budget === null ? "" : `/${w.budget}`}`,
  );
  const counts = r.words.filter((w) => w.budget !== null).map((w) => w.words);
  const lines = [
    `# scene-deck.pdf — check (${today})`,
    "",
    `Built by \`npm run deck\` (scripts/deck/build-deck.ts) from runtime run records. ${r.slides.length} pages: ${r.slides.join(", ")}.`,
    "",
    `- ${box(r.problems.length === 0)} layout, text size (22 px; grey 24 px; credits, markers and notes 18 px), contrast (4.5:1), edges, clipping, overlaps, text budget (all visible text: 90 words, 120 on table/chart/diagram slides; headline 14; prose 40), no slide-number cross-references, endnote markers, remote requests: ${r.problems.length} problems`,
    ...r.problems.map((p) => `  - **${p}**`),
    `- [x] words of visible text per page (count/budget), min ${Math.min(...counts)}, max ${Math.max(...counts)}: ${words.join(", ")}`,
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
