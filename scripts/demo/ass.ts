/**
 * Subtitle (ASS) documents for each scene: the film's captions in the band under the picture,
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
  /**
   * A caption's lines as whole Dialogue texts, written one Dialogue line each in place of `text`
   * (which then holds the caption's words, for reading): the pitch between them is set here, not by
   * the font's line height.
   */
  rows?: string[];
}

/** Caption line limits in characters (broadcast practice: about 42 for English, fewer for Korean). */
export const CAPTION_CHARS = { en: 42, ko: 26 } as const;
export type CaptionLanguage = keyof typeof CAPTION_CHARS;
const CAPTION_LINES = 2;
/**
 * How many characters of imbalance a break after a comma or a full stop is worth, and a break before
 * a conjunction (the second line then starts its own clause: "…the reviewer's fix / and reviews it").
 */
const CLAUSE_BONUS = 15;
const SENTENCE_BONUS = 18;
const CONJUNCTION_BONUS = 10;
const CONJUNCTION = /^(and|but|or|so|then|while|because|when)$/i;
/** A caption run may pass its share of the sentence by this factor, or close early at a clause end past this share. */
const EVEN_SLACK = 1.15;
const EVEN_EARLY = 0.75;
const CLAUSE_END = /[,.:;?!]$/;
/** A number stays on the line of the word it counts (3 months, two lines, 14 million won). */
const NUMBER =
  /^([$₩]?[\d.,]+|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion)$/i;
/**
 * Words that lead into the next one, so a line never ends with them: an English article, determiner,
 * preposition or conjunction (the, those, about, and), an English possessive (reviewer's), a Korean
 * determiner (이, 모든, 한) or a Korean genitive (씬의).
 */
const LEADS = [
  /^(a|an|the|this|that|these|those|its|our|your|their|each|every|of|to|in|on|at|by|for|from|with|into|about|against|and|or|when|if|because|while)$/i,
  /['’]s$/,
  /^(이|그|저|모든|각|첫|한|두|세|네|몇|여러)$/u,
  /\p{Script=Hangul}의$/u,
];
/** A Korean number with its counter (8가지로, 3사가) stays with the noun it counts. */
const KO_COUNTED = /^[\d.,]+\p{Script=Hangul}/u;
/**
 * Korean bound words, with a particle, that lean on the word before them (20문장 중, 장면 대신,
 * 침묵 안에서만, 상영한 것을, 옮길 수, 그중 하나에, 화면해설과 함께): a line never starts with one.
 */
const KO_BOUND =
  /^(중|대신|안|동안|전|없이|것|수|하나|함께)(에|에서|에서만|은|는|이|을|를|도|만)?[,.]?$/u;
/** Two capitalised words in a row are one name (Supreme Court, Cloud Run). */
const CAPITALISED = /^\p{Lu}/u;
/**
 * The captions carry the story, so they are set larger than a subtitle, in Pretendard SemiBold, and
 * fade rather than cut. libass sizes Pretendard by ascent plus descent, so 50 px gives a cap height
 * of about 28 px (measured). Each line is its own event, 60 px apart (1.2 of the size), and the
 * last line sits on the title-safe line: libass puts the ink's foot 2 px above an \an2 position
 * (measured), so descenders end 56 px above the frame's foot. Two lines use 920–1024 of the band
 * (880–1080); a one-line caption takes the lower line, where the eye already is.
 */
const CAPTION_PX = 50;
const CAPTION_WEIGHT = 600;
const CAPTION_PITCH = 60;
const TITLE_SAFE_PX = Math.round(HEIGHT * 0.05);
const CAPTION_FOOT_Y = HEIGHT - TITLE_SAFE_PX;
const CAPTION_FADE_MS = { in: 160, out: 120 };
if (CAPTION_FOOT_Y - CAPTION_PITCH - CAPTION_PX < CONTENT_HEIGHT)
  throw new Error("two caption lines no longer fit the band under the picture");

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
    STYLE("Say", CAPTION_PX, INK, false, 5),
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
      .flatMap((e) =>
        (e.rows ?? [e.text]).map(
          (text) =>
            `Dialogue: ${e.layer ?? 0},${assTime(e.start)},${assTime(e.end)},${e.style},,0,0,0,,${text}`,
        ),
      ),
    "",
  ].join("\n");
}

/** Whether a caption line may end with `before` and the next start with `after`. */
function breakable(before: string, after: string): boolean {
  if (NUMBER.test(before) || LEADS.some((r) => r.test(before)) || KO_BOUND.test(after))
    return false;
  if (CLAUSE_END.test(before)) return true;
  return !KO_COUNTED.test(after) && !(CAPITALISED.test(before) && CAPITALISED.test(after));
}

/**
 * A sentence as the pieces a line may break between: words, with a name, a counted number or a
 * Korean bound word kept on the word it belongs to. Only a plain space separates words, so a
 * no-break space in the storyboard holds too.
 */
function chunksOf(text: string): string[] {
  const words = text.split(/ +/);
  const chunks = [words[0]];
  for (let i = 1; i < words.length; i++) {
    if (breakable(words[i - 1], words[i])) chunks.push(words[i]);
    else chunks[chunks.length - 1] += ` ${words[i]}`;
  }
  return chunks;
}

/** Breaks a sentence into caption lines of at most `limit` characters, preferring clause ends. */
export function captionLines(text: string, limit: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const chunk of chunksOf(text)) {
    const next = line ? `${line} ${chunk}` : chunk;
    if (next.length > limit && line) {
      lines.push(line);
      line = chunk;
      continue;
    }
    line = next;
    // Close a line early at a clause end once it is reasonably full.
    if (CLAUSE_END.test(chunk) && line.length >= limit * 0.55) {
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
  const chunks = chunksOf(text);
  let best: string[] = [text];
  let score = Infinity;
  for (let i = 1; i < chunks.length; i++) {
    const a = chunks.slice(0, i).join(" ");
    const b = chunks.slice(i).join(" ");
    if (a.length > limit || b.length > limit) continue;
    const bonus = /[.?!]$/.test(a)
      ? SENTENCE_BONUS
      : /[,:;]$/.test(a)
        ? CLAUSE_BONUS
        : CONJUNCTION.test(chunks[i].split(" ")[0])
          ? CONJUNCTION_BONUS
          : 0;
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
 * A clause end that still fits on two lines closes the run even past its even share: the caption
 * changes after "silences," rather than before it.
 */
function evenRuns(text: string, count: number, limit: number): string[] {
  const target = text.length / count;
  const runs: string[] = [];
  let run = "";
  for (const chunk of chunksOf(text)) {
    const next = run ? `${run} ${chunk}` : chunk;
    const open = runs.length < count - 1;
    if (
      open &&
      CLAUSE_END.test(chunk) &&
      next.length >= target * EVEN_EARLY &&
      next.length <= limit * CAPTION_LINES
    ) {
      runs.push(next);
      run = "";
      continue;
    }
    if (open && run && next.length > target * EVEN_SLACK) {
      runs.push(run);
      run = chunk;
      continue;
    }
    run = next;
  }
  if (run) runs.push(run);
  return runs;
}

/** Caption groups set by hand for one sentence, checked against its text and the line limits. */
function givenGroups(text: string, limit: number, groups: string[][]): string[][] {
  if (groups.map((g) => g.join(" ")).join(" ") !== text)
    throw new Error(`caption groups do not read as the sentence: ${text}`);
  const bad = groups.find((g) => g.length > CAPTION_LINES || g.some((l) => l.length > limit));
  if (bad) throw new Error(`caption group over ${CAPTION_LINES}×${limit}: ${bad.join(" / ")}`);
  return groups;
}

/**
 * One sentence as captions of up to two lines each, split where the break rules find the natural
 * seams; `given` sets the groups instead.
 */
export function captionGroups(text: string, lang: CaptionLanguage, given?: string[][]): string[][] {
  const limit = CAPTION_CHARS[lang];
  if (given) return givenGroups(text, limit, given);
  // One caption when the sentence splits into two lines that both fit.
  if (text.length <= limit) return [[text]];
  const pair = balance(text, limit);
  if (pair.length === CAPTION_LINES) return [pair];
  const greedy = captionLines(text, limit);
  const count = Math.ceil(greedy.length / CAPTION_LINES);
  const groups = evenRuns(text, count, limit).map((run) =>
    run.length <= limit ? [run] : balance(run, limit),
  );
  if (!groups.some((g) => g.some((line) => line.length > limit))) return groups;
  const fallback: string[][] = [];
  for (let i = 0; i < greedy.length; i += CAPTION_LINES)
    fallback.push(greedy.slice(i, i + CAPTION_LINES));
  return fallback;
}

/** A caption in the band: its lines stacked up from the title-safe line, fading together. */
export const sayEvent = (c: Caption): AssEvent => ({
  start: c.start,
  end: c.end,
  style: "Say",
  text: c.lines.join("\n"),
  rows: c.lines.map((line, i) => {
    const y = CAPTION_FOOT_Y - (c.lines.length - 1 - i) * CAPTION_PITCH;
    return `{\\an2\\pos(${WIDTH / 2},${y})\\b${CAPTION_WEIGHT}\\fad(${CAPTION_FADE_MS.in},${CAPTION_FADE_MS.out})}${assText(line)}`;
  }),
});

/**
 * Scene's line over the film: Korean in amber, our English gloss under it in ink. An empty gloss
 * (the Korean film) writes no second line, so the line sits on `y` itself.
 */
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
  text: `{\\pos(${WIDTH / 2},${y})\\b600\\fad(120,180)}${assText(line)}${gloss ? `\\N{\\fs32\\b400\\c${INK}}${assText(gloss)}` : ""}`,
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
