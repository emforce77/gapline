/**
 * Direction A, "Screening room": a near-black room where the film is the only light. One accent, the
 * product's amber (src/styles/tokens.css), and it only ever means "words Scene adds to the film".
 * Rejections are ink: a strike and a labelled mark, never a second hue.
 */

export const W = 1920;
export const H = 1080;
export const MARGIN = 96;
/** No text on any slide is set smaller than this (checked by the build). */
export const MIN_TEXT_PX = 22;
/** Grey text (the two lighter inks) needs more size to read from the back of a room. */
export const MIN_GREY_PX = 24;
/** Film credits, note markers and the notes page may go down to this, never below. */
export const MIN_SMALL_PX = 18;

export const COLOR = {
  screen: "#09090a",
  lane: "#141416",
  rule: "#2b2c30",
  tick: "#4a4d53",
  ink400: "#80848b",
  ink300: "#a9acb2",
  ink100: "#ece9e3",
  dialogue: "#676d75",
  amber: "#f1b54b",
  amberRoom: "rgba(241, 181, 75, 0.42)",
  amberInk: "#1b1406",
} as const;

/** Font files are copied next to the HTML by the build (assets/fonts). All static cuts. */
export const FONT_FILES = {
  vendored: [
    "Newsreader72pt-Regular.ttf",
    "Newsreader72pt-Light.ttf",
    "Newsreader72pt-Italic.ttf",
    "IBMPlexMono-Regular.ttf",
    "IBMPlexMono-Medium.ttf",
  ],
  pretendard: ["Pretendard-Regular.woff2", "Pretendard-Medium.woff2", "Pretendard-SemiBold.woff2"],
} as const;

const face = (family: string, file: string, weight: number, style = "normal") => `
@font-face { font-family: "${family}"; src: url("assets/fonts/${file}"); font-weight: ${weight};
  font-style: ${style}; font-display: block; }`;

const FONT_FACES = [
  face("Newsreader", "Newsreader72pt-Regular.ttf", 400),
  face("Newsreader", "Newsreader72pt-Light.ttf", 300),
  face("Newsreader", "Newsreader72pt-Italic.ttf", 400, "italic"),
  face("IBM Plex Mono", "IBMPlexMono-Regular.ttf", 400),
  face("IBM Plex Mono", "IBMPlexMono-Medium.ttf", 500),
  face("Pretendard", "Pretendard-Regular.woff2", 400),
  face("Pretendard", "Pretendard-Medium.woff2", 500),
  face("Pretendard", "Pretendard-SemiBold.woff2", 600),
].join("");

export const BASE_CSS = `${FONT_FACES}
:root {
  --screen: ${COLOR.screen}; --lane: ${COLOR.lane}; --rule: ${COLOR.rule}; --tick: ${COLOR.tick};
  --ink-400: ${COLOR.ink400}; --ink-300: ${COLOR.ink300}; --ink-100: ${COLOR.ink100};
  --dialogue: ${COLOR.dialogue}; --amber: ${COLOR.amber}; --amber-room: ${COLOR.amberRoom};
  --amber-ink: ${COLOR.amberInk};
  --serif: "Newsreader", serif;
  --sans: "Pretendard", "Apple SD Gothic Neo", "Noto Sans KR", sans-serif;
  --mono: "IBM Plex Mono", monospace;
  --margin: ${MARGIN}px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: var(--screen); }
body { font-family: var(--sans); color: var(--ink-100); -webkit-font-smoothing: antialiased; }
@page { size: ${W}px ${H}px; margin: 0; }
.slide { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: var(--screen);
  break-after: page; }

.headline { font-family: var(--serif); font-weight: 400; font-size: 72px; line-height: 1.08;
  letter-spacing: -0.012em; color: var(--ink-100); text-wrap: balance; }
.body { font-size: 30px; line-height: 1.5; color: var(--ink-300); text-wrap: pretty; }
.body q, .headline q { quotes: "\\201C" "\\201D"; }
.body b { font-weight: 500; color: var(--ink-100); }
.label { font-size: 24px; line-height: 1.3; font-weight: 600; color: var(--ink-300); }
.muted { color: var(--ink-400); }
.mono { font-family: var(--mono); font-variant-numeric: tabular-nums; }
.num { font-family: var(--serif); font-variant-numeric: lining-nums tabular-nums; letter-spacing: -0.01em; }
.amber { color: var(--amber); }
[lang=ko] { word-break: keep-all; }
.folio { position: absolute; left: var(--margin); bottom: 36px; font-family: var(--mono); font-size: 24px;
  color: var(--ink-400); }
/* The film's licence travels with every frame the deck shows, small. */
.credit { position: absolute; right: var(--margin); bottom: 40px; font-size: 18px; line-height: 1.3;
  color: var(--ink-400); }
/* Endnote markers: small, grey, linked to the notes page. */
sup.fn { font-family: var(--sans); font-size: 18px; font-weight: 500; line-height: 0; vertical-align: super;
  margin-left: 2px; letter-spacing: 0; font-style: normal; }
sup.fn a { color: var(--ink-400); text-decoration: none; }
/* A source named on the slide itself, when the number is the slide's point. */
.tag { font-size: 24px; line-height: 1.3; color: var(--ink-300); }

.intro { position: absolute; left: var(--margin); top: 76px; width: ${W - 2 * MARGIN}px; }
.intro .headline { max-width: 1240px; }
.intro.split { display: flex; align-items: flex-end; justify-content: space-between; gap: 80px; }
.intro.split .headline { flex: 0 1 1020px; }
.intro.split .body { flex: 0 1 620px; padding-bottom: 8px; }

/* Subtitles: amber is description, set the way a film subtitles its dialogue. */
.sub { position: absolute; text-align: center; font-weight: 600; color: var(--amber); letter-spacing: -0.005em;
  text-shadow: 0 0 2px rgba(0,0,0,.95), 0 1px 3px rgba(0,0,0,.9), 0 2px 14px rgba(0,0,0,.7); text-wrap: balance; }
.sub .gloss { display: block; margin-top: 6px; font-weight: 400; color: var(--ink-100); }
.still { position: absolute; display: block; object-fit: cover; }

.lane { position: absolute; background: var(--lane); }
.clip { position: absolute; top: 0; height: 100%; border-radius: 3px; overflow: hidden; white-space: nowrap; }
.clip.dialogue { background: var(--dialogue); }
.clip.ad { background: var(--amber); color: var(--amber-ink); }
.room { position: absolute; top: 0; height: 100%; border: 2px solid var(--amber-room); border-radius: 3px; }

/* A rejection: ink strike and an x mark with its label, never colour alone. */
del.strike { text-decoration: line-through; text-decoration-thickness: 3px; text-decoration-color: var(--ink-100); }
.changed { text-decoration: underline; text-decoration-color: var(--amber); text-decoration-thickness: 3px;
  text-underline-offset: 7px; }
.verdict { display: flex; align-items: center; gap: 12px; font-size: 24px; font-weight: 600; color: var(--ink-100); }
.verdict svg { flex: none; }
`;
