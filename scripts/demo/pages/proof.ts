/**
 * "evidence": what the evaluation runs and the sample measured. "close": the tagline set between the
 * two lines of dialogue from the hook, and the live URL.
 */
import { SUBMISSION } from "../../deck/facts";
import { dayLabel, film, minutesSeconds } from "../facts";
import { esc, pageHtml, STAGE, type PageTiming } from "./shell";

const M = STAGE.margin;

export function evidencePage(timing: PageTiming): string {
  const l = film.loops;
  const o = film.original;
  const f = film.finalFix;
  const bars = (on: number, all: number) =>
    Array.from({ length: all }, (_, i) => `<i class="${i < on ? "on" : "off"}"></i>`).join("");
  const fixed = f ? f.rewritten + f.added : 0;
  const dropped = film.notes.dropped;
  const facts = [
    `<b>$${o.costUsd.toFixed(2)}</b> in API fees`,
    `<b>${minutesSeconds(o.seconds, "en")}</b> end to end`,
    `<b>${fixed}</b> ${fixed === 1 ? "line" : "lines"} fixed by Scene after the final check`,
    ...(dropped
      ? [`<b>${dropped}</b> ${dropped === 1 ? "line" : "lines"} dropped after two rewrites`]
      : []),
    "<b>0</b> edits",
  ]
    .map((x) => `<li>${x}</li>`)
    .join("");
  const css = `
#ev-head { left:${M}px; top:64px; opacity:0; }
.ev-col { top:230px; width:790px; opacity:0; }
.ev-big { font-family:var(--serif); font-size:120px; line-height:1; color:var(--ink-100); }
.ev-col p.body { margin-top:18px; font-size:30px; line-height:1.45; color:var(--ink-300); }
.ev-bars { display:flex; gap:8px; margin-top:34px; }
.ev-bars i { display:block; width:30px; height:44px; border-radius:3px; border:2px solid var(--amber-room); }
.ev-bars i.on.lit { background:var(--amber); border-color:var(--amber); }
.ev-bars i.off.lit { border-color:var(--ink-400); border-style:dashed; }
.ev-facts { list-style:none; margin-top:30px; display:grid; gap:12px; }
.ev-facts li { font-size:26px; color:var(--ink-300); opacity:0; }
.ev-facts b { font-weight:600; color:var(--ink-100); }
.src { left:${M}px; }`;
  const body = `
<h2 class="a h2" id="ev-head">Measured on the runs themselves.</h2>
<div class="a ev-col" id="ev-a" style="left:${M}px">
  <p class="ev-big">${l.voiced} of ${l.written}</p>
  <p class="body">lines made it into the finished tracks in ${l.runs} test runs on openly licensed clips, none over the recognized speech.</p>
  <div class="ev-bars" id="ev-bars-a">${bars(l.voiced, l.written)}</div>
</div>
<div class="a ev-col" id="ev-b" style="left:1020px">
  <p class="ev-big">${o.lines} of ${o.lines}</p>
  <p class="body">lines of the sample landed inside their silence, in one automatic run:</p>
  <ul class="ev-facts">${facts}</ul>
</div>
<p class="src">Test runs of ${esc(dayLabel(film.evaluatedAt))} with the default reviewer, before the final check could fix what it found. Sample run of ${esc(dayLabel(o.day))}${o.analysisReused ? ", with hearing and watching reused from an earlier run of the same clip (their time and fees not included)" : ""}. API fees only, infrastructure not included.</p>`;
  const render = `
const S = D.S, L = D.L;
reveal($('#ev-head'), prog(t, 0, 0.7));
reveal($('#ev-a'), prog(t, S[0], 0.6));
const n = Math.floor(lin(t, S[0] + 0.6, Math.max(1.5, L[0] - 1.2)) * ${l.written} + 0.001);
$$('#ev-bars-a i').forEach((el, i) => el.classList.toggle('lit', i < n));
reveal($('#ev-b'), prog(t, S[1], 0.6));
const facts = $$('.ev-facts li');
facts.forEach((el, i) => reveal(el, prog(t, S[1] + 0.8 + i * ((L[1] - 0.6) / facts.length), 0.4), 8));`;
  return pageHtml({ css, body, render, data: timing });
}

const TAGLINE = "Descriptions that fit between the lines.";

export function closePage(timing: PageTiming): string {
  const h = film.hook;
  const url = new URL(film.service);
  const css = `
.cz { left:0; width:${STAGE.w}px; text-align:center; opacity:0; }
.cz-dlg { font-size:36px; font-weight:500; color:var(--ink-300); }
#cz-tag { top:300px; font-family:var(--serif); font-style:italic; font-size:92px; line-height:1.1; color:var(--amber); letter-spacing:-0.01em; }
#cz-try { top:570px; font-size:32px; color:var(--ink-300); }
#cz-url { top:630px; font-size:42px; font-weight:500; color:var(--ink-100); text-decoration:underline; text-decoration-color:var(--tick); text-underline-offset:10px; }
#cz-repo { top:700px; font-size:28px; color:var(--ink-300); }
#cz-credit { top:820px; font-size:22px; line-height:1.5; color:var(--ink-400); }`;
  const body = `
<p class="a cz cz-dlg" style="top:220px">…${esc(h.locked.text)}</p>
<p class="a cz" id="cz-tag">${TAGLINE.split(" ")
    .map((w) => `<span>${esc(w)}</span>`)
    .join(" ")}</p>
<p class="a cz cz-dlg" style="top:440px">${esc(h.freaky.text)}</p>
<p class="a cz" id="cz-try">Try the sample with your eyes closed.</p>
<p class="a cz" id="cz-url">${esc(url.host)}</p>
${SUBMISSION.repoUrl ? `<p class="a cz" id="cz-repo">Code: ${esc(SUBMISSION.repoUrl.replace(/^https:\/\//, ""))}</p>` : ""}
<p class="a cz" id="cz-credit">AI Builder Cup 2026 · theme: ${esc(film.theme)} · category: ${esc(film.category)}<br>${esc(film.credit)}</p>`;
  const render = `
const S = D.S;
$$('.cz-dlg').forEach((el) => { el.style.opacity = prog(t, 0, 0.6); });
$('#cz-tag').style.opacity = 1;
const words = $$('#cz-tag span');
words.forEach((el, i) => { el.style.opacity = prog(t, S[0] + i * (D.L[0] * 0.8 / words.length), 0.5); });
reveal($('#cz-try'), prog(t, S[1], 0.6));
reveal($('#cz-url'), prog(t, S[1] + 0.4, 0.6));
if ($('#cz-repo')) reveal($('#cz-repo'), prog(t, S[1] + 0.9, 0.6));
reveal($('#cz-credit'), prog(t, S[1] + 2.2, 0.8), 6);`;
  return pageHtml({ css, body, render, data: timing });
}
