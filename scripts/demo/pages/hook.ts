/**
 * The hook's two drawn scenes. "dark": "Close your eyes." on a black screen, then the film's own sound
 * with its dialogue shown and a line that measures the silence as it passes. "seven": the same seconds drawn to
 * scale (deck slide 2), with Scene's two lines growing to their measured length inside their room.
 */
import { gloss } from "../../deck/glosses";
import { film } from "../facts";
import { masterCut } from "../master";
import { esc, pageHtml, STAGE, still, type PageTiming } from "./shell";

const M = STAGE.margin;

/** How much closer the words held after the film's sound drift, over the rest of the scene. */
const DRIFT = 0.06;

export function darkPage(timing: PageTiming): string {
  const h = film.hook;
  const data = {
    ...timing,
    h: { from: h.from, locked: h.locked, freaky: h.freaky, silence: h.silence },
  };
  const css = `
#close { left:0; width:${STAGE.w}px; top:400px; text-align:center; font-family:var(--serif); font-style:italic;
  font-size:88px; color:var(--ink-100); opacity:0; }
#ctx { left:${M}px; top:56px; font-size:24px; color:var(--ink-400); opacity:0; }
.dlg { left:0; width:${STAGE.w}px; top:720px; text-align:center; font-size:40px; font-weight:500; color:var(--ink-300); opacity:0; }
#meter { left:${M}px; top:470px; height:6px; width:0; background:var(--ink-300); opacity:0; }
#count { top:380px; font-family:var(--mono); font-size:64px; color:var(--ink-100); opacity:0; white-space:nowrap; }
#nowords { left:${M}px; top:500px; font-size:26px; color:var(--ink-400); opacity:0; }
#sum { left:0; width:${STAGE.w}px; top:330px; text-align:center; opacity:0; }
#sum b { display:block; font-family:var(--serif); font-weight:400; font-size:150px; line-height:1; color:var(--ink-100); }
#sum span { font-size:34px; color:var(--ink-300); }
#open { left:0; width:${STAGE.w}px; top:400px; text-align:center; font-family:var(--serif); font-style:italic;
  font-size:88px; color:var(--ink-100); opacity:0; }`;
  const body = `
<p class="a" id="ctx"><i>Tears of Steel</i>, ${Math.floor(h.from)}–${Math.ceil(h.to)} s of the film · sound only</p>
<p class="a" id="close">Close your eyes.</p>
<div class="a" id="meter"></div>
<p class="a" id="count">0.0 s</p>
<p class="a" id="nowords">no dialogue</p>
<p class="a dlg" id="locked">…${esc(h.locked.text)}</p>
<p class="a dlg" id="freaky">${esc(h.freaky.text)}</p>
<p class="a" id="sum"><b>${h.silence.toFixed(2)} s</b><span>with no dialogue</span></p>
<p class="a" id="open">Open your eyes.</p>`;
  const width = STAGE.w - 2 * M;
  const render = `
const f = D.h.from + (t - D.film);
reveal($('#close'), prog(t, 0.1, 0.8) * (1 - prog(t, D.film + 0.6, 0.8)), 10);
$('#ctx').style.opacity = prog(t, D.film - 0.4, 0.6) * (1 - prog(t, D.T - 0.8, 0.6));
const cap = (el, a, b) => { el.style.opacity = prog(f, a, 0.15) * (1 - prog(f, b, 0.3)); };
cap($('#locked'), D.h.locked.start, D.h.locked.end + 1.0);
cap($('#freaky'), D.h.freaky.start, D.h.freaky.end + 0.6);
const s = lin(f, D.h.locked.end, D.h.freaky.start - D.h.locked.end);
const after = D.S[0];
const on = prog(f, D.h.locked.end, 0.3) * (1 - prog(t, after - 0.2, 0.5));
reveal($('#sum'), prog(t, after, 0.6) * (1 - prog(t, D.S[1] - 0.1, 0.4)), 16);
reveal($('#open'), prog(t, D.S[1] + 0.2, 0.5) * (1 - prog(t, D.T - 0.25, 0.25)), 10);
// A slow push on the words held after the film's sound, so the picture keeps moving while they are read.
const drift = (el, from) => { el.style.transform += ' scale(' + (1 + ${DRIFT} * lin(t, from, D.T - from)) + ')'; };
drift($('#sum'), after); drift($('#open'), D.S[1]);
const w = s * ${width};
$('#meter').style.width = w + 'px';
$('#meter').style.opacity = on;
$('#nowords').style.opacity = on;
const c = $('#count');
c.style.opacity = on;
c.textContent = (s >= 1 ? fmt(D.h.silence, 2) : fmt(s * D.h.silence, 1)) + ' s';
c.style.left = Math.min(${M} + w + 16, ${STAGE.w - M} - c.offsetWidth) + 'px';`;
  return pageHtml({ css, body, render, data });
}

const SEVEN = {
  headline: 64,
  edge: 206,
  strip: 250,
  stripH: 300,
  sub: 452,
  dlg: 590,
  dlgH: 70,
  ad: 684,
  adH: 50,
  note: 748,
  tag: 790,
};
/** Shots with less than this much time in the strip are left dark; a sliver reads as a bad crop. */
const MIN_SHOT_S = 1.5;
const STILL_W = 1920;

export async function sevenPage(timing: PageTiming): Promise<string> {
  const h = film.hook;
  const [d0, d1] = h.domain;
  const pps = STAGE.w / (d1 - d0);
  const x = (s: number) => (s - d0) * pps;
  const shots = film.opening.shots
    .map((s) => ({ a: Math.max(s.start, d0), b: Math.min(s.end, d1) }))
    .filter((s) => s.b - s.a >= MIN_SHOT_S);
  if (shots.length !== 2)
    throw new Error(`expected 2 shots in the seven seconds, got ${shots.length}`);
  const master = { file: await masterCut(h.from, h.to), from: h.from };
  const stills = await Promise.all(
    shots.map((s, i) => still(`seven-${i}`, (s.a + s.b) / 2, STILL_W, master)),
  );
  const shotHtml = shots
    .map(
      (s, i) =>
        `<div class="a sv-shot" style="left:${x(s.a)}px;width:${x(s.b) - x(s.a) - (i ? 0 : 3)}px"><img src="${stills[i]}" alt=""></div>`,
    )
    .join("");
  const lines = h.lines;
  const subs = lines
    .map((l) => {
      const shot = shots.find((s) => l.start >= s.a && l.start < s.b);
      if (!shot) throw new Error(`line ${l.id} is outside the strip's shots`);
      const c = (x(shot.a) + x(shot.b)) / 2;
      const w = x(shot.b) - x(shot.a) - 48;
      return `<p class="a sub sv-sub" lang="ko" style="left:${c - w / 2}px;width:${w}px">${esc(l.text)}<span class="gloss" lang="en">${esc(gloss(l.text))}</span></p>`;
    })
    .join("");
  const rooms = lines
    .map(
      (l) =>
        `<div class="room sv-room" style="left:${x(l.start)}px;width:${x(l.windowEnd) - x(l.start)}px"></div>` +
        `<div class="clip ad sv-bar" data-w="${l.voiced * pps}" style="left:${x(l.start)}px;width:0"></div>`,
    )
    .join("");
  const measured = lines
    .map(
      (l) =>
        `<p class="a sv-m" style="left:${x(l.start)}px">${l.voiced.toFixed(2)} s <span>spoken, of ${(l.windowEnd - l.start).toFixed(2)} s</span></p>`,
    )
    .join("");
  const css = `
.sv-shot { top:${SEVEN.strip}px; height:${SEVEN.stripH}px; overflow:hidden; opacity:0; }
.sv-shot img { width:100%; height:100%; object-fit:cover; transform-origin:50% 50%; }
.sv-sub { top:${SEVEN.sub}px; font-size:36px; line-height:1.25; opacity:0; text-shadow:0 0 3px #000, 0 1px 4px #000, 0 2px 18px rgba(0,0,0,.85); }
.sv-sub .gloss { font-size:25px; }
.sv-edge { top:${SEVEN.edge}px; font-family:var(--mono); font-size:24px; color:var(--ink-100); opacity:0; }
.sv-dlg { display:block; padding:0 12px; font-size:24px; font-weight:500; line-height:${SEVEN.dlgH}px; color:#f4f4f5; white-space:nowrap; }
.sv-span { top:${SEVEN.dlg}px; height:${SEVEN.dlgH}px; display:flex; align-items:center; gap:22px; opacity:0; }
.sv-span i { flex:1; height:2px; background:var(--ink-400); }
.sv-span span { font-size:28px; color:var(--ink-300); white-space:nowrap; }
.sv-span b { font-family:var(--serif); font-weight:400; font-size:60px; color:var(--ink-100); margin-right:10px; vertical-align:-4px; }
.sv-room { opacity:0; }
.sv-m { top:${SEVEN.note}px; font-size:26px; font-weight:600; color:var(--amber); white-space:nowrap; opacity:0; }
.sv-m span { font-weight:400; color:var(--ink-300); }
#sv-tag { top:${SEVEN.tag}px; font-size:24px; color:var(--ink-100); opacity:0; white-space:nowrap; }
#sv-head { left:${M}px; top:${SEVEN.headline}px; opacity:0; }`;
  const silentFrom = x(h.locked.end);
  const silentTo = x(h.freaky.start);
  const body = `
<h2 class="a h2" id="sv-head">Two lines, each inside the silence.</h2>
<p class="a sv-edge" style="left:${silentFrom + 10}px">${h.locked.end.toFixed(2)} s</p>
<p class="a sv-edge" style="right:${STAGE.w - silentTo + 10}px">${h.freaky.start.toFixed(2)} s</p>
${shotHtml}
${subs}
<div class="lane sv-lane" style="left:0;width:${STAGE.w}px;top:${SEVEN.dlg}px;height:${SEVEN.dlgH}px;opacity:0">
  <div class="clip dialogue" style="left:${x(h.locked.start)}px;width:${x(h.locked.end) - x(h.locked.start)}px"><span class="sv-dlg">${esc(h.locked.text)}</span></div>
  <div class="clip dialogue" style="left:${x(h.freaky.start)}px;width:${x(h.freaky.end) - x(h.freaky.start)}px"><span class="sv-dlg">${esc(h.freaky.text)}</span></div>
</div>
<div class="a sv-span" style="left:${silentFrom + 16}px;width:${silentTo - silentFrom - 32}px"><i></i><span><b>${h.silence.toFixed(2)} s</b>with no dialogue</span><i></i></div>
<div class="lane" style="left:0;width:${STAGE.w}px;top:${SEVEN.ad}px;height:${SEVEN.adH}px">${rooms}</div>
${measured}
<p class="a" id="sv-tag" style="left:${x(lines[0].start)}px">↑ both written, reviewed, voiced and measured by Scene, with no edits</p>
<p class="src">Speech timing from Chirp 3. Amber: Scene’s lines at their measured length, inside the outlined room. Glosses ours.<br><i>Tears of Steel</i> © Blender Foundation, CC BY 3.0</p>`;
  const render = `
const S = D.S;
reveal($('#sv-head'), prog(t, 0, 0.7));
$$('.sv-shot').forEach((el, i) => { el.style.opacity = prog(t, 0.05 + i * 0.15, 0.6);
  el.firstChild.style.transform = 'scale(' + (1.0 + 0.035 * t / D.T) + ')'; });
$$('.sv-lane, .sv-edge').forEach((el) => { el.style.opacity = prog(t, 0.2, 0.6); });
reveal($('.sv-span'), prog(t, 0.5, 0.6), 0);
$$('.sv-room').forEach((el, i) => { el.style.opacity = prog(t, S[0] + 0.2 + i * 0.3, 0.5); });
$$('.sv-bar').forEach((el, i) => {
  const p = lin(t, S[0] + 0.9 + i * 1.3, 1.2);
  el.style.width = (Number(el.dataset.w) * ease(p)) + 'px';
  $$('.sv-sub')[i].style.opacity = prog(t, S[0] + 0.9 + i * 1.3, 0.4);
});
$$('.sv-m').forEach((el, i) => reveal(el, prog(t, S[1] + 0.2 + i * 0.6, 0.5), 10));
reveal($('#sv-tag'), prog(t, S[2], 0.5), 10);`;
  return pageHtml({ css, body, render, data: timing });
}
