/**
 * "stakes": why now (the Supreme Court ruling and what hand-made description costs), and
 * "constraint": the sample's 65 seconds as Scene sees them (deck slide 4), built up in the order the
 * captions name them: word timings, then the usable silences, then Scene's lines inside them.
 */
import { MIN_GAP_SECONDS, SPEECH_GUARD_SECONDS } from "../../../src/lib/pipeline/gaps";
import { HAND_MADE, LAWSUIT } from "../../deck/facts";
import { thumbTimes } from "../../deck/stills";
import { dayLabel, film } from "../facts";
import { esc, note, pageHtml, pick, secs, STAGE, still, type PageTiming } from "./shell";

const M = STAGE.margin;
/** The lawsuit's steps, in the order of LAWSUIT (filed, then each ruling). */
const EVENT_LABELS = {
  en: ["Lawsuit filed", "First ruling", "Appeal", "Supreme Court"],
  ko: ["소송 제기", "1심", "2심", "대법원"],
};
/**
 * Shares of the ruling sentence: the timeline reaches the Supreme Court (and its date appears) at the
 * first, the finding appears at the second. Two large reveals inside one long sentence keep the page
 * from standing still for more than 4 s (the check note's frozen-picture limit).
 */
const RULING_DATE_AT = 0.4;
const RULING_TEXT_AT = 0.68;
const ST = { head: 52, col: 214, axis: 640 };

const koDay = (d: Date) => `${d.getUTCFullYear()}년 ${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`;

export function stakesPage(timing: PageTiming): string {
  const lang = timing.lang;
  const filed = new Date(LAWSUIT.filed);
  const events = LAWSUIT.events.map((e) => ({ ...e, d: new Date(e.date) }));
  const final = events[events.length - 1];
  const y0 = filed.getUTCFullYear();
  const y1 = final.d.getUTCFullYear();
  const AX = { x0: M, x1: 880, y: ST.axis };
  const yearX = (d: Date) =>
    AX.x0 + ((d.getUTCFullYear() + d.getUTCMonth() / 12 - y0) / (y1 + 1 - y0)) * (AX.x1 - AX.x0);
  const ticks = Array.from({ length: y1 - y0 + 1 }, (_, i) => y0 + i)
    .map(
      (y) => `<div class="a st-tick" style="left:${yearX(new Date(Date.UTC(y, 0, 1)))}px"></div>`,
    )
    .join("");
  const eventLabels = EVENT_LABELS[lang];
  if (events.length !== eventLabels.length - 1)
    throw new Error("the lawsuit has a different number of rulings than the timeline labels");
  const dots = [filed, ...events.map((e) => e.d)]
    .map(
      (d, i) =>
        `<div class="a st-dot${i === events.length ? " last" : ""}" data-x="${yearX(d)}" style="left:${yearX(d) - 8}px"></div>` +
        `<p class="a st-ev${i % 2 ? " low" : ""}" data-x="${yearX(d)}" style="left:${yearX(d)}px">${eventLabels[i]}<br><span>${d.getUTCFullYear()}</span></p>`,
    )
    .join("");
  const years = y1 - y0;
  const caseNo = final.source.replace(/^Supreme Court /, "");
  const people = Array.from({ length: HAND_MADE.specialists }, () => `<i></i>`).join("");
  const won = `${(HAND_MADE.wonMillions * 100).toLocaleString("en-US")}만 원`;
  const css = `
#st-head { left:${M}px; top:${ST.head}px; max-width:1700px; opacity:0; }
.st-col { top:${ST.col}px; width:800px; opacity:0; }
.st-col .label { font-size:28px; font-weight:500; color:var(--ink-300); }
.st-big { font-family:var(--serif); font-size:120px; line-height:1.05; color:var(--ink-100); margin:10px 0 14px; white-space:nowrap; }
html[lang=ko] .st-big { font-size:104px; letter-spacing:-0.02em; }
.st-big small { font-size:60px; color:var(--ink-300); margin-left:18px; }
.st-verdict { font-size:36px; font-weight:600; color:var(--ink-100); }
.st-note { font-size:28px; color:var(--ink-300); }
.st-axis { left:${AX.x0}px; top:${AX.y}px; height:2px; width:0; background:var(--ink-300); }
.st-tick { top:${AX.y - 6}px; width:1px; height:14px; background:var(--tick); opacity:0; }
.st-dot { top:${AX.y - 7}px; width:16px; height:16px; border-radius:50%; background:var(--ink-300); opacity:0; }
.st-dot.last { background:var(--ink-100); box-shadow:0 0 0 6px rgba(236,233,227,.18); }
.st-ev { top:${AX.y - 84}px; transform:translateX(-50%); text-align:center; font-size:24px; line-height:1.3; color:var(--ink-300); white-space:nowrap; opacity:0; }
.st-ev.low { top:${AX.y + 22}px; }
.st-ev span { font-family:var(--mono); color:var(--ink-400); }
.st-people { display:flex; gap:16px; margin-top:34px; }
.st-people i { display:block; width:34px; height:52px; border-radius:17px 17px 6px 6px; border:2px solid var(--ink-400); opacity:.25; }
.st-people i.on { background:var(--ink-300); border-color:var(--ink-300); opacity:1; }`;
  const body = `
<h2 class="a h2" id="st-head">${pick(lang, {
    en: "The law is moving faster than description can be made.",
    ko: "법은 화면해설을 요구하는데, 만드는 속도는 그대로입니다.",
  })}</h2>
<div class="a st-col" id="st-a" style="left:${M}px">
  <p class="label">${pick(lang, {
    en: `Supreme Court of Korea, after a ${years}-year lawsuit`,
    ko: `대법원, ${years}년 소송 끝에`,
  })}</p>
  <p class="st-big">${esc(pick(lang, { en: dayLabel(final.d), ko: koDay(final.d) }))}</p>
  <p class="st-verdict" id="st-ruling">${pick(lang, {
    en: "Discrimination confirmed.",
    ko: "화면해설·자막 없는 상영은 차별.",
  })}</p>
</div>
<div class="a st-axis"></div>${ticks}${dots}
<div class="a st-col" id="st-b" style="left:1020px">
  <p class="label">${pick(lang, { en: "One accessible film, made by hand", ko: "배리어프리 영화 한 편, 손으로 만들면" })}</p>
  <p class="st-big">${pick(lang, {
    en: `${HAND_MADE.months} months<small>₩${HAND_MADE.wonMillions}M</small>`,
    ko: `${HAND_MADE.months}개월<small>${won}</small>`,
  })}</p>
  <p class="st-note">${pick(lang, {
    en: `about ${HAND_MADE.specialists} specialists · about US$${HAND_MADE.usdThousands}k`,
    ko: `전문가 약 ${HAND_MADE.specialists}명`,
  })}</p>
  <div class="st-people">${people}</div>
</div>
${note(
  pick(lang, {
    en: `Sources: Supreme Court ${esc(caseNo)}; Barrier-Free Film Committee; Futurechosun`,
    ko: `출처: 대법원 ${esc(caseNo.replace("Da", "다"))} · 배리어프리영화위원회 · 더나은미래`,
  }),
)}`;
  const render = `
const S = D.S, L = D.L;
reveal($('#st-head'), prog(t, 0, 0.7));
const dateAt = S[0] + L[0] * ${RULING_DATE_AT};
reveal($('#st-a'), prog(t, dateAt, 0.6));
reveal($('#st-ruling'), prog(t, S[0] + L[0] * ${RULING_TEXT_AT}, 0.6));
const draw = lin(t, S[0] + 0.3, Math.max(1, dateAt - S[0] - 0.3));
const head = ${AX.x0} + draw * ${AX.x1 - AX.x0};
$('.st-axis').style.width = (head - ${AX.x0}) + 'px';
$$('.st-tick').forEach((el) => { el.style.opacity = prog(t, S[0] + 0.2, 0.5); });
$$('.st-dot').forEach((el) => { el.style.opacity = head >= Number(el.dataset.x) ? 1 : 0; });
$$('.st-ev').forEach((el) => reveal(el, head >= Number(el.dataset.x) ? 1 : 0, 0));
reveal($('#st-b'), prog(t, S[1], 0.6));
const n = Math.floor(lin(t, S[1] + 0.8, Math.max(1.5, L[1] - 1.5)) * ${HAND_MADE.specialists} + 0.001);
$$('.st-people i').forEach((el, i) => el.classList.toggle('on', i < n));`;
  return pageHtml({ lang, css, body, render, data: timing });
}

/** The camera pushes in this far on the shortest silence while it is named. */
const SHORTEST_ZOOM = 1.12;
/** Every silence is outlined within this share of the sentence that counts them. */
const GAPS_BY = 0.4;
/** Where in that sentence the shortest is named. */
const SHORTEST_AT = 0.6;
const GAP_FADE_S = 0.4;
/** The push-in eases back out over this long once the lines arrive. */
const ZOOM_OUT_S = 0.8;
const C = {
  x0: 330,
  x1: STAGE.w - M,
  thumbs: 196,
  thumbsH: 100,
  dlg: 336,
  dlgH: 64,
  gl: 408,
  lines: 500,
  linesH: 48,
  axis: 578,
  result: 660,
};

export async function constraintPage(timing: PageTiming): Promise<string> {
  const lang = timing.lang;
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
  const shortestWord = pick(lang, { en: "shortest", ko: "가장 짧음" });
  // The hook's silence: 7.2 s between the words on the seven page, less the guard kept clear of them
  // here. Its box says it is the usable part.
  const h = film.hook;
  const hookGap = o.gaps.find((g) => g.start >= h.locked.end && g.end <= h.freaky.start);
  if (!hookGap) throw new Error("no usable silence between the hook's two lines of dialogue");
  const usableWord = pick(lang, { en: "usable", ko: "해설 가능" });
  const gapWord = (id: string) =>
    id === o.shortestId ? shortestWord : id === hookGap.id ? usableWord : null;
  const gaps = o.gaps
    .map((g, i) => {
      const word = gapWord(g.id);
      return (
        `<div class="a ct-gap${g.id === o.shortestId ? " short" : ""}" data-i="${i}" style="left:${x(g.start)}px;top:${C.dlg}px;width:${(g.end - g.start) * pps}px;height:${C.dlgH}px"></div>` +
        `<p class="a ct-gl${g.id === o.shortestId ? " short" : ""}" style="left:${x((g.start + g.end) / 2)}px">${esc(secs(g.seconds, lang))}${word ? `<span>${word}</span>` : ""}</p>`
      );
    })
    .join("");
  const lines = o.lines
    .map(
      (l) =>
        `<div class="room ct-room" style="left:${x(l.start) - C.x0}px;width:${(l.windowEnd - l.start) * pps}px"></div>` +
        `<div class="clip ad ct-bar" data-w="${l.voiced * pps}" style="left:${x(l.start) - C.x0}px;width:0"></div>`,
    )
    .join("");
  const shortest = o.gaps.find((g) => g.id === o.shortestId);
  if (!shortest) throw new Error(`shortest gap ${o.shortestId} is not among the gaps`);
  const ticks = [0, 10, 20, 30, 40, 50, 60]
    .map(
      (s) =>
        `<div class="a ct-tick" style="left:${x(s)}px"></div><p class="a ct-t" style="left:${x(s)}px">${s}</p>`,
    )
    .join("");
  const css = `
#ct-head { left:${M}px; top:52px; max-width:1720px; opacity:0; }
.ct-thumb { opacity:0; }
.ct-row { left:${M}px; width:${C.x0 - M - 20}px; opacity:0; }
.ct-row .label { font-size:26px; line-height:1.25; white-space:nowrap; }
.ct-row small { display:block; font-size:24px; color:var(--ink-400); }
.ct-lane { left:${C.x0}px; width:${C.x1 - C.x0}px; }
#ct-speech { top:${C.dlg}px; height:${C.dlgH}px; clip-path:inset(0 100% 0 0); }
.ct-gap { background:rgba(236,233,227,.1); box-shadow:inset 0 0 0 2px rgba(236,233,227,.55); border-radius:3px; opacity:0; }
.ct-gl { top:${C.gl}px; transform:translateX(-50%); transform-origin:50% 0; font-family:var(--mono); font-size:26px; color:var(--ink-300); white-space:nowrap; text-align:center; opacity:0; }
.ct-gl.short { color:var(--ink-100); }
.ct-gl span { display:block; font-family:var(--sans); font-size:24px; color:var(--ink-300); }
.ct-room { opacity:0; }
#ct-play { top:${C.thumbs - 16}px; width:2px; height:${C.axis - C.thumbs + 16}px; background:var(--ink-100); opacity:0; }
#ct-chip { top:${C.thumbs - 58}px; font-size:26px; font-weight:600; color:var(--screen); background:var(--ink-100); padding:4px 12px; border-radius:4px; white-space:nowrap; opacity:0; }
.ct-axis { left:${C.x0}px; top:${C.axis}px; width:${C.x1 - C.x0}px; height:2px; background:var(--rule); }
.ct-tick { top:${C.axis}px; width:1px; height:12px; background:var(--tick); }
.ct-t { top:${C.axis + 16}px; transform:translateX(-50%); font-family:var(--mono); font-size:24px; color:var(--ink-400); }
#ct-result { left:${M}px; top:${C.result}px; font-size:32px; color:var(--ink-300); opacity:0; }
#ct-result b { font-family:var(--serif); font-weight:400; font-size:56px; color:var(--ink-100); vertical-align:-6px; }`;
  const row = (top: number, label: string, small?: string) =>
    `<div class="a ct-row" style="top:${top}px"><p class="label">${label}</p>${small ? `<small>${small}</small>` : ""}</div>`;
  const body = `
<h2 class="a h2" id="ct-head">${pick(lang, {
    en: "Every line has to fit a silence that is already in the film.",
    ko: "모든 문장은 영화에 이미 있는 침묵에 들어가야 합니다.",
  })}</h2>
${thumbs}
${row(C.thumbs + 34, pick(lang, { en: "Picture", ko: "화면" }))}
${row(
  C.dlg,
  `${pick(lang, { en: "Dialogue", ko: "대사" })} <span class="muted">${esc(secs(o.speechTotal, lang))}</span>`,
  pick(lang, { en: `silences ${secs(o.gapTotal, lang)}`, ko: `침묵 ${secs(o.gapTotal, lang)}` }),
)}
${row(
  C.lines - 6,
  pick(lang, { en: "Scene’s lines", ko: "씬의 문장" }),
  pick(lang, {
    en: `${secs(o.narrationTotal, lang)} of voice`,
    ko: `낭독 ${secs(o.narrationTotal, lang)}`,
  }),
)}
<div class="lane a ct-lane" style="top:${C.dlg}px;height:${C.dlgH}px"></div>
<div class="a ct-lane" id="ct-speech">${speech}</div>
${gaps}
<div class="lane a ct-lane" style="top:${C.lines}px;height:${C.linesH}px">${lines}</div>
<div class="a ct-axis"></div>${ticks}<p class="a ct-t" style="left:${x(o.clip)}px">${pick(lang, { en: `${o.clip} s`, ko: `${o.clip}초` })}</p>
<div class="a" id="ct-play"></div><p class="a" id="ct-chip">Speech-to-Text · Chirp 3</p>
<p class="a" id="ct-result">${pick(lang, {
    en: `<b>${o.lines.length}</b> lines, <b>${o.narrationTotal.toFixed(1)}</b> s of voice, none over recognized speech`,
    ko: `<b>${o.lines.length}</b>문장, 낭독 <b>${o.narrationTotal.toFixed(1)}</b>초, 인식된 대사와 겹침 없음`,
  })}</p>
${note(
  pick(lang, {
    en: `A usable silence lasts at least ${MIN_GAP_SECONDS} s and keeps ${SPEECH_GUARD_SECONDS} s clear of speech.`,
    ko: `해설이 들어갈 침묵: ${MIN_GAP_SECONDS}초 이상, 대사와 ${SPEECH_GUARD_SECONDS}초 이상 떨어진 구간`,
  }),
)}`;
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
// Every silence is outlined early in the sentence that counts them, one after another.
const n = $$('.ct-gap').length;
const step = Math.max(0, L[1] * ${GAPS_BY} - 0.2 - ${GAP_FADE_S}) / Math.max(1, n - 1);
const gapAt = (i) => S[1] + 0.2 + i * step;
$$('.ct-gap').forEach((el, i) => { el.style.opacity = prog(t, gapAt(i), ${GAP_FADE_S}); });
$$('.ct-gl').forEach((el, i) => { el.style.opacity = prog(t, gapAt(i), ${GAP_FADE_S}); });
const mark = prog(t, S[1] + L[1] * ${SHORTEST_AT}, 0.5);
$('.ct-gl.short span').style.opacity = mark;
$('.ct-gl.short').style.transform = 'translateX(-50%) scale(' + (1 + 0.3 * mark) + ')';
$('.ct-gap.short').style.boxShadow = 'inset 0 0 0 ' + (2 + 2 * mark) + 'px rgba(236,233,227,' + (0.55 + 0.45 * mark) + ')';
// A push-in on the shortest silence while it is named, back out as the lines arrive.
const zoom = prog(t, S[1] + L[1] * ${SHORTEST_AT}, 0.9) * (1 - prog(t, S[2], ${ZOOM_OUT_S}));
const stage = $('.stage');
stage.style.transformOrigin = '${x((shortest.start + shortest.end) / 2)}px ${C.dlg}px';
stage.style.transform = 'scale(' + (1 + ${(SHORTEST_ZOOM - 1).toFixed(2)} * zoom) + ')';
$$('.ct-room').forEach((el, i) => { el.style.opacity = prog(t, S[2] + i * 0.12, 0.4); });
$$('.ct-bar').forEach((el, i) => { el.style.width = Number(el.dataset.w) * prog(t, S[2] + 0.3 + i * 0.18, 0.7) + 'px'; });
reveal($('#ct-result'), prog(t, S[2] + 1.4, 0.6));
// The footnote waits for the push-in to ease back: pushed in, it would sit half under the captions.
$('.src').style.opacity = prog(t, S[2] + ${ZOOM_OUT_S}, 0.6);`;
  return pageHtml({ lang, css, body, render, data: timing });
}
