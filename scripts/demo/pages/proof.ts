/**
 * "cloud": the Google Cloud services Scene runs on, lit in the order the presenter names them, with
 * pulses running along the calls. "evidence": what the evaluation runs measured. "close": the tagline
 * set between the two lines of dialogue from the hook, and the live URL. The Gemini access wording is
 * GEMINI_ACCESS_LABEL (src/lib/models.ts), the one place it may change.
 */
import { evaluationGrid } from "../../deck/data/evaluation";
import { SUBMISSION } from "../../deck/facts";
import { dayLabel, film, GEMINI_NAME, minutesSeconds } from "../facts";
import { esc, pageHtml, STAGE, type PageTiming } from "./shell";

const M = STAGE.margin;

interface Box {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  aside?: string;
  text: string;
  /** Which sentence reveals it, and where in that sentence (0–1). */
  at: [number, number];
}

const RUN = { x: 470, y: 290, w: 620, h: 320 };
const RIGHT = { x: 1180, w: STAGE.w - M - 1180, h: 104, gap: 16 };
const BOXES: Box[] = [
  {
    id: "browser",
    x: M,
    y: 300,
    w: 300,
    h: 150,
    title: "Browser",
    text: "Plays results, edits a line, follows a run",
    at: [0, 0],
  },
  {
    id: "run",
    ...RUN,
    title: "Cloud Run, Seoul",
    text: "Next.js app and FFmpeg in one container, gen2, 2 vCPU, 2 GiB. Scales to zero. Progress streams to the browser as server-sent events.",
    at: [0, 0.15],
  },
  {
    id: "build",
    x: M,
    y: 480,
    w: 300,
    h: 150,
    title: "Cloud Build",
    text: "Builds the container into Artifact Registry",
    at: [0, 0.5],
  },
  {
    id: "stt",
    x: RIGHT.x,
    y: RUN.y,
    w: RIGHT.w,
    h: RIGHT.h,
    title: "Speech-to-Text v2 · Chirp 3",
    text: "Word timings for every line of dialogue",
    at: [1, 0],
  },
  {
    id: "gemini",
    x: RIGHT.x,
    y: RUN.y + RIGHT.h + RIGHT.gap,
    w: RIGHT.w,
    h: RIGHT.h,
    title: GEMINI_NAME,
    aside: film.geminiAccess,
    text: "Watches the clip, writes and reviews each line",
    at: [1, 0.3],
  },
  {
    id: "tts",
    x: RIGHT.x,
    y: RUN.y + 2 * (RIGHT.h + RIGHT.gap),
    w: RIGHT.w,
    h: RIGHT.h,
    title: "Text-to-Speech · Chirp 3 HD",
    text: "One voice clip per line, measured before mixing",
    at: [1, 0.72],
  },
  {
    id: "gcs",
    x: RUN.x,
    y: 670,
    w: 350,
    h: 150,
    title: "Cloud Storage",
    text: "Every clip and every version of a run",
    at: [2, 0],
  },
  {
    id: "secret",
    x: RUN.x + 366,
    y: 670,
    w: RUN.w - 366,
    h: 150,
    title: "Secret Manager",
    text: "Model API key",
    at: [2, 0.35],
  },
];

export function cloudPage(timing: PageTiming): string {
  const box = (id: string) => BOXES.find((b) => b.id === id)!;
  const cy = (b: Box) => b.y + b.h / 2;
  const right = RUN.x + RUN.w;
  /** Connectors: [target box that reveals it, path from, path to]. */
  const links: [string, string][] = [
    ["browser", `M${M + 300 + 8} ${cy(box("browser"))} H${RUN.x - 8}`],
    ["build", `M${M + 300 + 8} ${cy(box("build"))} H${RUN.x - 8}`],
    ["stt", `M${right + 8} ${cy(box("stt"))} H${RIGHT.x - 8}`],
    ["gemini", `M${right + 8} ${cy(box("gemini"))} H${RIGHT.x - 8}`],
    ["tts", `M${right + 8} ${cy(box("tts"))} H${RIGHT.x - 8}`],
    ["gcs", `M${box("gcs").x + 175} ${RUN.y + RUN.h + 8} V${box("gcs").y - 8}`],
    [
      "secret",
      `M${box("secret").x + box("secret").w / 2} ${box("secret").y - 8} V${RUN.y + RUN.h + 8}`,
    ],
  ];
  const svg = links
    .map(
      ([id, d]) =>
        `<path class="cl-link" data-for="${id}" d="${d}"/><circle class="cl-pulse" data-for="${id}" r="6"/>`,
    )
    .join("");
  const boxes = BOXES.map(
    (b) =>
      `<div class="a cl-box${b.id === "run" ? " run" : ""}" id="cl-${b.id}" data-s="${b.at[0]}" data-f="${b.at[1]}" style="left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px"><p class="cl-t">${esc(b.title)}${b.aside ? `<span class="cl-aside">${esc(b.aside)}</span>` : ""}</p><p class="cl-x">${esc(b.text)}</p></div>`,
  ).join("");
  const css = `
#cl-head { left:${M}px; top:64px; max-width:1500px; opacity:0; }
.cl-box { border:2px solid #3a3c41; border-radius:6px; background:var(--lane); padding:16px 20px; opacity:0; }
.cl-box.run { border-color:var(--ink-300); padding:26px 30px; }
.cl-t { font-size:28px; font-weight:600; color:var(--ink-100); white-space:nowrap; }
.cl-box.run .cl-t { font-size:34px; margin-bottom:10px; }
.cl-aside { margin-left:14px; font-size:22px; font-weight:400; color:var(--ink-300); }
.cl-x { margin-top:6px; font-size:24px; line-height:1.35; color:var(--ink-300); }
.cl-box.run .cl-x { font-size:27px; line-height:1.45; }
svg { position:absolute; left:0; top:0; }
.cl-link { fill:none; stroke:var(--ink-300); stroke-width:2; opacity:0; }
.cl-pulse { fill:var(--ink-100); opacity:0; }`;
  const body = `
<h2 class="a h2" id="cl-head">One Cloud Run service drives Google’s speech, voice and Gemini models.</h2>
<svg width="${STAGE.w}" height="${STAGE.h}" viewBox="0 0 ${STAGE.w} ${STAGE.h}">${svg}</svg>
${boxes}
<p class="src">Service settings from deploy/cloud-run.sh.</p>`;
  const render = `
const S = D.S, L = D.L;
reveal($('#cl-head'), prog(t, 0, 0.7));
const shown = {};
$$('.cl-box').forEach((el) => {
  const at = S[Number(el.dataset.s)] + Number(el.dataset.f) * L[Number(el.dataset.s)];
  shown[el.id.slice(3)] = at;
  reveal(el, prog(t, at, 0.5), 14);
});
$$('.cl-link').forEach((el) => { el.style.opacity = prog(t, shown[el.dataset.for] + 0.2, 0.4); });
$$('.cl-pulse').forEach((el) => {
  const path = $('.cl-link[data-for="' + el.dataset.for + '"]');
  const since = t - shown[el.dataset.for] - 0.4;
  if (since < 0) { el.style.opacity = 0; return; }
  const len = path.getTotalLength();
  const p = path.getPointAtLength(clamp(((since * 260) % (len + 60)) - 30, 0, len));
  el.setAttribute('cx', p.x); el.setAttribute('cy', p.y);
  el.style.opacity = prog(since, 0, 0.3);
});`;
  return pageHtml({ css, body, render, data: timing });
}

export function evidencePage(timing: PageTiming): string {
  const l = film.loops;
  const flagged = evaluationGrid.filter((r) => r.cells.high.kind === "review_needed");
  if (flagged.length !== film.flagged.flagged)
    throw new Error("flagged runs do not match the grid");
  const bars = Array.from(
    { length: l.written },
    (_, i) => `<i class="${i < l.voiced ? "on" : "off"}"></i>`,
  ).join("");
  const tags = flagged
    .map(
      (r) =>
        `<li><b>Review needed</b><span>${esc(r.name)}: ${r.cells.high.listed} listed</span></li>`,
    )
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
.ev-tags { list-style:none; margin-top:30px; display:grid; gap:10px; }
.ev-tags li { display:flex; gap:16px; align-items:baseline; font-size:24px; color:var(--ink-300); opacity:0; }
.ev-tags b { font-weight:600; color:var(--ink-100); border:2px solid var(--ink-400); border-radius:4px; padding:2px 10px; }
#ev-cost { left:${M}px; top:800px; font-size:28px; color:var(--ink-300); opacity:0; }
#ev-cost b { font-weight:500; color:var(--ink-100); }`;
  const cost = `$${film.original.costUsd.toFixed(2)}`;
  const body = `
<h2 class="a h2" id="ev-head">Scene reports what a track still misses.</h2>
<div class="a ev-col" id="ev-a" style="left:${M}px">
  <p class="ev-big">${l.voiced} of ${l.written}</p>
  <p class="body">lines made it into the finished tracks in the default reviewer’s ${l.runs} finished test runs, none over the recognized speech.</p>
  <div class="ev-bars">${bars}</div>
</div>
<div class="a ev-col" id="ev-b" style="left:1020px">
  <p class="ev-big">${film.flagged.flagged} of ${film.flagged.finished}</p>
  <p class="body">finished runs came back “Review needed”, each with a list of what is still missing.</p>
  <ul class="ev-tags">${tags}</ul>
</div>
<p class="a" id="ev-cost">One ${film.original.clipSeconds} s clip: <b>${cost}</b> in API fees and <b>${minutesSeconds(film.original.seconds, "en")}</b> end to end, infrastructure not included.</p>
<p class="src">Evaluation runs of ${esc(dayLabel(film.evaluatedAt))} on openly licensed clips; the default reviewer is the setting Scene ships with.</p>`;
  const render = `
const S = D.S, L = D.L;
reveal($('#ev-head'), prog(t, 0, 0.7));
reveal($('#ev-a'), prog(t, S[0], 0.6));
const n = Math.floor(lin(t, S[0] + 0.6, Math.max(1.5, L[0] - 1.2)) * ${l.written} + 0.001);
$$('.ev-bars i').forEach((el, i) => el.classList.toggle('lit', i < n));
reveal($('#ev-b'), prog(t, S[1], 0.6));
const tags = $$('.ev-tags li');
tags.forEach((el, i) => reveal(el, prog(t, S[1] + 0.8 + i * ((L[1] - 1.2) / tags.length), 0.4), 8));
reveal($('#ev-cost'), prog(t, S[1] + L[1] - 0.2, 0.6));`;
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
