/**
 * Endnotes. A slide calls the `note` function it gets from `notesFor` wherever a number or claim
 * needs its source; that prints a small superscript marker linked to the "Sources and notes" page and
 * files the text under the slide. Markers are numbered in the order the slides are built, so the
 * notes page lists them in reading order. The notes page is built last from `allNotes()`.
 */

export interface Note {
  n: number;
  /** Page number of the slide the note belongs to; null for the cover and the close. */
  folio: number | null;
  /** Short name of the slide on the notes page. */
  slide: string;
  /** HTML: already escaped by the caller. */
  html: string;
}

const registry: Note[] = [];

export type NoteMarker = (html: string) => string;

/** Returns the note function for one slide. Each call adds a note and returns its marker. */
export function notesFor(folio: number | null, slide: string): NoteMarker {
  return (html: string): string => {
    const n = registry.length + 1;
    registry.push({ n, folio, slide, html });
    return `<sup class="fn"><a href="#note-${n}">${n}</a></sup>`;
  };
}

export function allNotes(): readonly Note[] {
  return registry;
}
