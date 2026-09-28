/**
 * The frame every motion scene is drawn in: the deck's "Screening room" look (scripts/deck/theme.ts:
 * fonts, colour tokens, lanes, amber for Gapline's words only) on the 1920×880 picture area above the
 * caption band, plus the small animation kit the pages' render(t) functions use. Every word a page
 * draws follows the film's language (`lang`); product names, the URL, the film's credit and its own
 * dialogue stay in English. Fonts and film stills are copied next to the pages once, so the pages
 * load nothing remote.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runFfmpeg } from "../../../src/lib/media/ffmpeg";
import type { Language } from "../../../src/lib/pipeline/schemas";
import { PRETENDARD_STATIC, VENDORED_FONTS } from "../../deck/paths";
import { BASE_CSS, FONT_FILES } from "../../deck/theme";
import { CLIP_FILE, CONTENT_HEIGHT, PAGES_DIR, WIDTH } from "../config";

export const STAGE = { w: WIDTH, h: CONTENT_HEIGHT, margin: 96 };

/** What a page's render(t) knows: scene length, sentence starts and lengths, and page data. */
export interface PageTiming {
  T: number;
  S: number[];
  L: number[];
  /** Start of the film sound in the scene, when there is one. */
  film?: number;
  /** The film's language: every word the page draws follows it. */
  lang: Language;
}

/**
 * A footnote is one line of about 90 characters at 24 px, the smallest text a page draws: at a
 * 1280-wide player it still shows at 16 px.
 */
const NOTE_PX = 24;
const NOTE_MAX_CHARS = 96;

/** A page's words in the film's language. */
export const pick = <T>(lang: Language, words: Record<Language, T>): T => words[lang];

/** Seconds as the pages print them: one decimal, as the captions say them ("2.1 s", "2.1초"). */
export const secs = (x: number, lang: Language): string =>
  lang === "ko" ? `${x.toFixed(1)}초` : `${x.toFixed(1)} s`;

/** A footnote (HTML), checked to stay short enough for one line. */
export function note(html: string): string {
  const visible = html.replace(/<[^>]+>/g, "");
  if (visible.length > NOTE_MAX_CHARS)
    throw new Error(`footnote over ${NOTE_MAX_CHARS} characters (${visible.length}): ${visible}`);
  return `<p class="src">${html}</p>`;
}

const STAGE_CSS = `
html, body { width:${STAGE.w}px; height:${STAGE.h}px; overflow:hidden; background:var(--screen); }
.stage { position:relative; width:${STAGE.w}px; height:${STAGE.h}px; overflow:hidden; background:var(--screen); }
.a { position:absolute; }
.src { position:absolute; right:${STAGE.margin}px; bottom:30px; font-size:${NOTE_PX}px; line-height:1.3; color:var(--ink-400); text-align:right; white-space:nowrap; }
.h2 { font-family:var(--serif); font-weight:400; font-size:60px; line-height:1.1; letter-spacing:-0.012em; color:var(--ink-100); }
/* The serif and the mono have no Hangul: Korean glyphs fall back to Pretendard, never a system face. */
html[lang=ko] { --serif:"Newsreader", "Pretendard", serif; --mono:"IBM Plex Mono", "Pretendard", monospace; }
html[lang=ko] .h2 { font-family:var(--sans); font-weight:600; font-size:54px; letter-spacing:-0.01em; }
`;

/** Easing and reveal helpers, available to every page's render(t). */
const KIT = `
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
const prog = (t, at, dur = 0.6) => ease((t - at) / dur);
const lin = (t, at, dur) => clamp((t - at) / dur);
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
function reveal(el, p, dy = 18) { el.style.opacity = p; el.style.transform = 'translateY(' + ((1 - p) * dy) + 'px)'; }
function fadeOut(el, p) { el.style.opacity = 1 - p; }
const fmt = (x, d = 1) => x.toFixed(d);
`;

export function pageHtml(p: {
  lang: Language;
  css: string;
  body: string;
  render: string;
  data: unknown;
}): string {
  return `<!doctype html><html lang="${p.lang}"><head><meta charset="utf-8"><style>${BASE_CSS}${STAGE_CSS}${p.css}</style></head>
<body><div class="stage">${p.body}</div>
<script>window.D = ${JSON.stringify(p.data)};${KIT}
window.render = function (t) { const D = window.D; ${p.render} };
window.render(0);
</script></body></html>`;
}

/** Copies the deck's font files next to the pages (assets/fonts, where BASE_CSS looks). */
async function copyFonts(): Promise<void> {
  const dir = join(PAGES_DIR, "assets/fonts");
  await mkdir(dir, { recursive: true });
  for (const f of FONT_FILES.vendored) await copyFile(join(VENDORED_FONTS, f), join(dir, f));
  for (const f of FONT_FILES.pretendard) await copyFile(join(PRETENDARD_STATIC, f), join(dir, f));
}

/**
 * A still at a film second, cut once into assets/stills: from the sample clip, or from another file
 * that starts at film second `source.from` (the 1080p master cut of the hook).
 */
export async function still(
  name: string,
  filmSeconds: number,
  width: number,
  source: { file: string; from: number } = { file: CLIP_FILE, from: 0 },
): Promise<string> {
  const rel = `assets/stills/${name}-${filmSeconds.toFixed(2)}.jpg`;
  const file = join(PAGES_DIR, rel);
  if (existsSync(file)) return rel;
  await mkdir(join(PAGES_DIR, "assets/stills"), { recursive: true });
  await runFfmpeg([
    "-v",
    "error",
    "-ss",
    (filmSeconds - source.from).toFixed(3),
    "-i",
    source.file,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    "-vf",
    `scale=${width}:-2:flags=lanczos`,
    "-y",
    file,
  ]);
  return rel;
}

export async function preparePageAssets(): Promise<void> {
  await copyFonts();
}

export const esc = (s: string | number): string =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
