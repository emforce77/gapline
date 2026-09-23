/**
 * "evidence": what the evaluation runs and the sample measured, with the sample's reused hearing and
 * watching disclosed under its figures. "close": Scene's name set between the two lines of dialogue
 * from the hook (the caption says the tagline, so the card does not repeat it), and where to try it:
 * the live URL, and the code once it is public.
 */
import { SUBMISSION } from "../../deck/facts";
import { film, minutesSeconds } from "../facts";
import { labels } from "../labels";
import { esc, note, pageHtml, pick, STAGE, type PageTiming } from "./shell";

const M = STAGE.margin;
const EV = { head: 52, col: 206 };
/**
 * The sample's figures come in one after another this far apart, from just after the caption that
 * names the sample starts: all of them are in within about a second, so the last is read as long as
 * the first (spread over the whole caption, the fourth was up for only 1.3 s).
 */
const FACT_STEP_S = 0.25;
const FACT_FADE_S = 0.4;
/** The page is read for seconds once every figure is in: it drifts this much closer meanwhile. */
const EV_DRIFT = 0.02;

export function evidencePage(timing: PageTiming): string {
  const lang = timing.lang;
  const l = film.loops;
  const o = film.original;
  const f = film.finalFix;
  const a = film.analysis;
  // "each inside its silence" is printed only while every line of the sample fits its window.
  if (!film.opening.lines.every((x) => x.start + x.voiced <= x.windowEnd))
    throw new Error("a line of the sample runs past its silence; the evidence page says none does");
  if (film.opening.lines.length !== o.lines)
    throw new Error("the sample's line count and its lines disagree");
  const bars = (on: number, all: number) =>
    Array.from({ length: all }, (_, i) => `<i class="${i < on ? "on" : "off"}"></i>`).join("");
  const cost = o.costUsd.toFixed(2);
  const took = minutesSeconds(o.seconds, lang);
  const facts = pick(lang, {
    en: [
      `<b>${o.lines}</b> lines, each inside its silence`,
      `<b>${took}</b> from writing to mix`,
      `<b>$${cost}</b> in API fees`,
      `<b>${f.rewritten}</b> ${f.rewritten === 1 ? "line" : "lines"} rewritten after the final check`,
      ...(f.added ? [`<b>${f.added}</b> ${f.added === 1 ? "line" : "lines"} added after it`] : []),
    ],
    ko: [
      `<b>${o.lines}</b>문장, 모두 침묵 안에`,
      `<b>${took}</b>쓰기부터 믹스까지`,
      `<b>${cost}달러</b>API 비용`,
      `<b>${f.rewritten}</b>문장, 최종 점검 뒤 다시 씀`,
      ...(f.added ? [`<b>${f.added}</b>문장, 최종 점검 뒤 더함`] : []),
    ],
  })
    .map((x) => `<li>${x}</li>`)
    .join("");
  // The sample's figures leave out the hearing and watching it reused: said under them (decision 3).
  const reuse = o.analysisReused
    ? note(
        pick(lang, {
          en: `Hearing and watching came from an earlier run of the same clip (+$${a.costUsd.toFixed(2)}, ${Math.round(a.seconds)} s).`,
          ko: `듣기와 보기는 같은 클립의 이전 실행 결과를 썼습니다(+${a.costUsd.toFixed(2)}달러, ${Math.round(a.seconds)}초).`,
        }),
      )
    : "";
  const css = `
#ev-head { left:${M}px; top:${EV.head}px; opacity:0; }
.ev-col { top:${EV.col}px; width:800px; opacity:0; }
.ev-col .label { font-size:28px; font-weight:500; color:var(--ink-300); }
.ev-big { font-family:var(--serif); font-size:120px; line-height:1; color:var(--ink-100); margin-top:12px; }
.ev-col p.body { margin-top:20px; font-size:30px; line-height:1.4; color:var(--ink-300); }
.ev-bars { display:flex; gap:8px; margin-top:30px; }
.ev-bars i { display:block; width:30px; height:44px; border-radius:3px; border:2px solid var(--amber-room); }
.ev-bars i.on.lit { background:var(--amber); border-color:var(--amber); }
.ev-bars i.off.lit { border-color:var(--ink-400); border-style:dashed; }
.ev-facts { list-style:none; margin-top:22px; display:grid; gap:14px; }
.ev-facts li { font-size:30px; color:var(--ink-300); opacity:0; white-space:nowrap; }
.ev-facts b { font-family:var(--serif); font-weight:400; font-size:58px; color:var(--ink-100); margin-right:12px; vertical-align:-6px; }`;
  const body = `
<h2 class="a h2" id="ev-head">${pick(lang, {
    en: "Measured on the runs themselves.",
    ko: "실행 기록에서 직접 잰 숫자.",
  })}</h2>
<div class="a ev-col" id="ev-a" style="left:${M}px">
  <p class="label">${pick(lang, { en: `${l.runs} finished test runs`, ko: `끝까지 마친 시험 실행 ${l.runs}회` })}</p>
  <p class="ev-big">${pick(lang, { en: `${l.voiced} of ${l.written}`, ko: `${l.voiced} / ${l.written}` })}</p>
  <p class="body">${pick(lang, {
    en: "lines made it into the finished tracks",
    ko: "문장이 완성 트랙에 들어감",
  })}</p>
  <div class="ev-bars" id="ev-bars-a">${bars(l.voiced, l.written)}</div>
</div>
<div class="a ev-col" id="ev-b" style="left:1020px">
  <p class="label">${pick(lang, { en: "The sample", ko: "샘플" })}</p>
  <ul class="ev-facts">${facts}</ul>
</div>
${reuse}`;
  const render = `
const S = D.S, L = D.L;
const stage = $('.stage');
stage.style.transformOrigin = '50% 45%';
stage.style.transform = 'scale(' + (1 + ${EV_DRIFT} * ease(t / D.T)) + ')';
reveal($('#ev-head'), prog(t, 0, 0.7));
reveal($('#ev-a'), prog(t, S[0], 0.6));
const n = Math.floor(lin(t, S[0] + 0.6, Math.max(1.5, L[0] - 1.2)) * ${l.written} + 0.001);
$$('#ev-bars-a i').forEach((el, i) => el.classList.toggle('lit', i < n));
reveal($('#ev-b'), prog(t, S[1] - 0.2, 0.5), 0);
const facts = $$('.ev-facts li');
facts.forEach((el, i) => reveal(el, prog(t, S[1] + i * ${FACT_STEP_S}, ${FACT_FADE_S}), 8));
if ($('.src')) $('.src').style.opacity = prog(t, S[1] + 0.6, 0.6);`;
  return pageHtml({ lang, css, body, render, data: timing });
}

/** The product's name: English in both films, like the other product names. */
const NAME = "Scene";

export function closePage(timing: PageTiming): string {
  const lang = timing.lang;
  const h = film.hook;
  const ko = labels(lang).dialogueKo;
  const url = new URL(film.service);
  const repo = SUBMISSION.repoUrl;
  const dialogue = (en: string, translated?: string) =>
    `<p class="cz-dlg">${esc(en)}${translated ? `<span lang="ko">${esc(translated)}</span>` : ""}</p>`;
  const css = `
#cz-top { position:absolute; left:0; top:132px; width:${STAGE.w}px; display:flex; flex-direction:column; align-items:center; gap:30px; text-align:center; }
.cz-dlg { font-size:36px; font-weight:500; color:var(--ink-300); opacity:0; }
.cz-dlg span { display:block; margin-top:6px; font-size:28px; color:var(--ink-400); }
#cz-name { font-family:var(--serif); font-style:italic; font-size:150px; line-height:1; color:var(--amber); letter-spacing:-0.01em; opacity:0; }
#cz-try { position:absolute; left:0; width:${STAGE.w}px; top:560px; display:flex; flex-direction:column; align-items:center; gap:10px; }
#cz-try .label { font-size:28px; color:var(--ink-300); opacity:0; }
#cz-url { font-size:44px; font-weight:500; color:var(--ink-100); text-decoration:underline; text-decoration-color:var(--tick); text-underline-offset:10px; opacity:0; }
#cz-repo { margin-top:8px; font-size:28px; color:var(--ink-300); opacity:0; }
#cz-credit { position:absolute; left:0; width:${STAGE.w}px; top:772px; text-align:center; font-size:24px; line-height:1.4; color:var(--ink-400); opacity:0; }`;
  const body = `
<div id="cz-top">
  ${dialogue(`…${h.locked.text}`, ko?.locked)}
  <p id="cz-name">${NAME}</p>
  ${dialogue(h.freaky.text, ko?.freaky)}
</div>
<div id="cz-try">
  <p class="label">${pick(lang, { en: "Live demo", ko: "라이브 데모" })}</p>
  <p id="cz-url">${esc(url.host)}</p>
  ${repo ? `<p id="cz-repo">${pick(lang, { en: "Code", ko: "코드" })}: ${esc(repo.replace(/^https:\/\//, ""))}</p>` : ""}
</div>
<p id="cz-credit">AI Builder Cup 2026 · ${pick(lang, {
    en: `theme: ${esc(film.theme)} · category: ${esc(film.category)}`,
    ko: `주제: ${esc(film.theme)} · 부문: ${esc(film.category)}`,
  })}<br>${esc(film.credit)}</p>`;
  const render = `
const S = D.S;
$$('.cz-dlg').forEach((el) => { el.style.opacity = prog(t, 0, 0.6); });
reveal($('#cz-name'), prog(t, S[0], 0.8), 12);
reveal($('#cz-try .label'), prog(t, S[1], 0.6));
reveal($('#cz-url'), prog(t, S[1] + 0.3, 0.6));
if ($('#cz-repo')) reveal($('#cz-repo'), prog(t, S[1] + 0.7, 0.6));
reveal($('#cz-credit'), prog(t, S[1] + 1.4, 0.8), 6);`;
  return pageHtml({ lang, css, body, render, data: timing });
}
