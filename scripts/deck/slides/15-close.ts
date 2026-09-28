/**
 * 15. Close, with the eyes closed: no picture, only what a blind viewer hears around the seven seconds
 * of the opening, with the tagline set where Gapline's lines go, between "…locked." and "This is pretty
 * freaky."; then the invitation, the submission links (each shown once it is set in facts.ts) and the
 * credits.
 */
import { seven } from "../data/sample";
import { CATEGORY, SUBMISSION, THEME } from "../facts";
import { esc, secs, slide } from "../html";

const SUBS_TOP = 266;
const LINKS_TOP = 664;
/** The invitation sits this far above the links. */
const TRY_ABOVE_LINKS = 72;
const TAGLINE = "Descriptions that fit between the lines.";

function link(label: string, url: string): string {
  return `<p class="cz-link"><span class="cz-label">${esc(label)}</span><span class="cz-url"><a href="${esc(url)}">${esc(url)}</a></span></p>`;
}

export function closeSlide(): string {
  const links = [
    SUBMISSION.demoUrl ? link("Demo", SUBMISSION.demoUrl) : "",
    SUBMISSION.repoUrl ? link("Code", SUBMISSION.repoUrl) : "",
    SUBMISSION.videoUrl ? link("Video", SUBMISSION.videoUrl) : "",
  ].join("");
  const team = SUBMISSION.team ? `Made by ${esc(SUBMISSION.team)} · ` : "";
  return slide({
    id: "s-close",
    name: "close",
    kind: "prose",
    body: `
<div class="cz-subs" style="top:${SUBS_TOP}px">
  <p class="cz-dlg">“…${esc(seven.locked.text)}”<span class="mono">${secs(seven.locked.end, 1)}</span></p>
  <p class="cz-tag">${TAGLINE}</p>
  <p class="cz-dlg">“${esc(seven.freaky.text)}”<span class="mono">${secs(seven.freaky.start, 1)}</span></p>
</div>
<p class="cz-try" style="top:${LINKS_TOP - TRY_ABOVE_LINKS}px">Hear the sample with your eyes closed.</p>
<div class="cz-links" style="top:${LINKS_TOP}px">${links}</div>
<p class="cz-credit">${team}AI Builder Cup 2026 · ${esc(THEME)} · ${esc(CATEGORY)}</p>`,
  });
}

export const CLOSE_CSS = `
.cz-subs { position:absolute; left:0; width:1920px; text-align:center; }
.cz-dlg { font-size:36px; font-weight:500; color:var(--ink-300); }
.cz-dlg .mono { margin-left:18px; font-size:var(--fs-label); font-weight:400; color:var(--ink-400); }
.cz-tag { margin:26px 0; font-family:var(--serif); font-style:italic; font-size:84px; line-height:1.1; color:var(--amber); letter-spacing:-0.01em; }
.cz-try { position:absolute; left:0; width:1920px; text-align:center; font-size:var(--fs-body); color:var(--ink-100); }
.cz-links { position:absolute; left:0; width:1920px; display:flex; flex-direction:column; align-items:center; gap:14px; }
.cz-link { display:flex; align-items:baseline; gap:20px; }
.cz-label { font-size:var(--fs-label); font-weight:600; color:var(--ink-400); }
.cz-url > a { font-size:40px; font-weight:500; color:var(--ink-100); text-decoration:underline; text-decoration-color:var(--tick);
  text-decoration-thickness:2px; text-underline-offset:8px; }
.cz-credit { position:absolute; left:0; bottom:48px; width:1920px; text-align:center; font-size:var(--fs-label); line-height:1.45; color:var(--ink-400); }
`;
