/**
 * Endnotes. A slide calls the `note` function it gets from `notesFor` wherever a number or claim
 * needs its source; that prints a small superscript marker linked to the "Sources and notes" pages and
 * files the text under the slide. Notes are filed under the page being built (its position in
 * `slides/index.ts`, see `placePage`), never under a number the slide file names, so reordering the
 * deck regroups the notes with it. Markers are numbered in build order, so the notes pages list them
 * in reading order. The notes pages are built last from `allNotes()`.
 */
import { currentPlace } from "./html";

export interface Note {
  n: number;
  /** 1-based position of the slide the note belongs to. */
  position: number;
  /** Page number printed on that slide; null on pages that print none (the cover, the close). */
  folio: number | null;
  /** Short name of the slide on the notes page. */
  slide: string;
  /** HTML: already escaped by the caller. */
  html: string;
}

const registry: Note[] = [];

export type NoteMarker = (html: string) => string;

/**
 * Returns the note function for the slide being built. Each call adds a note and returns its marker.
 * `slide` is the short name the notes page prints above the slide's notes.
 */
export function notesFor(slide: string): NoteMarker;
/** @deprecated The number is ignored: notes file under the slide's position. Pass the name only. */
export function notesFor(folio: number | null, slide: string): NoteMarker;
export function notesFor(first: string | number | null, second?: string): NoteMarker {
  const slide = typeof first === "string" ? first : second;
  if (slide === undefined) throw new Error("notesFor needs the slide's short name");
  const { position, folio } = currentPlace();
  return (html: string): string => {
    const n = registry.length + 1;
    registry.push({ n, position, folio, slide, html });
    return `<sup class="fn"><a href="#note-${n}">${n}</a></sup>`;
  };
}

export function allNotes(): readonly Note[] {
  return registry;
}
