/**
 * "checks": the deck's performance report (slide "Gapline's checks caught what a word count would
 * miss"), told in two cases built up in the order the captions name them. Left, a line from another
 * scene of the film: its word-count estimate fits the room, its real voice and its shortened, faster
 * take do not, and it is dropped. Right, the launch call under the music: the first listen missed it
 * and a line was laid over it; the second listen hears it and the silence is closed. Numbers come
 * from the deck's checked data (scripts/deck/data/city.ts, recognizers.ts) through facts.ts.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { SPECTROGRAMS, STILLS } from "../../deck/paths";
import { PAGES_DIR } from "../config";
import { film } from "../facts";
import { esc, note, pageHtml, pick, secs, STAGE, type PageTiming } from "./shell";

const M = STAGE.margin;
/** Two columns of the same width either side of the page's middle. */
const COL = { w: 804, left: M, right: STAGE.w - M - 804, top: 196 };
/** The newspaper's chart: a label column, then bars on a 0–4.8 s scale. */
const BARS = { label: 300, top: 628, pitch: 56, h: 18, span: 4.8 };
/** The launch call: a label column, then the sound and two listening lanes on 0–11 s. */
const CALL = { label: 176, sound: 300, soundH: 164, once: 510, twice: 610, axis: 700, span: 11 };

async function copyAsset(from: string, name: string): Promise<string> {
  const rel = `assets/checks/${name}`;
  await mkdir(join(PAGES_DIR, "assets/checks"), { recursive: true });
  await copyFile(from, join(PAGES_DIR, rel));
  return rel;
}

export async function checksPage(timing: PageTiming): Promise<string> {
  const lang = timing.lang;
  const news = film.newspaper;
  const call = film.launchCall;
  const newsStill = await copyAsset(join(STILLS, "news.jpg"), "news.jpg");
  const sound = await copyAsset(join(SPECTROGRAMS, "launch-call.png"), "launch-call.png");

  const barW = COL.w - BARS.label;
  const bx = (s: number) => COL.left + BARS.label + (s / BARS.span) * barW;
  const rows = [
    {
      id: "estimate",
      label: pick(lang, { en: "Word count", ko: "단어 수 추정" }),
      s: news.estimate,
    },
    { id: "voiced", label: pick(lang, { en: "Real voice", ko: "실제 낭독" }), s: news.voiced },
    {
      id: "shortened",
      label: pick(lang, { en: "Shortened, faster", ko: "줄여서 빠르게" }),
      s: news.shortened,
    },
  ];
  const bars = rows
    .map(
      (r, i) =>
        `<p class="a ck-rl" id="ck-rl-${r.id}" style="left:${COL.left}px;top:${BARS.top + i * BARS.pitch - 8}px">${r.label} <b>${esc(secs(r.s, lang))}</b></p>` +
        `<div class="a ck-bar ${r.id === "estimate" ? "paper" : "voice"}" id="ck-bar-${r.id}" data-w="${bx(r.s) - bx(0)}" style="left:${bx(0)}px;top:${BARS.top + i * BARS.pitch}px;height:${BARS.h}px"></div>`,
    )
    .join("");
  const roomX = bx(news.room);
  const chartBottom = BARS.top + 2 * BARS.pitch + BARS.h;

  const laneW = COL.w - CALL.label;
  const lx = (s: number) => COL.right + CALL.label + (s / CALL.span) * laneW;
  const span = (a: number, b: number) => `left:${lx(a)}px;width:${lx(b) - lx(a)}px`;
  const ticks = [0, 5, 10]
    .map(
      (s) =>
        `<div class="a ck-tick" style="left:${lx(s)}px"></div><p class="a ck-t" style="left:${lx(s)}px">${esc(pick(lang, { en: `${s} s`, ko: `${s}초` }))}</p>`,
    )
    .join("");

  const css = `
#ck-head { left:${M}px; top:52px; max-width:1740px; opacity:0; }
.ck-label { font-size:28px; font-weight:600; color:var(--ink-300); opacity:0; }
#ck-news { left:${COL.left}px; top:${COL.top + 50}px; width:${COL.w}px; height:${Math.round((COL.w * 800) / 1920)}px; opacity:0; }
.ck-rl { font-size:24px; color:var(--ink-300); white-space:nowrap; opacity:0; }
.ck-rl b { font-weight:600; color:var(--ink-100); margin-left:6px; }
.ck-bar { width:0; border-radius:4px; }
.ck-bar.paper { border:2px dashed var(--ink-400); }
.ck-bar.voice { background:var(--amber); }
.ck-bar.struck { background:var(--amber-room); }
#ck-room { left:${roomX}px; top:${BARS.top - 34}px; height:${chartBottom - BARS.top + 44}px; border-left:2px dashed var(--ink-100); opacity:0; }
#ck-rooml { left:${roomX + 10}px; top:${BARS.top - 46}px; font-size:24px; color:var(--ink-100); white-space:nowrap; opacity:0; }
.ck-strike { height:2px; background:var(--ink-100); width:0; }
#ck-drop { left:${COL.left}px; top:${chartBottom + 30}px; font-size:26px; font-weight:600; color:var(--ink-100); white-space:nowrap; opacity:0; }
#ck-sound { left:${lx(0)}px; top:${CALL.sound}px; width:${laneW}px; height:${CALL.soundH}px; opacity:0; }
.ck-ll { font-size:24px; font-weight:600; color:var(--ink-300); white-space:nowrap; opacity:0; }
.ck-lane { left:${lx(0)}px; width:${laneW}px; height:30px; background:var(--lane); border-radius:4px; opacity:0; }
.ck-speech { height:30px; background:var(--dialogue); border-radius:4px; opacity:0; }
.ck-gap { height:38px; border:2px dashed var(--ink-400); border-radius:4px; opacity:0; }
.ck-over { height:14px; background:var(--amber); border-radius:3px; opacity:0; }
.ck-ln { font-size:24px; color:var(--ink-100); white-space:nowrap; opacity:0; }
.ck-tick { top:${CALL.axis}px; width:1px; height:12px; background:var(--tick); }
.ck-t { top:${CALL.axis + 16}px; transform:translateX(-50%); font-family:var(--mono); font-size:22px; color:var(--ink-400); }
#ck-axis { left:${lx(0)}px; top:${CALL.axis}px; width:${laneW}px; height:1px; background:var(--tick); }
#ck-call { top:${CALL.sound - 8}px; height:${CALL.soundH + 16}px; border:2px solid var(--ink-100); border-radius:6px; opacity:0; }
#ck-calll { top:${CALL.sound - 44}px; font-size:24px; color:var(--ink-100); white-space:nowrap; opacity:0; }`;
  const body = `
<h2 class="a h2" id="ck-head">${pick(lang, {
    en: "The checks catch what a word count would miss.",
    ko: "단어 수로는 놓칠 것을 점검이 잡아냅니다.",
  })}</h2>
<p class="a ck-label" id="ck-nl" style="left:${COL.left}px;top:${COL.top}px">${pick(lang, {
    en: "The voice ran long",
    ko: "낭독이 길어진 문장",
  })}</p>
<img class="a still" id="ck-news" src="${newsStill}" alt="">
${bars}
<div class="a" id="ck-room"></div>
<p class="a" id="ck-rooml">${pick(lang, { en: "Room", ko: "자리" })} ${esc(secs(news.room, lang))}</p>
<div class="a ck-strike" id="ck-strike-voiced" style="left:${bx(0)}px;top:${BARS.top + BARS.pitch + BARS.h / 2 - 1}px" data-w="${bx(news.voiced) - bx(0)}"></div>
<div class="a ck-strike" id="ck-strike-shortened" style="left:${bx(0)}px;top:${BARS.top + 2 * BARS.pitch + BARS.h / 2 - 1}px" data-w="${bx(news.shortened) - bx(0)}"></div>
<p class="a" id="ck-drop">${pick(lang, {
    en: "Dropped rather than run into the next line",
    ko: "다음 문장을 침범하지 않도록 뺐습니다",
  })}</p>
<p class="a ck-label" id="ck-cl" style="left:${COL.right}px;top:${COL.top}px">${pick(lang, {
    en: "The first listen missed the launch call",
    ko: "처음 들을 때 놓친 발사 교신",
  })}</p>
<p class="a ck-ll" id="ck-sl" style="left:${COL.right}px;top:${CALL.sound + CALL.soundH / 2 - 16}px">${pick(lang, { en: "Sound", ko: "소리" })}</p>
<img class="a" id="ck-sound" src="${sound}" alt="">
<div class="a" id="ck-call" style="${span(call.relisten.start, call.relisten.end)}"></div>
<p class="a" id="ck-calll" style="left:${lx(call.relisten.start)}px">“${esc(call.relisten.text)}”</p>
<p class="a ck-ll" id="ck-l1" style="left:${COL.right}px;top:${CALL.once - 2}px">${pick(lang, { en: "Heard once", ko: "한 번 듣기" })}</p>
<div class="a ck-lane" id="ck-lane1" style="top:${CALL.once}px"></div>
<div class="a ck-speech" id="ck-sp1" style="top:${CALL.once}px;${span(call.firstListen.start, call.firstListen.end)}"></div>
<div class="a ck-gap" id="ck-gap" style="top:${CALL.once - 4}px;${span(call.silence.start, call.silence.end)}"></div>
<div class="a ck-over" id="ck-over" style="top:${CALL.once + 8}px;${span(call.lineOverCall.start, call.lineOverCall.start + call.lineOverCall.voiced)}"></div>
<p class="a ck-ln" id="ck-n1" style="left:${lx(call.silence.start)}px;top:${CALL.once + 42}px">${pick(
    lang,
    {
      en: "a line laid over the call",
      ko: "교신 위에 문장이 들어감",
    },
  )}</p>
<p class="a ck-ll" id="ck-l2" style="left:${COL.right}px;top:${CALL.twice - 2}px">${pick(lang, { en: "Heard twice", ko: "두 번 듣기" })}</p>
<div class="a ck-lane" id="ck-lane2" style="top:${CALL.twice}px"></div>
<div class="a ck-speech" id="ck-sp2" style="top:${CALL.twice}px;${span(call.relisten.start, call.relisten.end)}"></div>
<p class="a ck-ln" id="ck-n2" style="left:${lx(call.relisten.start)}px;top:${CALL.twice + 42}px">${pick(
    lang,
    {
      en: "heard; no line written there",
      ko: "들었으니 문장을 넣지 않음",
    },
  )}</p>
<div class="a" id="ck-axis"></div>${ticks}
${note(
  pick(lang, {
    en: `Tears of Steel: the headline at ${news.filmTime.toFixed(1)} s; the launch call in the first ${CALL.span} s`,
    ko: `Tears of Steel: ${news.filmTime.toFixed(1)}초의 신문 헤드라인, 처음 ${CALL.span}초의 발사 교신`,
  }),
)}`;
  const render = `
const S = D.S, L = D.L;
reveal($('#ck-head'), prog(t, 0, 0.7));
// 1. The line on paper: its still, the room and the word-count estimate inside it.
reveal($('#ck-nl'), prog(t, S[0], 0.6));
reveal($('#ck-news'), prog(t, S[0] + 0.2, 0.7), 10);
const roomP = prog(t, S[0] + L[0] * 0.45, 0.6);
$('#ck-room').style.opacity = roomP; $('#ck-rooml').style.opacity = roomP;
const grow = (id, at, dur) => { const el = $('#ck-bar-' + id); el.style.width = (Number(el.dataset.w) * prog(t, at, dur)) + 'px'; $('#ck-rl-' + id).style.opacity = prog(t, at - 0.2, 0.5); };
grow('estimate', S[0] + L[0] * 0.55, 0.9);
// 2. Voiced, it ran long; shortened and faster, still long.
grow('voiced', S[1] + 0.2, 1.1);
grow('shortened', S[1] + L[1] * 0.55, 1.0);
// 3. Dropped.
$$('.ck-strike').forEach((el, i) => { el.style.width = (Number(el.dataset.w) * prog(t, S[2] + 0.3 + i * 0.25, 0.6)) + 'px'; });
$$('.ck-bar.voice').forEach((el) => el.classList.toggle('struck', t >= S[2] + 0.6));
reveal($('#ck-drop'), prog(t, S[2] + 0.9, 0.6), 8);
// 4. The launch call, heard once: a silence over it and a line laid there.
reveal($('#ck-cl'), prog(t, S[3], 0.6));
$('#ck-sound').style.opacity = prog(t, S[3] + 0.2, 0.8); $('#ck-sl').style.opacity = prog(t, S[3] + 0.2, 0.8);
$('#ck-axis').style.opacity = prog(t, S[3] + 0.2, 0.8); $$('.ck-tick, .ck-t').forEach((el) => { el.style.opacity = prog(t, S[3] + 0.2, 0.8); });
['#ck-l1', '#ck-lane1', '#ck-sp1'].forEach((s) => { $(s).style.opacity = prog(t, S[3] + L[3] * 0.3, 0.6); });
$('#ck-gap').style.opacity = prog(t, S[3] + L[3] * 0.5, 0.6);
$('#ck-over').style.opacity = prog(t, S[3] + L[3] * 0.7, 0.5);
$('#ck-n1').style.opacity = prog(t, S[3] + L[3] * 0.7 + 0.3, 0.5);
// 5. Heard twice: the call found, and no line written there.
['#ck-l2', '#ck-lane2', '#ck-sp2'].forEach((s) => { $(s).style.opacity = prog(t, S[4], 0.6); });
$('#ck-call').style.opacity = prog(t, S[4] + 0.4, 0.6); $('#ck-calll').style.opacity = prog(t, S[4] + 0.6, 0.6);
$('#ck-n2').style.opacity = prog(t, S[4] + L[4] * 0.5, 0.6);`;
  return pageHtml({ lang, css, body, render, data: timing });
}
