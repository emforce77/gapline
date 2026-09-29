/**
 * 01. The film is the hero: Gapline's own line for this shot, set as an amber subtitle. Under it the
 * name, the tagline and what Gapline does, in one plain sentence.
 */
import { coverLine } from "../data/city";
import { CATEGORY, SUBMISSION, THEME } from "../facts";
import { esc, slide } from "../html";
import { stillUrl } from "../stills";

const PICTURE_H = 728;
/** How far above the picture's lower edge the subtitle sits, as a film sets its subtitles. */
const SUB_ABOVE_EDGE = 56;
/** The text block under the picture: name on the left, tagline and sentence on the right. */
const TEXT_TOP = PICTURE_H + 42;

export function coverSlide(): string {
  const team = SUBMISSION.team ? `${esc(SUBMISSION.team)} · ` : "";
  return slide({
    id: "s-cover",
    name: "cover",
    kind: "prose",
    filmCredit: true,
    body: `
<img class="still" src="${stillUrl("cover")}" alt="" style="left:0;top:0;width:1920px;height:${PICTURE_H}px">
<p class="sub on-film cv-sub" style="bottom:${1080 - PICTURE_H + SUB_ABOVE_EDGE}px">${esc(coverLine.text)}</p>
<h1 class="cv-name" style="top:${TEXT_TOP - 4}px">Gapline</h1>
<div class="cv-side" style="top:${TEXT_TOP}px">
  <p class="cv-theme">${team}AI Builder Cup 2026 · ${esc(THEME)} · ${esc(CATEGORY)}</p>
  <p class="cv-tag">Descriptions that fit between the lines.</p>
  <p class="cv-what">Upload a film clip and press Generate: Gapline writes, checks, voices and mixes an audio description that fits between the dialogue.</p>
</div>`,
  });
}

export const COVER_CSS = `
.cv-sub { left:310px; width:1300px; font-size:44px; line-height:1.3; }
.cv-name { position:absolute; left:var(--margin); font-family:var(--serif); font-weight:300;
  font-size:176px; line-height:1; letter-spacing:-0.03em; color:var(--ink-100); }
.cv-side { position:absolute; left:760px; width:1064px; }
.cv-theme { font-size:var(--fs-label); color:var(--ink-400); }
.cv-tag { margin-top:4px; font-family:var(--serif); font-style:italic; font-size:54px; line-height:1.1; color:var(--ink-100); }
.cv-what { margin-top:14px; max-width:1064px; font-size:var(--fs-body); line-height:1.4; color:var(--ink-300); text-wrap:pretty; }
`;
