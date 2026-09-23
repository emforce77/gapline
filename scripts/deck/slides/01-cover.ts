/** 01. The film is the hero: Scene's own line for this shot, set as an amber subtitle. */
import { coverLine } from "../data/city";
import { CATEGORY, FILM_CREDIT, SUBMISSION, THEME } from "../facts";
import { bullet, esc, secs, slide } from "../html";
import { notesFor } from "../notes";
import { stillUrl } from "../stills";

const PICTURE_H = 800;

export function coverSlide(): string {
  const note = notesFor(null, "Cover");
  const team = SUBMISSION.team ? `${esc(SUBMISSION.team)} · ` : "";
  return slide({
    id: "s-cover",
    name: "cover",
    folio: null,
    kind: "prose",
    filmCredit: true,
    body: `
<img class="still" src="${stillUrl("cover")}" alt="" style="left:0;top:0;width:1920px;height:${PICTURE_H}px">
<p class="sub on-film" style="left:310px;width:1300px;bottom:${1080 - PICTURE_H + 56}px;font-size:44px;line-height:1.3">${esc(coverLine.text)}</p>
<h1 class="cv-name">Scene</h1>
<div class="cv-side">
  <p class="cv-theme">${team}AI Builder Cup 2026 · ${esc(THEME)} · ${esc(CATEGORY)}</p>
  <p class="cv-tag">Descriptions that fit between the lines.</p>
  <p class="cv-note">Scene wrote, checked and voiced the amber line for this shot:
    <span class="cv-fit">${bullet(coverLine.voiced, coverLine.room, 150, 18)}
    <span class="amber">${secs(coverLine.voiced)}</span>, in the ${secs(coverLine.room)} before its next line${note(
      `Scene’s own line: English run on the city sequence (film 65–110 s), default reviewer, 22 Sep 2026, voiced at ${coverLine.rate}× speed. The sequence has almost no dialogue, so this line’s room ends where Scene’s next line starts. Stills are cut from the Blender Foundation’s 1080p master. ${esc(FILM_CREDIT)}.`,
    )}</span></p>
</div>`,
  });
}

export const COVER_CSS = `
.cv-name { position:absolute; left:var(--margin); top:842px; font-family:var(--serif); font-weight:300;
  font-size:176px; line-height:1; letter-spacing:-0.03em; color:var(--ink-100); }
.cv-side { position:absolute; left:640px; top:846px; width:1184px; }
.cv-theme { font-size:24px; color:var(--ink-400); }
.cv-tag { margin-top:6px; font-family:var(--serif); font-style:italic; font-size:54px; line-height:1.1; color:var(--ink-100); }
.cv-note { margin-top:16px; font-size:24px; line-height:1.4; color:var(--ink-300); font-variant-numeric:tabular-nums; }
.cv-fit { white-space:nowrap; margin-left:6px; }
.cv-fit > span:first-child { margin-right:10px; }
`;
