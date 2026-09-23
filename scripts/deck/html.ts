/** Small HTML helpers shared by the slides. */

export const esc = (s: string | number): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const px = (n: number): string => `${Math.round(n * 100) / 100}px`;

/** A space that never breaks a number from its unit. */
export const NBSP = "\u00a0";

/** Seconds as the deck prints them: two decimals, the unit kept on the number's line. */
export const secs = (x: number, digits = 2): string => `${x.toFixed(digits)}${NBSP}s`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-23" → "Sep 2026" */
export function monthYear(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** "2026-09-23" → "23 Sep 2026", the way the notes write dates. */
export function dayMonthYear(iso: string): string {
  return `${new Date(`${iso}T00:00:00Z`).getUTCDate()} ${monthYear(iso)}`;
}

export const usd = (x: number, digits = 2): string => `$${x.toFixed(digits)}`;

/**
 * How much text a slide may carry (checked by the build over all visible text but the page number):
 * "prose" slides 90 words, "exhibit" slides (a table, a chart, a diagram) 120, the notes page no cap.
 */
export type SlideKind = "prose" | "exhibit" | "notes";
export const WORD_BUDGET: Record<SlideKind, number | null> = {
  prose: 90,
  exhibit: 120,
  notes: null,
};

export interface SlideParts {
  id: string;
  /** Short name used for the PNG file and the build report. */
  name: string;
  /** Page number; null on the cover, the close and the notes. */
  folio: number | null;
  kind: SlideKind;
  body: string;
  /** Print the film's credit in small type: every slide that shows a frame of the film. */
  filmCredit?: boolean;
}

export const FILM_CREDIT_SHORT = "<i>Tears of Steel</i> © Blender Foundation, CC BY 3.0";

export function slide(p: SlideParts): string {
  const credit = p.filmCredit ? `<p class="credit">${FILM_CREDIT_SHORT}</p>` : "";
  return `<section class="slide ${p.id}" data-name="${esc(p.name)}" data-kind="${p.kind}">
${p.body}
${p.folio === null ? "" : `<p class="folio">${String(p.folio).padStart(2, "0")}</p>`}
${credit}
</section>`;
}

/** Headline, with an optional body column on the right (the "split" intro). */
export function intro(headline: string, body?: string, width?: number): string {
  if (!body)
    return `<div class="intro"><h1 class="headline"${width ? ` style="max-width:${width}px"` : ""}>${headline}</h1></div>`;
  return `<div class="intro split"><h1 class="headline">${headline}</h1><p class="body">${body}</p></div>`;
}

/** The x mark that always travels with a rejection label. */
export const REJECT_MARK = `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M4 4 L18 18 M18 4 L4 18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`;

/** The tick that travels with a pass. */
export const PASS_MARK = `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><path d="M3 12 L9 18 L19 5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** A word-sized bullet graph: outline = room, fill = measured voice. */
export function bullet(voiced: number, room: number, width: number, height = 16): string {
  const fill = Math.min(voiced / room, 1) * width;
  return `<span style="display:inline-block;position:relative;width:${width}px;height:${height}px;border:2px solid var(--amber-room);border-radius:3px;vertical-align:middle"><span style="position:absolute;left:0;top:0;bottom:0;width:${px(fill)};background:var(--amber);border-radius:2px"></span></span>`;
}
