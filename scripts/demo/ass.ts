/**
 * Subtitle (ASS) documents for each scene: the presenter's captions in the band under the picture,
 * Scene's own lines as amber subtitles over the film, and the overlays drawn over recorded UI
 * (labels, service chips, and a spotlight that dims everything but one element). The palette is the
 * deck's: ink on near-black, amber only for Scene's words.
 */
import { COLOR } from "../deck/theme";
import { CONTENT_HEIGHT, HEIGHT, WIDTH } from "./config";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AssEvent {
  start: number;
  end: number;
  style: "Say" | "Sub" | "Dlg" | "Tag" | "Chip" | "Shape";
  text: string;
  layer?: number;
}

/** Caption line limits in characters (broadcast practice: about 42 for English, fewer for Korean). */
export const CAPTION_CHARS = { en: 42, ko: 22 } as const;
const CAPTION_LINES = 2;
/** How many characters of imbalance a break after a comma, or after a full stop, is worth. */
const CLAUSE_BONUS = 15;
const SENTENCE_BONUS = 16;
/** A caption run may pass its share of the sentence by this factor, or close early at a clause end past this share. */
const EVEN_SLACK = 1.15;
const EVEN_EARLY = 0.75;
/** A number stays on the line of the word it counts. */
const NUMBER = /^[$₩]?[\d.,]+$/;
const BAND_CENTRE_Y = CONTENT_HEIGHT + (HEIGHT - CONTENT_HEIGHT) / 2;

/** #rrggbb as ASS &HBBGGRR (alpha set separately). */
const bgr = (hex: string): string => {
  const [r, g, b] = [1, 3, 5].map((i) => hex.slice(i, i + 2));
  return `&H${b}${g}${r}&`.toUpperCase();
};
const INK = bgr(COLOR.ink100);
const INK_300 = bgr(COLOR.ink300);
const AMBER = bgr(COLOR.amber);
const LANE = bgr(COLOR.lane);

const STYLE = (name: string, size: number, colour: string, box: boolean, align: number) =>
  `Style: ${name},Pretendard,${size},&H00${colour.slice(2, -1)},&H00FFFFFF,${box ? `&H10${LANE.slice(2, -1)}` : "&H00000000"},&H80000000,0,0,0,0,100,100,0,0,${box ? 3 : 1},${box ? 12 : 2},${box ? 0 : 1},${align},0,0,0,1`;

/** Plain text for an ASS line: braces and backslashes cannot start override tags. */
export const assText = (s: string): string => s.replace(/[{}\\]/g, "").replace(/\n/g, "\\N");

function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

export function assDocument(events: AssEvent[]): string {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${WIDTH}`,
    `PlayResY: ${HEIGHT}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    STYLE("Say", 38, INK, false, 5),
    STYLE("Sub", 46, AMBER, false, 2),
    STYLE("Dlg", 38, INK_300, false, 2),
    STYLE("Tag", 26, INK, true, 7),
    STYLE("Chip", 26, INK, true, 6),
    STYLE("Shape", 20, INK, false, 7),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...events
      .filter((e) => e.end > e.start)
      .map(
        (e) =>
          `Dialogue: ${e.layer ?? 0},${assTime(e.start)},${assTime(e.end)},${e.style},,0,0,0,,${e.text}`,
      ),
    "",
  ].join("\n");
}

/** Breaks a sentence into caption lines of at most `limit` characters, preferring clause ends. */
export function captionLines(text: string, limit: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > limit && line) {
      lines.push(line);
      line = word;
      continue;
    }
    line = next;
    // Close a line early at a clause end once it is reasonably full.
    if (/[,.:;?!]$/.test(word) && line.length >= limit * 0.55) {
      lines.push(line);
      line = "";
    }
  }
  if (line) lines.push(line);
  const tooLong = lines.find((l) => l.length > limit);
  if (tooLong) throw new Error(`caption word run longer than ${limit} characters: ${tooLong}`);
  return lines;
}

export interface Caption {
  start: number;
  end: number;
  lines: string[];
}

/** Splits a two-line caption where both halves are closest in length, preferring a clause end. */
function balance(text: string, limit: number): string[] {
  const words = text.split(" ");
  let best: string[] = [text];
  let score = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    if (a.length > limit || b.length > limit || NUMBER.test(words[i - 1])) continue;
    const bonus = /[.?!]$/.test(a) ? SENTENCE_BONUS : /[,:;]$/.test(a) ? CLAUSE_BONUS : 0;
    const s = Math.abs(a.length - b.length) - bonus;
    if (s < score) {
      score = s;
      best = [a, b];
    }
  }
  return best;
}

/**
 * Words split into `count` runs of about equal length, closing a run early at a clause end, so a
 * sentence of three lines becomes two captions of a line and a half instead of two lines and one.
 */
function evenRuns(text: string, count: number): string[] {
  const target = text.length / count;
  const runs: string[] = [];
  let run = "";
  let last = "";
  for (const word of text.split(" ")) {
    const next = run ? `${run} ${word}` : word;
    const full =
      next.length > target * EVEN_SLACK && run && runs.length < count - 1 && !NUMBER.test(last);
    if (full) {
      runs.push(run);
      run = word;
      continue;
    }
    run = next;
    last = word;
    if (/[,.:;?!]$/.test(word) && run.length >= target * EVEN_EARLY && runs.length < count - 1) {
      runs.push(run);
      run = "";
    }
  }
  if (run) runs.push(run);
  return runs;
}

/** One sentence as caption events of up to two lines, timed by their share of the characters. */
export function sentenceCaptions(
  text: string,
  start: number,
  end: number,
  limit: number,
): Caption[] {
  const greedy = captionLines(text, limit);
  const count = Math.ceil(greedy.length / CAPTION_LINES);
  let groups = evenRuns(text, count).map((run) =>
    run.length <= limit ? [run] : balance(run, limit),
  );
  if (groups.some((g) => g.some((line) => line.length > limit))) {
    groups = [];
    for (let i = 0; i < greedy.length; i += CAPTION_LINES)
      groups.push(greedy.slice(i, i + CAPTION_LINES));
  }
  const total = groups.reduce((n, g) => n + g.join(" ").length, 0);
  let at = start;
  return groups.map((g) => {
    const next = at + ((end - start) * g.join(" ").length) / total;
    const caption = { start: at, end: next, lines: g };
    at = next;
    return caption;
  });
}

export const sayEvent = (c: Caption): AssEvent => ({
  start: c.start,
  end: c.end,
  style: "Say",
  text: `{\\pos(${WIDTH / 2},${BAND_CENTRE_Y})}${c.lines.map(assText).join("\\N")}`,
});

/** Scene's line over the film: Korean in amber, our English gloss under it in ink. */
export const subEvent = (
  start: number,
  end: number,
  line: string,
  gloss: string,
  y: number,
): AssEvent => ({
  start,
  end,
  style: "Sub",
  text: `{\\pos(${WIDTH / 2},${y})\\b600\\fad(120,180)}${assText(line)}\\N{\\fs32\\b400\\c${INK}}${assText(gloss)}`,
});

export const dialogueEvent = (start: number, end: number, text: string, y: number): AssEvent => ({
  start,
  end,
  style: "Dlg",
  text: `{\\pos(${WIDTH / 2},${y})\\fad(100,200)}${assText(text)}`,
});

/** A small label in a box, e.g. an honest note on time the film does not show. */
export const tagEvent = (
  start: number,
  end: number,
  text: string,
  x: number,
  y: number,
): AssEvent => ({
  start,
  end,
  style: "Tag",
  layer: 3,
  text: `{\\pos(${x},${y})\\fad(200,200)}${assText(text)}`,
});

/** A service name set to the left of the element it runs, right-aligned against it. */
export const chipEvent = (
  start: number,
  end: number,
  text: string,
  x: number,
  y: number,
): AssEvent => ({
  start,
  end,
  style: "Chip",
  layer: 3,
  text: `{\\pos(${x},${y})\\fad(220,200)\\b600}${assText(text)}`,
});

/** Dims the picture area except `r`, and draws a thin ink frame around it. */
export function spotlightEvents(start: number, end: number, r: Rect, pad = 10): AssEvent[] {
  const x1 = Math.max(0, Math.round(r.x - pad));
  const y1 = Math.max(0, Math.round(r.y - pad));
  const x2 = Math.min(WIDTH, Math.round(r.x + r.w + pad));
  const y2 = Math.min(CONTENT_HEIGHT, Math.round(r.y + r.h + pad));
  const w = x2 - x1;
  const h = y2 - y1;
  return [
    {
      start,
      end,
      style: "Shape",
      layer: 1,
      text: `{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\1c&H000000&\\1a&H58&\\iclip(${x1},${y1},${x2},${y2})\\fad(250,250)}m 0 0 l ${WIDTH} 0 ${WIDTH} ${CONTENT_HEIGHT} 0 ${CONTENT_HEIGHT}{\\p0}`,
    },
    {
      start,
      end,
      style: "Shape",
      layer: 2,
      text: `{\\an7\\pos(${x1},${y1})\\p1\\1a&HFF&\\3c${INK}\\bord2.5\\shad0\\fad(250,250)}m 0 0 l ${w} 0 ${w} ${h} 0 ${h}{\\p0}`,
    },
  ];
}
