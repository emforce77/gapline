/**
 * 01. The film is the hero: Scene's own line for this shot, set as an amber subtitle. Under it the
 * name, the tagline and what Scene does, in one plain sentence. The line's source and its measured fit
 * go to the notes.
 */
import { coverLine } from "../data/city";
import { CATEGORY, FILM_CREDIT, SUBMISSION, THEME } from "../facts";
import { esc, secs, slide } from "../html";
import { notesFor } from "../notes";
import { stillUrl } from "../stills";

const PICTURE_H = 760;
/** How far above the picture's lower edge the subtitle sits, as a film sets its subtitles. */
const SUB_ABOVE_EDGE = 56;
/** The text block under the picture: name on the left, tagline and sentence on the right. */
const TEXT_TOP = PICTURE_H + 42;

export function coverSlide(): string {
  const note = notesFor("Cover");
  const team = SUBMISSION.team ? `${esc(SUBMISSION.team)} · ` : "";
  const lineNote = note(
    `The amber line is Scene’s own for this shot: an English run on the city sequence (film 65–110 s), default reviewer, 22 Sep 2026. It was voiced in ${secs(coverLine.voiced)} of the ${secs(coverLine.room)} before Scene’s next line, read at ${coverLine.rate}× normal speed. Stills are cut from the Blender Foundation’s 1080p master. ${esc(FILM_CREDIT)}.`,
  );
  return slide({
    id: "s-cover",
    name: "cover",
    kind: "prose",
    filmCredit: true,
    body: `
<img class="still" src="${stillUrl("cover")}" alt="" style="left:0;top:0;width:1920px;height:${PICTURE_H}px">
<p class="sub on-film cv-sub" style="bottom:${1080 - PICTURE_H + SUB_ABOVE_EDGE}px">${esc(coverLine.text)}${lineNote}</p>
<h1 class="cv-name" style="top:${TEXT_TOP - 4}px">Scene</h1>
<div class="cv-side" style="top:${TEXT_TOP}px">
  <p class="cv-theme">${team}AI Builder Cup 2026 · ${esc(THEME)} · ${esc(CATEGORY)}</p>
  <p class="cv-tag">Descriptions that fit between the lines.</p>
  <p class="cv-what">Upload a film clip and press Generate: Scene writes, checks, voices and mixes the audio description by itself. You can still change any line.</p>
</div>`,
  });
}

export const COVER_CSS = `
.cv-sub { left:310px; width:1300px; font-size:44px; line-height:1.3; }
.cv-sub sup.fn a { color:var(--ink-100); }
.cv-name { position:absolute; left:var(--margin); font-family:var(--serif); font-weight:300;
  font-size:176px; line-height:1; letter-spacing:-0.03em; color:var(--ink-100); }
.cv-side { position:absolute; left:640px; width:1184px; }
.cv-theme { font-size:var(--fs-label); color:var(--ink-400); }
.cv-tag { margin-top:4px; font-family:var(--serif); font-style:italic; font-size:54px; line-height:1.1; color:var(--ink-100); }
.cv-what { margin-top:14px; max-width:1100px; font-size:var(--fs-body); line-height:1.4; color:var(--ink-300); text-wrap:pretty; }
`;
