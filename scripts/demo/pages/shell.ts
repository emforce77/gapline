/**
 * The frame every motion scene is drawn in: the deck's "Screening room" look (scripts/deck/theme.ts:
 * fonts, colour tokens, lanes, amber for Scene's words only) on a 1920×960 stage, plus the small
 * animation kit the pages' render(t) functions use. Fonts and film stills are copied next to the
 * pages once, so the pages load nothing remote.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { runFfmpeg } from "../../../src/lib/media/ffmpeg";
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
}

const STAGE_CSS = `
html, body { width:${STAGE.w}px; height:${STAGE.h}px; overflow:hidden; background:var(--screen); }
.stage { position:relative; width:${STAGE.w}px; height:${STAGE.h}px; overflow:hidden; background:var(--screen); }
.a { position:absolute; }
.src { position:absolute; right:${STAGE.margin}px; bottom:28px; font-size:22px; line-height:1.4; color:var(--ink-400); text-align:right; }
.h2 { font-family:var(--serif); font-weight:400; font-size:60px; line-height:1.1; letter-spacing:-0.012em; color:var(--ink-100); }
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
const fmt = (x, d = 2) => x.toFixed(d);
`;

export function pageHtml(p: { css: string; body: string; render: string; data: unknown }): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${BASE_CSS}${STAGE_CSS}${p.css}</style></head>
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
