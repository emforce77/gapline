/**
 * "next": the deck's two closing sections in one page. Left, who we expect to pay (the deck's
 * business slide) and what description costs per minute today, as published (PRICE_POINTS in
 * scripts/deck/facts.ts, drawn on a log scale). Right, what we test next and how (the deck's next
 * slide). Gapline's own price is not claimed: the prototype has none yet.
 */
import type { Language } from "../../../src/lib/pipeline/schemas";
import { film } from "../facts";
import { esc, note, pageHtml, pick, STAGE, type PageTiming } from "./shell";

const M = STAGE.margin;
const COL = { w: 804, left: M, right: STAGE.w - M - 804, top: 196 };
/** Price bars: labels on the left, a log scale from $0.10 to $100 a minute on the right. */
const PRICE = { top: 470, pitch: 78, label: 390, lo: 0.1, hi: 100 };

const PRICE_WHO: Record<Language, string[]> = {
  en: film.prices.map((p) => p.who),
  ko: ["사람 작가·성우", "사람 작가·합성 목소리", "AI 업체 MediaScribe"],
};
const PLAN: Record<Language, [string, string][]> = {
  en: [
    ["Blind and low-vision viewers find the lines useful", "Listening sessions with them"],
    [
      "Describers would ship the automatic track",
      "They review automatic tracks and count the lines they would change",
    ],
    [
      "It carries to other Asia-Pacific languages",
      "One guideline and voice per language, reviewed by native describers",
    ],
  ],
  ko: [
    ["시각장애인·저시력 관객에게 쓸모 있는가", "관객과 함께 듣는 청취 세션"],
    ["해설 작가가 자동 트랙을 그대로 내보낼까", "자동 트랙을 검토하고 고칠 문장 수를 셈"],
    ["다른 아시아·태평양 언어로 넓힐 수 있나", "언어마다 가이드라인과 목소리, 원어민 작가 검토"],
  ],
};

const money = (x: number) => (x < 1 ? `$${x.toFixed(2)}` : `$${x % 1 ? x.toFixed(2) : x}`);

export function nextPage(timing: PageTiming): string {
  const lang = timing.lang;
  if (PRICE_WHO.ko.length !== film.prices.length)
    throw new Error("the Korean price labels no longer match the deck's prices");
  const barX0 = COL.left + PRICE.label;
  const barW = COL.w - PRICE.label;
  const px = (usd: number) =>
    barX0 + (Math.log10(usd / PRICE.lo) / Math.log10(PRICE.hi / PRICE.lo)) * barW;
  const prices = film.prices
    .map((p, i) => {
      const y = PRICE.top + i * PRICE.pitch;
      const range = p.low === p.high ? money(p.low) : `${money(p.low)}–${money(p.high)}`;
      const width = Math.max(10, px(p.high) - px(p.low));
      return (
        `<p class="a nx-pw" data-i="${i}" style="left:${COL.left}px;top:${y - 4}px;width:${PRICE.label - 20}px">${esc(PRICE_WHO[lang][i])}</p>` +
        `<div class="a nx-pb" data-i="${i}" style="left:${px(p.low)}px;top:${y + 4}px;width:${width}px"></div>` +
        `<p class="a nx-pv" data-i="${i}" style="left:${px(p.low)}px;top:${y + 26}px">${esc(range)}</p>`
      );
    })
    .join("");
  const axisY = PRICE.top + film.prices.length * PRICE.pitch + 6;
  const ticks = [0.1, 1, 10, 100]
    .map(
      (usd) =>
        `<div class="a nx-tick" style="left:${px(usd)}px;top:${axisY}px"></div><p class="a nx-t" style="left:${px(usd)}px;top:${axisY + 14}px">${money(usd)}</p>`,
    )
    .join("");
  const plan = PLAN[lang]
    .map(
      ([what, how], i) =>
        `<div class="a nx-plan" data-i="${i}" style="left:${COL.right}px;top:${COL.top + 70 + i * 150}px"><p>${esc(what)}</p><p>${esc(how)}</p></div>`,
    )
    .join("");
  const css = `
#nx-head { left:${M}px; top:52px; max-width:1740px; opacity:0; }
.nx-label { font-size:28px; font-weight:600; color:var(--ink-300); opacity:0; }
#nx-who { left:${COL.left}px; top:${COL.top + 50}px; width:${COL.w}px; opacity:0; }
#nx-who p:first-child { font-size:40px; font-weight:600; line-height:1.2; color:var(--ink-100); }
#nx-who p + p { margin-top:10px; font-size:26px; color:var(--ink-400); }
#nx-pl { left:${COL.left}px; top:${PRICE.top - 60}px; font-size:24px; color:var(--ink-300); opacity:0; }
.nx-pw { font-size:24px; line-height:1.2; color:var(--ink-100); opacity:0; }
.nx-pb { height:14px; background:var(--ink-300); border-radius:3px; opacity:0; }
.nx-pv { font-family:var(--mono); font-size:22px; color:var(--ink-300); white-space:nowrap; opacity:0; }
.nx-tick { width:1px; height:10px; background:var(--tick); opacity:0; }
.nx-t { transform:translateX(-50%); font-family:var(--mono); font-size:20px; color:var(--ink-400); opacity:0; }
#nx-axis { left:${barX0}px; top:${axisY}px; width:${barW}px; height:1px; background:var(--tick); opacity:0; }
.nx-plan { width:${COL.w}px; padding-top:18px; border-top:1px solid var(--rule); opacity:0; }
.nx-plan p:first-child { font-size:32px; font-weight:600; line-height:1.25; color:var(--ink-100); }
.nx-plan p + p { margin-top:10px; font-size:26px; line-height:1.3; color:var(--ink-300); }`;
  const body = `
<h2 class="a h2" id="nx-head">${pick(lang, {
    en: "Who would pay, and what we test next.",
    ko: "누가 비용을 낼지, 그리고 다음에 검증할 것.",
  })}</h2>
<p class="a nx-label" id="nx-l1" style="left:${COL.left}px;top:${COL.top}px">${pick(lang, { en: "Would pay", ko: "비용을 낼 곳" })}</p>
<div class="a" id="nx-who"><p>${pick(lang, {
    en: "Film distributors and streaming services",
    ko: "영화 배급사와 스트리밍 서비스",
  })}</p><p>${pick(lang, {
    en: "whoever supplies a film’s description file",
    ko: "영화의 화면해설 파일을 공급하는 곳",
  })}</p></div>
<p class="a" id="nx-pl">${pick(lang, {
    en: "What description costs per minute today",
    ko: "지금 화면해설에 드는 분당 비용",
  })}</p>
${prices}
<div class="a" id="nx-axis"></div>${ticks}
<p class="a nx-label" id="nx-l2" style="left:${COL.right}px;top:${COL.top}px">${pick(lang, { en: "Next", ko: "다음 검증" })}</p>
${plan}
${note(
  pick(lang, {
    en: "Prices: 3Play Media, 2022; UW–Madison contract, 2026; mediascribe.ai",
    ko: "가격: 3Play Media 2022년 · UW–Madison 계약 2026년 · mediascribe.ai",
  }),
)}`;
  const render = `
const S = D.S, L = D.L;
reveal($('#nx-head'), prog(t, 0, 0.7));
reveal($('#nx-l1'), prog(t, S[0], 0.6));
reveal($('#nx-who'), prog(t, S[0] + 0.2, 0.7), 10);
const pricesAt = S[0] + L[0] * 0.45;
$('#nx-pl').style.opacity = prog(t, pricesAt, 0.6);
['#nx-axis'].forEach((s) => { $(s).style.opacity = prog(t, pricesAt, 0.6); });
$$('.nx-tick, .nx-t').forEach((el) => { el.style.opacity = prog(t, pricesAt, 0.6); });
$$('.nx-pw, .nx-pb, .nx-pv').forEach((el) => { el.style.opacity = prog(t, pricesAt + 0.3 + Number(el.dataset.i) * 0.35, 0.5); });
reveal($('#nx-l2'), prog(t, S[1], 0.6));
$$('.nx-plan').forEach((el) => reveal(el, prog(t, S[1] + 0.3 + Number(el.dataset.i) * (L[1] * 0.25), 0.6), 10));`;
  return pageHtml({ lang, css, body, render, data: timing });
}
