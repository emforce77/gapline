/**
 * Slide order (the story's beats) and the CSS each slide adds to the base theme. A slide's page number
 * and the group its endnotes print under follow its position here, not its file name: the files keep
 * the numbers they were written under, and moving an entry is all a reorder takes.
 * The one-slide renderer finds a slide's position by the `file` strings below, so keep them literal.
 */
import { placePage } from "../html";
import { COVER_CSS, coverSlide } from "./01-cover";
import { SEVEN_CSS, sevenSlide } from "./02-seven";
import { WHY_NOW_CSS, whyNowSlide } from "./03-why-now";
import { CONSTRAINT_CSS, constraintSlide } from "./04-constraint";
import { HOW_CSS, howSlide } from "./05-how";
import { REVIEWER_CSS, reviewerSlide } from "./06-reviewer";
import { MEASURED_CSS, measuredSlide } from "./07-measured";
import { EDITOR_CSS, editorSlide } from "./08-editor";
import { CAUGHT_CSS, caughtSlide } from "./10-caught";
import { CLOUD_CSS, cloudSlide } from "./11-cloud";
import { DIFFERENT_CSS, differentSlide } from "./12-different";
import { BUSINESS_CSS, businessSlide } from "./13-business";
import { NOT_PROVEN_CSS, notProvenSlide } from "./14-not-proven";
import { CLOSE_CSS, closeSlide } from "./15-close";
import { NOTES_CSS, notesSlides } from "./16-notes";

interface DeckPage {
  /** The slide's module, for people and for the one-slide renderer. */
  file: string;
  make: () => string;
  css: string;
  /** Whether the slide prints its page number (the cover and the close do not). */
  numbered: boolean;
}

/** The 14 beats, in the order a judge meets them. */
const PAGES: DeckPage[] = [
  { file: "01-cover", make: coverSlide, css: COVER_CSS, numbered: false },
  { file: "02-seven", make: sevenSlide, css: SEVEN_CSS, numbered: true },
  { file: "03-why-now", make: whyNowSlide, css: WHY_NOW_CSS, numbered: true },
  { file: "04-constraint", make: constraintSlide, css: CONSTRAINT_CSS, numbered: true },
  // The product: one press makes the whole track (the deck's one mention of the optional edit).
  { file: "08-editor", make: editorSlide, css: EDITOR_CSS, numbered: true },
  // How it checks itself: the pipeline in code order, with Fix as its own stage and Mix last.
  { file: "05-how", make: howSlide, css: HOW_CSS, numbered: true },
  { file: "06-reviewer", make: reviewerSlide, css: REVIEWER_CSS, numbered: true },
  { file: "07-measured", make: measuredSlide, css: MEASURED_CSS, numbered: true },
  // Gapline listens twice: the launch call.
  { file: "10-caught", make: caughtSlide, css: CAUGHT_CSS, numbered: true },
  { file: "11-cloud", make: cloudSlide, css: CLOUD_CSS, numbered: true },
  { file: "12-different", make: differentSlide, css: DIFFERENT_CSS, numbered: true },
  { file: "13-business", make: businessSlide, css: BUSINESS_CSS, numbered: true },
  // What we will test next.
  { file: "14-not-proven", make: notProvenSlide, css: NOT_PROVEN_CSS, numbered: true },
  { file: "15-close", make: closeSlide, css: CLOSE_CSS, numbered: false },
];

export const DECK_CSS = [...PAGES.map((p) => p.css), NOTES_CSS].join("\n");

/** Every page in order. The notes pages come last: they list what the slides filed while building. */
export function buildSlides(): string[] {
  try {
    const slides = PAGES.map((p, i) => {
      placePage({ position: i + 1, folio: p.numbered ? i + 1 : null });
      return p.make();
    });
    placePage({ position: PAGES.length + 1, folio: null });
    return [...slides, ...notesSlides()];
  } finally {
    placePage(null);
  }
}
