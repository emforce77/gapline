/**
 * Checks run in the rendered deck before anything is written: fonts actually painted, text size floors,
 * contrast, text leaving its slide, clipped labels, overlapping text, how much text each slide carries,
 * cross-references by slide number, and that every endnote marker has its note. Each returns readable
 * problem strings; the build fails when any list is non-empty.
 */
import type { Page } from "playwright-core";
import { WORD_BUDGET } from "./html";
import { COLOR, MIN_GREY_PX, MIN_SMALL_PX, MIN_TEXT_PX } from "./theme";

const MIN_CONTRAST = 4.5;
const MAX_HEADLINE_WORDS = 14;
/** Prose outside the headline and the exhibit (the `.body` paragraphs of a slide). */
const MAX_PROSE_WORDS = 40;
/** Text may come no closer to a slide edge than this, except on film frames that bleed. */
const SAFE_EDGE = 24;

export interface CheckReport {
  painted: string[];
  problems: string[];
  /** Words of visible text per slide, for the check note. */
  words: { name: string; words: number; budget: number | null }[];
}

/** Which font files Chrome used to paint representative nodes (not just which were requested). */
async function paintedFonts(page: Page): Promise<Omit<CheckReport, "words">> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const expect: [string, string][] = [
    [".headline", "Newsreader"],
    ["[lang=ko]", "Pretendard"],
    [".body", "Pretendard"],
    [".mono", "IBM Plex Mono"],
  ];
  const painted: string[] = [];
  const problems: string[] = [];
  for (const [selector, family] of expect) {
    const { nodeIds } = await cdp.send("DOM.querySelectorAll", { nodeId: root.nodeId, selector });
    if (nodeIds.length === 0) problems.push(`no ${selector} nodes to check`);
    const families = new Set<string>();
    for (const nodeId of nodeIds) {
      const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
      fonts.forEach((f) => families.add(f.familyName));
    }
    painted.push(`${selector} (${nodeIds.length} nodes): ${[...families].join(", ")}`);
    const wrong = [...families].filter((f) => !f.startsWith(family));
    if (wrong.length > 0)
      problems.push(`${selector} painted in ${wrong.join(", ")}, expected ${family}`);
  }
  await cdp.detach();
  return { painted, problems };
}

interface PageLimits {
  minPx: number;
  minGreyPx: number;
  minSmallPx: number;
  minContrast: number;
  edge: number;
  greys: string[];
  budgets: Record<string, number | null>;
  maxHeadline: number;
  maxProse: number;
}

const hexToRgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
};

/** Layout, size, contrast, length and reference checks, all computed in the page. */
async function layoutProblems(
  page: Page,
): Promise<{ problems: string[]; words: CheckReport["words"] }> {
  const limits: PageLimits = {
    minPx: MIN_TEXT_PX,
    minGreyPx: MIN_GREY_PX,
    minSmallPx: MIN_SMALL_PX,
    minContrast: MIN_CONTRAST,
    edge: SAFE_EDGE,
    greys: [hexToRgb(COLOR.ink300), hexToRgb(COLOR.ink400)],
    budgets: WORD_BUDGET,
    maxHeadline: MAX_HEADLINE_WORDS,
    maxProse: MAX_PROSE_WORDS,
  };
  return page.evaluate((L: PageLimits) => {
    const out: string[] = [];
    const words: { name: string; words: number; budget: number | null }[] = [];
    const lum = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const parse = (s: string) => (s.match(/[\d.]+/g) ?? []).map(Number);
    /** First opaque background behind an element, or null when a film frame is behind it. */
    const backdrop = (el: Element): number[] | null => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        if (n.classList.contains("on-film")) return null;
        const [r, g, b, a = 1] = parse(getComputedStyle(n).backgroundColor);
        if (a > 0.9) return [r, g, b];
      }
      return [0, 0, 0];
    };
    /** Words: whitespace-separated tokens that hold a letter or a digit (dashes and dots do not count). */
    const countWords = (text: string) =>
      text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    /** Visible text of an element, without the text of the parts matched by `skip`. */
    const textOf = (root: Element, skip: string) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let text = "";
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const parent = n.parentElement;
        if (!parent || parent.closest(skip)) continue;
        if (parent.getClientRects().length === 0) continue;
        text += ` ${n.textContent ?? ""}`;
      }
      return text;
    };

    document.querySelectorAll<HTMLElement>(".slide").forEach((slide) => {
      const name = slide.dataset.name ?? "?";
      const kind = slide.dataset.kind ?? "";
      if (!(kind in L.budgets)) out.push(`${name}: unknown slide kind "${kind}"`);
      const isNotes = kind === "notes";
      const box = slide.getBoundingClientRect();
      const leaves = [...slide.querySelectorAll<HTMLElement>("*")].filter((el) =>
        [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== ""),
      );
      for (const el of leaves) {
        const cs = getComputedStyle(el);
        const text = (el.textContent ?? "").trim().slice(0, 40);
        const size = parseFloat(cs.fontSize);
        const small = isNotes || el.closest(".credit, sup.fn") !== null;
        const grey = L.greys.includes(cs.color);
        const floor = small ? L.minSmallPx : grey ? L.minGreyPx : L.minPx;
        if (size < floor - 0.01)
          out.push(`${name}: "${text}" is ${size}px${grey ? " grey" : ""}, below ${floor}px`);
        const bg = backdrop(el);
        if (bg) {
          const fg = parse(cs.color);
          const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
          if (ratio < L.minContrast) out.push(`${name}: "${text}" contrast ${ratio.toFixed(2)}:1`);
        }
        // The painted text, not the element box: a label may sit in a clip that bleeds off the slide.
        const range = document.createRange();
        range.selectNodeContents(el);
        const r = range.getBoundingClientRect();
        const bleeds = el.closest(".on-film") !== null;
        if (
          !bleeds &&
          (r.left < box.left + L.edge ||
            r.right > box.right - L.edge ||
            r.bottom > box.bottom - L.edge ||
            r.top < box.top + L.edge)
        )
          out.push(`${name}: "${text}" comes within ${L.edge}px of the slide edge`);
        if (el.scrollWidth > el.clientWidth + 1 && cs.overflow !== "visible")
          out.push(`${name}: "${text}" is clipped`);
        if (el.scrollHeight > el.clientHeight + 1 && cs.overflow !== "visible")
          out.push(`${name}: "${text}" is cut off at the bottom`);
      }
      // Boxes that must hold all of their content (the notes columns) may not spill.
      slide.querySelectorAll<HTMLElement>("[data-fit]").forEach((el) => {
        if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
          out.push(
            `${name}: content spills out of its box (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`,
          );
      });
      // Rectangles of the text itself (direct text nodes), so block-level children do not count.
      const rects = leaves.flatMap((el) =>
        [...el.childNodes]
          .filter((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "")
          .flatMap((n) => {
            const range = document.createRange();
            range.selectNodeContents(n);
            return [...range.getClientRects()].map((r) => ({ el, r }));
          }),
      );
      for (let a = 0; a < rects.length; a += 1) {
        for (let b = a + 1; b < rects.length; b += 1) {
          const A = rects[a];
          const B = rects[b];
          if (A.el === B.el || A.el.contains(B.el) || B.el.contains(A.el)) continue;
          const ix = Math.min(A.r.right, B.r.right) - Math.max(A.r.left, B.r.left);
          const iy = Math.min(A.r.bottom, B.r.bottom) - Math.max(A.r.top, B.r.top);
          if (ix > 2 && iy > 4)
            out.push(
              `${name}: "${(A.el.textContent ?? "").trim().slice(0, 24)}" overlaps "${(B.el.textContent ?? "").trim().slice(0, 24)}"`,
            );
        }
      }

      // How much text the slide carries: everything visible but the page number.
      const all = textOf(slide, ".folio");
      const count = countWords(all);
      const budget = L.budgets[kind] ?? null;
      words.push({ name, words: count, budget });
      if (budget !== null && count > budget)
        out.push(`${name}: ${count} words of visible text, over ${budget}`);
      slide.querySelectorAll(".headline").forEach((h) => {
        const n = countWords(textOf(h, "sup.fn"));
        if (n > L.maxHeadline) out.push(`${name}: headline has ${n} words, over ${L.maxHeadline}`);
      });
      const prose = [...slide.querySelectorAll(".body")].reduce(
        (n, el) => n + countWords(textOf(el, "sup.fn")),
        0,
      );
      if (prose > L.maxProse) out.push(`${name}: ${prose} words of prose, over ${L.maxProse}`);
      if (!isNotes) {
        const ref = all.match(/\bslides?\s*\d+/i);
        if (ref) out.push(`${name}: refers to another slide by number ("${ref[0]}")`);
      }
    });

    // Every marker points at a note, and every note is pointed at.
    const targets = new Set(
      [...document.querySelectorAll<HTMLAnchorElement>("sup.fn a")].map((a) =>
        a.getAttribute("href"),
      ),
    );
    const ids = [...document.querySelectorAll("[id^=note-]")].map((e) => `#${e.id}`);
    for (const t of targets) if (!ids.includes(t ?? "")) out.push(`marker ${t} has no note`);
    for (const id of ids) if (!targets.has(id)) out.push(`note ${id} has no marker`);
    return { problems: out, words };
  }, limits);
}

export async function checkDeck(page: Page): Promise<CheckReport> {
  const fonts = await paintedFonts(page);
  const layout = await layoutProblems(page);
  return {
    painted: fonts.painted,
    problems: [...fonts.problems, ...layout.problems],
    words: layout.words,
  };
}
