/**
 * "cloud": the one Cloud Run service a clip passes through, drawn in hairlines. The service's outline
 * draws first; then one line runs through the run's stages in order, each stage lighting as the line
 * reaches it, with the Google model it calls under its name and the two loops that send a line back;
 * last, Cloud Storage under the service and the progress stream back to the browser. No looping
 * pulses: every mark is drawn once, and a slow push-in keeps the picture alive while it is read.
 * Settings come from deploy/cloud-run.sh (via the deck's data/deploy.ts); the Gemini access wording is
 * GEMINI_ACCESS_LABEL (src/lib/models.ts), the one place it may change.
 */
import { SPEC } from "../../deck/data/deploy";
import { film, GEMINI_NAME } from "../facts";
import { esc, pageHtml, STAGE, type PageTiming } from "./shell";

const M = STAGE.margin;
const BOX = { x: 470, y: 190, w: STAGE.w - M - 470, h: 500, r: 14 };
const LINE_Y = 440;
const BROWSER = { x: M, y: LINE_Y - 62, w: 206, h: 112 };
/** Loops leave a stage and come back to an earlier one: over the names, or under the services. */
const LOOP_GAP = { over: 58, under: 60 };
const LOOP_DEPTH = 50;
const NODE_X0 = BOX.x + 96;
const NODE_X1 = BOX.x + BOX.w - 96;
const SHELF = { x: BOX.x, y: 760, w: BOX.w, h: 84 };
/** The whole page drifts this much closer over the scene. */
const DRIFT = 0.022;
/** Share of the services sentence the line takes to cross every stage. */
const CROSS_SHARE = 0.8;

type Service = "stt" | "gemini" | "tts" | "ffmpeg";
const STAGES: { name: string; service: Service }[] = [
  { name: "Hear", service: "stt" },
  { name: "Watch", service: "gemini" },
  { name: "Write", service: "gemini" },
  { name: "Review", service: "gemini" },
  { name: "Voice", service: "tts" },
  { name: "Check", service: "gemini" },
  { name: "Fix", service: "gemini" },
  { name: "Mix", service: "ffmpeg" },
];
const SERVICE_TAG: Record<Service, string> = {
  stt: "Speech-to-Text",
  gemini: "Gemini",
  tts: "Text-to-Speech",
  ffmpeg: "FFmpeg",
};
/** The two loops, as on the deck's pipeline slide: [from stage, back to stage, label, side]. */
const LOOPS: [string, string, string, "over" | "under"][] = [
  ["Review", "Write", "rejected: rewritten from the fix", "over"],
  ["Voice", "Review", "too long: faster, or shortened and reviewed again", "under"],
];

/** An arrowhead drawn at the moving end of a line, pointing along it. */
const TIP = "M-10 -5.5 L0 0 L-10 5.5 Z";

const nodeX = (i: number) => NODE_X0 + (i * (NODE_X1 - NODE_X0)) / (STAGES.length - 1);
const xOf = (name: string) => nodeX(STAGES.findIndex((s) => s.name === name));

export function cloudPage(timing: PageTiming): string {
  const box = `M${BOX.x + BOX.r} ${BOX.y} H${BOX.x + BOX.w - BOX.r} A${BOX.r} ${BOX.r} 0 0 1 ${BOX.x + BOX.w} ${BOX.y + BOX.r} V${BOX.y + BOX.h - BOX.r} A${BOX.r} ${BOX.r} 0 0 1 ${BOX.x + BOX.w - BOX.r} ${BOX.y + BOX.h} H${BOX.x + BOX.r} A${BOX.r} ${BOX.r} 0 0 1 ${BOX.x} ${BOX.y + BOX.h - BOX.r} V${BOX.y + BOX.r} A${BOX.r} ${BOX.r} 0 0 1 ${BOX.x + BOX.r} ${BOX.y} Z`;
  const loops = LOOPS.map(([from, to, label, side]) => {
    const a = xOf(from);
    const b = xOf(to);
    const dir = side === "over" ? -1 : 1;
    const start = LINE_Y + dir * LOOP_GAP[side];
    const far = start + dir * LOOP_DEPTH;
    const r = 14;
    const d = `M${a} ${start} V${far - dir * r} Q${a} ${far} ${a - r} ${far} H${b + r} Q${b} ${far} ${b} ${far - dir * r} V${start - dir * 4}`;
    const at = STAGES.findIndex((s) => s.name === from);
    const textY = side === "over" ? far - 14 : far + 32;
    return (
      `<path class="cz-loop" id="cz-loop-${at}" data-at="${at}" d="${d}"/><path class="cz-tip" data-for="cz-loop-${at}" d="${TIP}"/>` +
      `<text class="cz-loopl" data-at="${at}" x="${(a + b) / 2}" y="${textY}">${esc(label)}</text>`
    );
  }).join("");
  const dots = STAGES.map(
    (_, i) => `<circle class="cz-dot" data-i="${i}" cx="${nodeX(i)}" cy="${LINE_Y}" r="7"/>`,
  ).join("");
  const names = STAGES.map(
    (s, i) =>
      `<p class="a cz-name" data-i="${i}" style="left:${nodeX(i)}px;top:${LINE_Y - 50}px">${s.name}</p>` +
      `<p class="a cz-svc" data-i="${i}" style="left:${nodeX(i)}px;top:${LINE_Y + 18}px">${SERVICE_TAG[s.service]}</p>`,
  ).join("");
  const drops = ["Hear", "Voice", "Mix"]
    .map((name) => `<path class="cz-drop" d="M${xOf(name)} ${BOX.y + BOX.h} V${SHELF.y}"/>`)
    .join("");
  const data = { ...timing, x: STAGES.map((_, i) => nodeX(i)), x0: NODE_X0, x1: NODE_X1 };
  const css = `
#cz-head { left:${M}px; top:64px; opacity:0; }
svg { position:absolute; left:0; top:0; overflow:visible; }
.cz-box { fill:none; stroke:var(--ink-300); stroke-width:1.5; }
.cz-line { stroke:var(--ink-100); stroke-width:2; }
.cz-rail { stroke:var(--rule); stroke-width:2; }
.cz-dot { fill:var(--screen); stroke:var(--ink-400); stroke-width:2; }
.cz-dot.on { fill:var(--ink-100); stroke:var(--ink-100); }
.cz-loop { fill:none; stroke:var(--ink-400); stroke-width:1.5; }
.cz-loopl { font-family:var(--sans); font-size:22px; fill:var(--ink-300); text-anchor:middle; opacity:0; paint-order:stroke; stroke:var(--screen); stroke-width:10px; }
.cz-tip { fill:var(--ink-300); opacity:0; }
.cz-link { fill:none; stroke:var(--ink-300); stroke-width:1.5; }
.cz-drop { fill:none; stroke:var(--tick); stroke-width:1.5; stroke-dasharray:4 6; }
.cz-spec { left:${BOX.x + 32}px; top:${BOX.y + 26}px; font-family:var(--mono); font-size:22px; color:var(--ink-300); opacity:0; white-space:nowrap; }
.cz-spec b { font-family:var(--sans); font-size:30px; font-weight:600; color:var(--ink-100); margin-right:18px; }
.cz-sub { left:${BOX.x + 32}px; top:${BOX.y + 70}px; font-size:22px; color:var(--ink-400); opacity:0; }
.cz-name { transform:translateX(-50%); font-size:28px; font-weight:600; color:var(--ink-100); white-space:nowrap; opacity:0; }
.cz-svc { transform:translateX(-50%); font-size:22px; color:var(--ink-400); white-space:nowrap; opacity:0; }
.cz-models { left:${BOX.x + 32}px; top:${BOX.y + BOX.h - 58}px; width:${BOX.w - 64}px; display:flex; gap:44px; font-size:22px; color:var(--ink-400); opacity:0; white-space:nowrap; }
.cz-models b { font-weight:600; color:var(--ink-100); margin-right:8px; }
.cz-browser { left:${BROWSER.x}px; top:${BROWSER.y}px; width:${BROWSER.w}px; height:${BROWSER.h}px; border:1.5px solid var(--ink-300); border-radius:10px; padding:18px 20px; opacity:0; }
.cz-browser p:first-child { font-size:28px; font-weight:600; color:var(--ink-100); }
.cz-browser p + p { margin-top:4px; font-size:22px; color:var(--ink-400); }
.cz-arrowl { font-size:22px; color:var(--ink-300); white-space:nowrap; opacity:0; }
.cz-shelf { left:${SHELF.x}px; top:${SHELF.y}px; height:${SHELF.h}px; width:0; background:var(--lane); border-radius:10px; overflow:hidden; }
.cz-shelf p { position:absolute; left:32px; top:24px; font-size:22px; color:var(--ink-300); white-space:nowrap; opacity:0; }
.cz-shelf b { font-size:28px; font-weight:600; color:var(--ink-100); margin-right:22px; }`;
  const arrowY = { up: BROWSER.y + 38, down: BROWSER.y + 78 };
  const body = `
<h2 class="a h2" id="cz-head">One Cloud Run service, from clip to finished track.</h2>
<svg width="${STAGE.w}" height="${STAGE.h}" viewBox="0 0 ${STAGE.w} ${STAGE.h}">
  <path class="cz-box" d="${box}"/>
  <line class="cz-rail" x1="${NODE_X0}" y1="${LINE_Y}" x2="${NODE_X1}" y2="${LINE_Y}" opacity="0"/>
  <line class="cz-line" x1="${NODE_X0}" y1="${LINE_Y}" x2="${NODE_X0}" y2="${LINE_Y}"/>
  ${loops}
  ${dots}
  <path class="cz-link" id="cz-up" d="M${BROWSER.x + BROWSER.w + 8} ${arrowY.up} H${BOX.x - 10}"/><path class="cz-tip" data-for="cz-up" d="${TIP}"/>
  <path class="cz-link" id="cz-down" d="M${BOX.x - 10} ${arrowY.down} H${BROWSER.x + BROWSER.w + 12}"/><path class="cz-tip" data-for="cz-down" d="${TIP}"/>
  ${drops}
</svg>
<p class="a cz-spec"><b>Cloud Run</b>${esc(SPEC.region ?? "")} · ${esc(SPEC.env)} · ${esc(SPEC.cpu)} vCPU · ${esc(SPEC.memory)} · ${esc(SPEC.min)}–${esc(SPEC.max)} instances</p>
<p class="a cz-sub">One container: the Next.js app and FFmpeg. A run is one request.</p>
${names}
<div class="a cz-models">
  <span><b>Speech-to-Text v2</b>Chirp 3</span>
  <span><b>${esc(GEMINI_NAME)}</b>${esc(film.geminiAccess)}</span>
  <span><b>Text-to-Speech</b>Chirp 3 HD</span>
</div>
<div class="a cz-browser"><p>Browser</p><p>viewer or editor</p></div>
<p class="a cz-arrowl" id="cz-upl" style="left:${BROWSER.x + BROWSER.w + 14}px;top:${arrowY.up - 34}px">clip</p>
<p class="a cz-arrowl" id="cz-downl" style="left:${BROWSER.x + BROWSER.w + 14}px;top:${arrowY.down + 8}px">live progress</p>
<div class="a cz-shelf"><p><b>Cloud Storage</b>every clip, run and version · voice clips · finished tracks · mounted as a volume</p></div>
<p class="src">Settings from deploy/cloud-run.sh. The model key comes from Secret Manager; Cloud Build builds the container into Artifact Registry.</p>`;
  const render = `
const S = D.S, L = D.L;
// Draws a path up to share p, with its arrowhead riding the drawn end.
function draw(path, p) {
  const len = path.getTotalLength();
  path.style.strokeDasharray = len; path.style.strokeDashoffset = len * (1 - p);
  const tip = $('.cz-tip[data-for="' + path.id + '"]');
  if (!tip) return;
  const at = len * p, a = path.getPointAtLength(Math.max(0, at - 2)), b = path.getPointAtLength(at);
  tip.setAttribute('transform', 'translate(' + b.x + ' ' + b.y + ') rotate(' + (Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI) + ')');
  tip.style.opacity = p > 0.03 ? 1 : 0;
}
const stage = $('.stage');
stage.style.transformOrigin = '50% 45%';
stage.style.transform = 'scale(' + (1 + ${DRIFT} * ease(t / D.T)) + ')';
reveal($('#cz-head'), prog(t, 0, 0.7));
// 1. The service: its outline draws, then its settings.
const box = $('.cz-box'); const bl = box.getTotalLength();
box.style.strokeDasharray = bl; box.style.strokeDashoffset = bl * (1 - prog(t, S[0] + 0.1, 1.6));
reveal($('.cz-spec'), prog(t, S[0] + 0.9, 0.6), 8);
reveal($('.cz-sub'), prog(t, S[0] + 1.3, 0.6), 8);
reveal($('.cz-browser'), prog(t, S[0] + 1.7, 0.6), 8);
draw($('#cz-up'), prog(t, S[0] + 2.1, 0.7));
$('#cz-upl').style.opacity = prog(t, S[0] + 2.5, 0.5);
// 2. One line through the stages, each stage lit as the line reaches it.
// The stages wait, unlit, once the clip has reached the service.
const ready = prog(t, S[0] + 2.6, 0.6);
$('.cz-rail').style.opacity = ready;
$$('.cz-dot').forEach((el) => { el.style.opacity = ready; });
const head = D.x0 + (D.x1 - D.x0) * ease(lin(t, S[1] + 0.2, L[1] * ${CROSS_SHARE}));
$('.cz-line').setAttribute('x2', head);
const reached = D.x.map((x) => head >= x - 0.5);
$$('.cz-dot').forEach((el, i) => el.classList.toggle('on', reached[i]));
const litAt = (i) => S[1] + 0.2 + L[1] * ${CROSS_SHARE} * (i / (D.x.length - 1));
$$('.cz-name').forEach((el) => reveal(el, reached[el.dataset.i] ? prog(t, litAt(Number(el.dataset.i)), 0.45) : 0, 10));
$$('.cz-svc').forEach((el) => { el.style.opacity = reached[el.dataset.i] ? prog(t, litAt(Number(el.dataset.i)) + 0.15, 0.5) : 0; });
$$('.cz-loop').forEach((el) => draw(el, prog(t, litAt(Number(el.dataset.at)) + 0.3, 0.9)));
$$('.cz-loopl').forEach((el) => { el.style.opacity = prog(t, litAt(Number(el.dataset.at)) + 0.9, 0.5); });
$('.cz-models').style.opacity = prog(t, S[1] + L[1] * 0.85, 0.7);
// 3. Storage under the service, then progress streaming back to the browser.
$('.cz-shelf').style.width = (${SHELF.w} * prog(t, S[2] + 0.1, 1.1)) + 'px';
$('.cz-shelf p').style.opacity = prog(t, S[2] + 0.8, 0.6);
$$('.cz-drop').forEach((el, i) => { el.style.opacity = prog(t, S[2] + 0.9 + i * 0.2, 0.5); });
draw($('#cz-down'), prog(t, S[2] + L[2] * 0.55, 0.8));
$('#cz-downl').style.opacity = prog(t, S[2] + L[2] * 0.55 + 0.4, 0.5);`;
  return pageHtml({ css, body, render, data });
}
