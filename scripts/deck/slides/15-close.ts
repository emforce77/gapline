/**
 * 15. Close, with the eyes closed: no picture, only what a blind viewer hears around the seven seconds
 * of the opening, with the tagline set where Scene's lines go, between "…locked." and "This is pretty
 * freaky."; then the invitation, the links (the live URL is clickable in the PDF) and the credits.
 */
import { liveCheck } from "../data/live-check";
import { seven } from "../data/sample";
import { CATEGORY, SUBMISSION, THEME } from "../facts";
import { dayMonthYear, esc, secs, slide } from "../html";
import { notesFor } from "../notes";

const SUBS_TOP = 266;
const LINKS_TOP = 664;
/** The invitation sits this far above the links. */
const TRY_ABOVE_LINKS = 72;
const TAGLINE = "Descriptions that fit between the lines.";

function link(label: string, url: string, marker = ""): string {
  return `<p class="cz-link"><span class="cz-label">${esc(label)}</span><span class="cz-url"><a href="${esc(url)}">${esc(url)}</a>${marker}</span></p>`;
}

export function closeSlide(): string {
  const note = notesFor("Close");
  const live = new URL(liveCheck.service);
  if (live.protocol !== "https:") throw new Error(`the live URL is not https: ${live.href}`);
  const liveNote = note(
    `Google Cloud Run, Seoul region (asia-northeast3); last checked on the live service ${dayMonthYear(liveCheck.day.toISOString().slice(0, 10))}, revision ${esc(liveCheck.revision)}.`,
  );
  const links = [
    link("Live", live.origin, liveNote),
    SUBMISSION.repoUrl ? link("Code", SUBMISSION.repoUrl) : "",
    SUBMISSION.videoUrl ? link("Video", SUBMISSION.videoUrl) : "",
  ].join("");
  const team = SUBMISSION.team ? `Made by ${esc(SUBMISSION.team)} · ` : "";
  const credits = note(
    "Type: Newsreader, IBM Plex Mono and Pretendard, under the SIL Open Font License.",
  );
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
<p class="cz-try" style="top:${LINKS_TOP - TRY_ABOVE_LINKS}px">Upload a clip, press Generate, and listen with your eyes closed.</p>
<div class="cz-links" style="top:${LINKS_TOP}px">${links}</div>
<p class="cz-credit">${team}AI Builder Cup 2026 · ${esc(THEME)} · ${esc(CATEGORY)}${credits}</p>`,
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
