/**
 * "stakes": why now (the Supreme Court ruling and what hand-made description costs), and
 * "constraint": the sample's 65 seconds as Scene sees them (deck slide 4), built up in the order the
 * presenter names them: word timings, then the usable silences, then Scene's lines inside them.
 */
import { HAND_MADE, LAWSUIT } from "../../deck/facts";
import { thumbTimes } from "../../deck/stills";
import { dayLabel, film } from "../facts";
import { esc, pageHtml, STAGE, still, type PageTiming } from "./shell";

const M = STAGE.margin;
/** The lawsuit's steps, in the order of LAWSUIT (filed, then each ruling). */
const EVENT_LABELS = ["Lawsuit filed", "First ruling", "Appeal: 3% cap", "Supreme Court"];

export function stakesPage(timing: PageTiming): string {
  const filed = new Date(LAWSUIT.filed);
  const events = LAWSUIT.events.map((e) => ({ ...e, d: new Date(e.date) }));
  const final = events[events.length - 1];
  const y0 = filed.getUTCFullYear();
  const y1 = final.d.getUTCFullYear();
  const AX = { x0: M, x1: 880, y: 690 };
  const yearX = (d: Date) =>
    AX.x0 + ((d.getUTCFullYear() + d.getUTCMonth() / 12 - y0) / (y1 + 1 - y0)) * (AX.x1 - AX.x0);
  const ticks = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i)
    .map(
      (y) =>
        `<div class="a st-tick" style="left:${yearX(new Date(Date.UTC(y, 0, 1)))}px"></div>` + "",
    )
    .join("");
  if (events.length !== EVENT_LABELS.length - 1)
    throw new Error("the lawsuit has a different number of rulings than the timeline labels");
  const dots = [filed, ...events.map((e) => e.d)]
    .map(
      (d, i) =>
        `<div class="a st-dot${i === events.length ? " last" : ""}" data-x="${yearX(d)}" style="left:${yearX(d) - 8}px"></div>` +
        `<p class="a st-ev${i % 2 ? " low" : ""}" data-x="${yearX(d)}" style="left:${yearX(d)}px">${EVENT_LABELS[i]}<br><span>${d.getUTCFullYear()}</span></p>`,
    )
    .join("");
  const people = Array.from({ length: HAND_MADE.specialists }, () => `<i></i>`).join("");
  const css = `
#st-head { left:${M}px; top:64px; max-width:1500px; opacity:0; }
.st-col { top:270px; width:800px; opacity:0; }
.st-col .label { font-size:26px; color:var(--ink-300); }
.st-big { font-family:var(--serif); font-size:124px; line-height:1.05; color:var(--ink-100); margin:10px 0 18px; white-space:nowrap; }
.st-big small { font-size:64px; color:var(--ink-300); margin-left:14px; }
.st-col p.body { font-size:34px; line-height:1.45; color:var(--ink-300); }
.st-axis { left:${AX.x0}px; top:${AX.y}px; height:2px; width:0; background:var(--ink-300); }
.st-tick { top:${AX.y - 6}px; width:1px; height:14px; background:var(--tick); opacity:0; }
.st-year { top:${AX.y + 16}px; transform:translateX(-50%); font-family:var(--mono); font-size:22px; color:var(--ink-400); opacity:0; }
.st-dot { top:${AX.y - 7}px; width:16px; height:16px; border-radius:50%; background:var(--ink-300); opacity:0; }
.st-dot.last { background:var(--ink-100); box-shadow:0 0 0 6px rgba(236,233,227,.18); }
.st-ev { top:${AX.y - 86}px; transform:translateX(-50%); text-align:center; font-size:22px; line-height:1.3; color:var(--ink-300); white-space:nowrap; opacity:0; }
.st-ev.low { top:${AX.y + 22}px; }
.st-ev span { font-family:var(--mono); color:var(--ink-400); }
.st-people { display:flex; gap:16px; margin-top:44px; }
.st-people i { display:block; width:34px; height:52px; border-radius:17px 17px 6px 6px; border:2px solid var(--ink-400); opacity:.25; }
.st-people i.on { background:var(--ink-300); border-color:var(--ink-300); opacity:1; }`;
  const body = `
<h2 class="a h2" id="st-head">The law is moving faster than description can be made.</h2>
<div class="a st-col" id="st-a" style="left:${M}px">
  <p class="label">Supreme Court of Korea, after a ten-year lawsuit</p>
  <p class="st-big">${esc(dayLabel(final.d))}</p>
  <p class="body">Cinemas discriminate when films lack audio description and captions.</p>
</div>
<div class="a st-axis"></div>${ticks}${dots}
<div class="a st-col" id="st-b" style="left:1020px">
  <p class="label">One accessible film, made by hand</p>
  <p class="st-big">${HAND_MADE.months} months<small>₩${HAND_MADE.wonMillions}M</small></p>
  <p class="body">About ${HAND_MADE.specialists} specialists for description and captions together, about US$${HAND_MADE.usdThousands}k.</p>
  <div class="st-people">${people}</div>
</div>
<p class="src">${esc(final.source)} (${esc(dayLabel(final.d))}). ${esc(HAND_MADE.source)}.</p>`;
  const render = `
const S = D.S, L = D.L;
reveal($('#st-head'), prog(t, 0, 0.7));
reveal($('#st-a'), prog(t, S[0], 0.6));
const draw = lin(t, S[0] + 0.3, Math.max(2, L[0] - 0.6));
const head = ${AX.x0} + draw * ${AX.x1 - AX.x0};
$('.st-axis').style.width = (head - ${AX.x0}) + 'px';
$$('.st-tick, .st-year').forEach((el) => { el.style.opacity = prog(t, S[0] + 0.2, 0.5); });
$$('.st-dot').forEach((el) => { el.style.opacity = head >= Number(el.dataset.x) ? 1 : 0; });
$$('.st-ev').forEach((el) => reveal(el, head >= Number(el.dataset.x) ? 1 : 0, 0));
reveal($('#st-b'), prog(t, S[1], 0.6));
const n = Math.floor(lin(t, S[1] + 0.8, Math.max(1.5, L[1] - 1.5)) * ${HAND_MADE.specialists} + 0.001);
$$('.st-people i').forEach((el, i) => el.classList.toggle('on', i < n));`;
  return pageHtml({ css, body, render, data: timing });
}

const C = {
  x0: 330,
  x1: STAGE.w - M,
  thumbs: 236,
  thumbsH: 104,
  dlg: 384,
  dlgH: 64,
  gl: 456,
  lines: 546,
  linesH: 48,
  axis: 624,
  result: 712,
};

export async function constraintPage(timing: PageTiming): Promise<string> {
  const o = film.opening;
  const pps = (C.x1 - C.x0) / o.clip;
  const x = (s: number) => C.x0 + s * pps;
  const slot = o.clip / thumbTimes.length;
  const thumbs = (await Promise.all(thumbTimes.map((t, i) => still(`thumb-${i}`, t, 480))))
    .map(
      (src, i) =>
        `<img class="a still ct-thumb" src="${src}" alt="" style="left:${x(i * slot)}px;top:${C.thumbs}px;width:${slot * pps - 3}px;height:${C.thumbsH}px">`,
    )
    .join("");
  const speech = o.speech
    .map(
      (s) =>
        `<div class="clip dialogue" style="left:${x(s.start) - C.x0}px;width:${Math.max((s.end - s.start) * pps, 2)}px"></div>`,
    )
    .join("");
  const gaps = o.gaps
    .map(
      (g, i) =>
        `<div class="a ct-gap${g.id === o.shortestId ? " short" : ""}" data-i="${i}" style="left:${x(g.start)}px;top:${C.dlg}px;width:${(g.end - g.start) * pps}px;height:${C.dlgH}px"></div>` +
        `<p class="a ct-gl${g.id === o.shortestId ? " short" : ""}" style="left:${x((g.start + g.end) / 2)}px">${g.seconds.toFixed(2)}${g.id === o.shortestId ? "<span>shortest</span>" : ""}</p>`,
    )
    .join("");
  const lines = o.lines
    .map(
      (l) =>
        `<div class="room ct-room" style="left:${x(l.start) - C.x0}px;width:${(l.windowEnd - l.start) * pps}px"></div>` +
        `<div class="clip ad ct-bar" data-w="${l.voiced * pps}" style="left:${x(l.start) - C.x0}px;width:0"></div>`,
    )
    .join("");
  const ticks = [0, 10, 20, 30, 40, 50, 60]
    .map(
      (s) =>
        `<div class="a ct-tick" style="left:${x(s)}px"></div><p class="a ct-t" style="left:${x(s)}px">${s}</p>`,
    )
    .join("");
  const css = `
#ct-head { left:${M}px; top:64px; max-width:1720px; opacity:0; }
.ct-thumb { opacity:0; }
.ct-row { left:${M}px; width:${C.x0 - M - 24}px; opacity:0; }
.ct-row .label { font-size:24px; }
.ct-row small { display:block; font-size:22px; color:var(--ink-400); }
.ct-lane { left:${C.x0}px; width:${C.x1 - C.x0}px; }
#ct-speech { top:${C.dlg}px; height:${C.dlgH}px; clip-path:inset(0 100% 0 0); }
.ct-gap { background:rgba(236,233,227,.1); box-shadow:inset 0 0 0 2px rgba(236,233,227,.55); border-radius:3px; opacity:0; }
.ct-gl { top:${C.gl}px; transform:translateX(-50%); transform-origin:50% 0; font-family:var(--mono); font-size:24px; color:var(--ink-300); white-space:nowrap; text-align:center; opacity:0; }
.ct-gl.short { color:var(--ink-100); }
.ct-gl span { display:block; font-family:var(--sans); font-size:22px; color:var(--ink-400); }
.ct-room { opacity:0; }
#ct-play { top:${C.thumbs - 16}px; width:2px; height:${C.axis - C.thumbs + 16}px; background:var(--ink-100); opacity:0; }
#ct-chip { top:${C.thumbs - 58}px; font-size:24px; font-weight:600; color:var(--screen); background:var(--ink-100); padding:4px 12px; border-radius:4px; white-space:nowrap; opacity:0; }
.ct-axis { left:${C.x0}px; top:${C.axis}px; width:${C.x1 - C.x0}px; height:2px; background:var(--rule); }
.ct-tick { top:${C.axis}px; width:1px; height:12px; background:var(--tick); }
.ct-t { top:${C.axis + 16}px; transform:translateX(-50%); font-family:var(--mono); font-size:22px; color:var(--ink-400); }
#ct-result { left:${M}px; top:${C.result}px; font-size:30px; color:var(--ink-300); opacity:0; }
#ct-result b { font-family:var(--serif); font-weight:400; font-size:56px; color:var(--ink-100); vertical-align:-6px; }`;
  const body = `
<h2 class="a h2" id="ct-head">Every line has to fit a silence that is already in the film.</h2>
${thumbs}
<div class="a ct-row" style="top:${C.thumbs + 36}px"><p class="label">Picture</p></div>
<div class="a ct-row" style="top:${C.dlg}px"><p class="label">Dialogue <span class="muted">${o.speechTotal.toFixed(2)} s</span></p><small>silence outlined: ${o.gapTotal.toFixed(2)} s</small></div>
<div class="a ct-row" style="top:${C.lines - 4}px"><p class="label">Scene’s lines <span class="muted">${o.narrationTotal.toFixed(2)} s</span></p><small>voice inside its room</small></div>
<div class="lane a ct-lane" style="top:${C.dlg}px;height:${C.dlgH}px"></div>
<div class="a ct-lane" id="ct-speech">${speech}</div>
${gaps}
<div class="lane a ct-lane" style="top:${C.lines}px;height:${C.linesH}px">${lines}</div>
<div class="a ct-axis"></div>${ticks}<p class="a ct-t" style="left:${x(o.clip)}px">${o.clip} s</p>
<div class="a" id="ct-play"></div><p class="a" id="ct-chip">Speech-to-Text · Chirp 3</p>
<p class="a" id="ct-result"><b>${o.lines.length}</b> lines, <b>${o.narrationTotal.toFixed(2)}</b> seconds of voice, and no overlap with the recognized speech.</p>
<p class="src">The sample’s final track. Speech timing from Chirp 3; a usable silence is at least 1.2 s and keeps 0.25 s clear of speech.</p>`;
  const render = `
const S = D.S, L = D.L;
reveal($('#ct-head'), prog(t, 0, 0.7));
$$('.ct-thumb').forEach((el, i) => { el.style.opacity = prog(t, 0.1 + i * 0.06, 0.5); });
$$('.ct-row').forEach((el) => { el.style.opacity = prog(t, 0.3, 0.6); });
const sweep = lin(t, S[0] + 0.2, L[0] + 0.3);
const px = ${C.x0} + sweep * ${C.x1 - C.x0};
$('#ct-speech').style.clipPath = 'inset(0 ' + ((1 - sweep) * ${C.x1 - C.x0}) + 'px 0 0)';
const on = prog(t, S[0], 0.3) * (1 - prog(t, S[0] + L[0] + 0.5, 0.4));
$('#ct-play').style.left = px + 'px'; $('#ct-play').style.opacity = on;
const chip = $('#ct-chip'); chip.style.opacity = on;
chip.style.left = Math.min(px - chip.offsetWidth / 2, ${C.x1} - chip.offsetWidth) + 'px';
const n = $$('.ct-gap').length;
$$('.ct-gap').forEach((el, i) => { el.style.opacity = prog(t, S[1] + 0.3 + i * (L[1] * 0.75 / n), 0.4); });
$$('.ct-gl').forEach((el, i) => { el.style.opacity = prog(t, S[1] + 0.3 + i * (L[1] * 0.75 / n), 0.4); });
const mark = prog(t, S[1] + L[1] * 0.85, 0.5);
$('.ct-gl.short span').style.opacity = mark;
$('.ct-gl.short').style.transform = 'translateX(-50%) scale(' + (1 + 0.35 * mark) + ')';
$('.ct-gap.short').style.boxShadow = 'inset 0 0 0 ' + (2 + 2 * mark) + 'px rgba(236,233,227,' + (0.55 + 0.45 * mark) + ')';
$$('.ct-room').forEach((el, i) => { el.style.opacity = prog(t, S[2] + i * 0.12, 0.4); });
$$('.ct-bar').forEach((el, i) => { el.style.width = Number(el.dataset.w) * prog(t, S[2] + 0.3 + i * 0.18, 0.7) + 'px'; });
reveal($('#ct-result'), prog(t, S[2] + 1.4, 0.6));`;
  return pageHtml({ css, body, render, data: timing });
}
