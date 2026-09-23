/** Slide order (the story spine's beats) and the CSS each slide adds to the base theme. */
import { COVER_CSS, coverSlide } from "./01-cover";
import { SEVEN_CSS, sevenSlide } from "./02-seven";
import { WHY_NOW_CSS, whyNowSlide } from "./03-why-now";
import { CONSTRAINT_CSS, constraintSlide } from "./04-constraint";
import { HOW_CSS, howSlide } from "./05-how";
import { REVIEWER_CSS, reviewerSlide } from "./06-reviewer";
import { MEASURED_CSS, measuredSlide } from "./07-measured";
import { EDITOR_CSS, editorSlide } from "./08-editor";
import { HONEST_CSS, honestSlide } from "./09-honest";
import { CAUGHT_CSS, caughtSlide } from "./10-caught";
import { CLOUD_CSS, cloudSlide } from "./11-cloud";
import { DIFFERENT_CSS, differentSlide } from "./12-different";
import { BUSINESS_CSS, businessSlide } from "./13-business";
import { NOT_PROVEN_CSS, notProvenSlide } from "./14-not-proven";
import { CLOSE_CSS, closeSlide } from "./15-close";
import { NOTES_CSS, notesSlides } from "./16-notes";

const SLIDES: (() => string)[] = [
  coverSlide,
  sevenSlide,
  whyNowSlide,
  constraintSlide,
  howSlide,
  reviewerSlide,
  measuredSlide,
  editorSlide,
  honestSlide,
  caughtSlide,
  cloudSlide,
  differentSlide,
  businessSlide,
  notProvenSlide,
  closeSlide,
];

export const DECK_CSS = [
  COVER_CSS,
  SEVEN_CSS,
  WHY_NOW_CSS,
  CONSTRAINT_CSS,
  HOW_CSS,
  REVIEWER_CSS,
  MEASURED_CSS,
  EDITOR_CSS,
  HONEST_CSS,
  CAUGHT_CSS,
  CLOUD_CSS,
  DIFFERENT_CSS,
  BUSINESS_CSS,
  NOT_PROVEN_CSS,
  CLOSE_CSS,
  NOTES_CSS,
].join("\n");

/** Every page in order. The notes pages come last: they list what the slides filed while building. */
export function buildSlides(): string[] {
  return [...SLIDES.map((make) => make()), ...notesSlides()];
}
