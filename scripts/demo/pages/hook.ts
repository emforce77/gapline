/**
 * The hook's two drawn scenes. "dark": "Close your eyes." on a black screen, then the film's own sound
 * with its dialogue shown and a line that measures the silence as it passes; the measured total is
 * shown once, after the meter has gone. "seven": the same seconds drawn to scale (deck slide 2), with
 * Scene's two lines growing to their measured length inside their silence, their measurements named
 * with the sentence that says so, then Generate and what one press of it runs (a product claim).
 */
import { dictionary } from "../../../src/i18n";
import { film } from "../facts";
import { labels } from "../labels";
import { masterCut } from "../master";
import { esc, note, pageHtml, pick, secs, STAGE, still, type PageTiming } from "./shell";

const M = STAGE.margin;

/** How much closer the words held after the film's sound drift, over the rest of the scene. */
const DRIFT = 0.06;
/** The display words ("Close your eyes.") in Korean: Pretendard, since the serif has no Hangul. */
const KO_DISPLAY_CSS = "font-family:var(--sans); font-style:normal; font-weight:600;";

/** A number with its unit; the Korean unit is set in Pretendard, whatever face the number uses. */
const unit = (x: number, lang: PageTiming["lang"]): string =>
  lang === "ko" ? `${x.toFixed(1)}<span class="u">초</span>` : esc(secs(x, lang));

const DARK = { ctx: 52, close: 360, count: 318, meter: 412, nowords: 438, sum: 270, dlg: 616 };

export function darkPage(timing: PageTiming): string {
  const h = film.hook;
  const lang = timing.lang;
  const ko = labels(lang).dialogueKo;
  const data = {
    ...timing,
    h: { from: h.from, locked: h.locked, freaky: h.freaky, silence: h.silence },
    unit: lang === "ko" ? "초" : " s",
  };
  const css = `
.u { font-family:var(--sans); }
#close, #open { left:0; width:${STAGE.w}px; top:${DARK.close}px; text-align:center; font-family:var(--serif); font-style:italic;
  font-size:88px; color:var(--ink-100); opacity:0; }
html[lang=ko] #close, html[lang=ko] #open { ${KO_DISPLAY_CSS} font-size:76px; }
#ctx { left:${M}px; top:${DARK.ctx}px; font-size:26px; color:var(--ink-400); opacity:0; }
.dlg { left:0; width:${STAGE.w}px; top:${DARK.dlg}px; text-align:center; font-size:40px; font-weight:500; color:var(--ink-300); opacity:0; }
.dlg span { display:block; margin-top:8px; font-size:30px; color:var(--ink-400); }
#meter { left:${M}px; top:${DARK.meter}px; height:6px; width:0; background:var(--ink-300); opacity:0; }
#count { top:${DARK.count}px; font-family:var(--mono); font-size:64px; color:var(--ink-100); opacity:0; white-space:nowrap; }
#nowords { left:${M}px; top:${DARK.nowords}px; font-size:28px; color:var(--ink-400); opacity:0; }
#sum { left:0; width:${STAGE.w}px; top:${DARK.sum}px; text-align:center; opacity:0; }
#sum b { display:block; font-family:var(--serif); font-weight:400; font-size:150px; line-height:1; color:var(--ink-100); }
#sum b .u { font-size:110px; }
#sum span.l { font-size:36px; color:var(--ink-300); }`;
  const dialogue = (id: string, en: string, translated?: string) =>
    `<p class="a dlg" id="${id}">${esc(en)}${translated ? `<span lang="ko">${esc(translated)}</span>` : ""}</p>`;
  const body = `
<p class="a" id="ctx">${pick(lang, {
    en: `<i>Tears of Steel</i>, ${Math.floor(h.from)}–${Math.ceil(h.to)} s of the film · sound only`,
    ko: `<i>Tears of Steel</i>, 영화의 ${Math.floor(h.from)}–${Math.ceil(h.to)}초 · 소리만`,
  })}</p>
<p class="a" id="close">${pick(lang, { en: "Close your eyes.", ko: "눈을 감아 보세요." })}</p>
<div class="a" id="meter"></div>
<p class="a" id="count"></p>
<p class="a" id="nowords">${pick(lang, { en: "no dialogue", ko: "대사 없음" })}</p>
${dialogue("locked", `…${h.locked.text}`, ko?.locked)}
${dialogue("freaky", h.freaky.text, ko?.freaky)}
<p class="a" id="sum"><b>${unit(h.silence, lang)}</b><span class="l">${pick(lang, { en: "with no dialogue", ko: "동안 대사 없음" })}</span></p>
<p class="a" id="open">${pick(lang, { en: "Open your eyes.", ko: "눈을 떠 보세요." })}</p>`;
  const width = STAGE.w - 2 * M;
  const render = `
const f = D.h.from + (t - D.film);
// "Close your eyes." has gone by the time the first words of the film are heard.
reveal($('#close'), prog(t, 0.1, 0.8) * (1 - prog(t, D.film - 0.2, 0.45)), 10);
$('#ctx').style.opacity = prog(t, D.film, 0.6) * (1 - prog(t, D.T - 0.8, 0.6));
const cap = (el, a, b) => { el.style.opacity = prog(f, a, 0.15) * (1 - prog(f, b, 0.3)); };
cap($('#locked'), D.h.locked.start, D.h.locked.end + 1.0);
cap($('#freaky'), D.h.freaky.start, D.h.freaky.end + 0.6);
const s = lin(f, D.h.locked.end, D.h.freaky.start - D.h.locked.end);
// The meter leaves before the total is shown: the number appears once.
const on = prog(f, D.h.locked.end, 0.3) * (1 - prog(t, D.S[0] - 0.5, 0.4));
reveal($('#sum'), prog(t, D.S[0], 0.6) * (1 - prog(t, D.S[1] - 0.1, 0.4)), 16);
reveal($('#open'), prog(t, D.S[1] + 0.2, 0.5) * (1 - prog(t, D.T - 0.25, 0.25)), 10);
// A slow push on the words held after the film's sound, so the picture keeps moving while they are read.
const drift = (el, from) => { el.style.transform += ' scale(' + (1 + ${DRIFT} * lin(t, from, D.T - from)) + ')'; };
drift($('#sum'), D.S[0]); drift($('#open'), D.S[1]);
const w = s * ${width};
$('#meter').style.width = w + 'px';
$('#meter').style.opacity = on;
$('#nowords').style.opacity = on;
const c = $('#count');
c.style.opacity = on;
c.textContent = fmt(s * D.h.silence, 1) + D.unit;
c.style.left = Math.min(${M} + w + 16, ${STAGE.w - M} - c.offsetWidth) + 'px';`;
  return pageHtml({ lang, css, body, render, data });
}

const SEVEN = {
  headline: 52,
  edge: 170,
  strip: 212,
  stripH: 280,
  sub: 382,
  dlg: 520,
  dlgH: 64,
  dlgKo: 590,
  ad: 630,
  adH: 46,
  note: 690,
  press: 754,
};
/** Shots with less than this much time in the strip are left dark; a sliver reads as a bad crop. */
const MIN_SHOT_S = 1.5;
const STILL_W = 1920;
/** The dialogue's words start this far inside their block. */
const DIALOGUE_PAD_PX = 12;
/** Where in the first sentence the measurements appear: with "each measured". */
const MEASURED_AT = 0.55;

export async function sevenPage(timing: PageTiming): Promise<string> {
  const h = film.hook;
  const lang = timing.lang;
  const t = dictionary(lang);
  const ko = labels(lang).dialogueKo;
  const [d0, d1] = h.domain;
  // The strip keeps the page margins on both sides; `lx` places a block inside a lane that starts
  // at the left margin.
  const laneW = STAGE.w - 2 * M;
  const pps = laneW / (d1 - d0);
  const x = (s: number) => M + (s - d0) * pps;
  const lx = (s: number) => x(s) - M;
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
  // Scene's Korean line on its shot; the English film adds the translation under it.
  const subs = lines
    .map((l) => {
      const shot = shots.find((s) => l.start >= s.a && l.start < s.b);
      if (!shot) throw new Error(`line ${l.id} is outside the strip's shots`);
      const c = (x(shot.a) + x(shot.b)) / 2;
      const w = x(shot.b) - x(shot.a) - 48;
      const gloss = lang === "en" ? `<span class="gloss" lang="en">${esc(l.gloss)}</span>` : "";
      return `<p class="a sub sv-sub" style="left:${c - w / 2}px;width:${w}px"><span class="box" lang="ko">${esc(l.text)}${gloss}</span></p>`;
    })
    .join("");
  const rooms = lines
    .map(
      (l) =>
        `<div class="room sv-room" style="left:${lx(l.start)}px;width:${x(l.windowEnd) - x(l.start)}px"></div>` +
        `<div class="clip ad sv-bar" data-w="${l.voiced * pps}" style="left:${lx(l.start)}px;width:0"></div>`,
    )
    .join("");
  const measured = lines
    .map((l) => {
      const room = l.windowEnd - l.start;
      const words = pick(lang, {
        en: `<b>${esc(secs(l.voiced, lang))}</b> of voice in ${esc(secs(room, lang))}`,
        ko: `자리 ${esc(secs(room, lang))}에 낭독 <b>${esc(secs(l.voiced, lang))}</b>`,
      });
      return `<p class="a sv-m" style="left:${x(l.start)}px">${words}</p>`;
    })
    .join("");
  const steps = pick(lang, {
    en: ["Write", "Check", "Voice"],
    ko: ["쓰기", "검수", "낭독"],
  });
  const css = `
.u { font-family:var(--sans); }
.sv-shot { top:${SEVEN.strip}px; height:${SEVEN.stripH}px; overflow:hidden; opacity:0; }
.sv-shot img { width:100%; height:100%; object-fit:cover; transform-origin:50% 50%; }
.sv-sub { top:${SEVEN.sub}px; font-size:36px; line-height:1.25; opacity:0; }
.sv-sub .box { display:inline-block; padding:6px 16px 8px; border-radius:4px; background:rgba(9,9,10,.72); }
.sv-sub .gloss { font-size:26px; }
.sv-edge { top:${SEVEN.edge}px; font-family:var(--mono); font-size:26px; color:var(--ink-100); opacity:0; }
.sv-lane .clip { overflow:visible; }
.sv-lane .clip.dialogue { min-width:max-content; }
.sv-dlg { display:block; padding:0 ${DIALOGUE_PAD_PX}px; font-size:26px; font-weight:500; line-height:${SEVEN.dlgH}px; color:#f4f4f5; white-space:nowrap; }
.sv-ko { top:${SEVEN.dlgKo}px; font-size:24px; color:var(--ink-300); white-space:nowrap; opacity:0; }
.sv-span { top:${SEVEN.dlg}px; height:${SEVEN.dlgH}px; display:flex; align-items:center; gap:22px; opacity:0; }
.sv-span i { flex:1; height:2px; background:var(--ink-400); }
.sv-span span { font-size:28px; color:var(--ink-300); white-space:nowrap; }
.sv-span b { font-family:var(--serif); font-weight:400; font-size:60px; color:var(--ink-100); margin-right:12px; vertical-align:-4px; }
.sv-span b .u { font-size:44px; }
.sv-room { opacity:0; }
.sv-m { top:${SEVEN.note}px; font-size:28px; color:var(--ink-300); white-space:nowrap; opacity:0; }
.sv-m b { font-weight:600; color:var(--amber); }
#sv-press { left:${M}px; top:${SEVEN.press}px; display:flex; align-items:center; gap:18px; font-size:28px; color:var(--ink-300); }
#sv-press .btn { padding:6px 18px; border:1.5px solid var(--ink-300); border-radius:8px; font-weight:600; color:var(--ink-100); opacity:0; }
#sv-press i { width:48px; height:2px; background:var(--ink-400); opacity:0; }
#sv-press .step { opacity:0; }
#sv-press .step + .step::before { content:"·"; margin-right:18px; color:var(--ink-400); }
#sv-head { left:${M}px; top:${SEVEN.headline}px; opacity:0; }`;
  const silentFrom = x(h.locked.end);
  const silentTo = x(h.freaky.start);
  // A block too short for its words grows away from the silence, so the silence's edges stay where
  // they were measured: "locked." grows left from the silence's start. "This is pretty freaky." ends
  // the strip at the right margin (its words fit its block at this scale: 262 of 274 px, measured).
  const lockedEnd = laneW - lx(h.locked.end);
  const freakyW = Math.min(x(h.freaky.end), STAGE.w - M) - x(h.freaky.start);
  // The Korean copy subtitles the film's dialogue under each block, aligned with its words.
  const koUnder = (side: "left" | "right", at: number, text: string | undefined) =>
    text
      ? `<p class="a sv-ko" style="${side}:${at + DIALOGUE_PAD_PX}px" lang="ko">${esc(text)}</p>`
      : "";
  const body = `
<h2 class="a h2" id="sv-head">${pick(lang, { en: "Two lines, each inside the silence.", ko: "두 문장 모두 침묵 안에." })}</h2>
<p class="a sv-edge" style="left:${silentFrom + 10}px">${unit(h.locked.end, lang)}</p>
<p class="a sv-edge" style="right:${STAGE.w - silentTo + 10}px">${unit(h.freaky.start, lang)}</p>
${shotHtml}
${subs}
<div class="lane sv-lane" style="left:${M}px;width:${laneW}px;top:${SEVEN.dlg}px;height:${SEVEN.dlgH}px;opacity:0">
  <div class="clip dialogue" style="right:${lockedEnd}px;text-align:right;width:${x(h.locked.end) - x(h.locked.start)}px"><span class="sv-dlg">${esc(h.locked.text)}</span></div>
  <div class="clip dialogue" style="left:${lx(h.freaky.start)}px;width:${freakyW}px"><span class="sv-dlg">${esc(h.freaky.text)}</span></div>
</div>
${koUnder("right", STAGE.w - x(h.locked.end), ko?.locked)}${koUnder("left", x(h.freaky.start), ko?.freaky)}
<div class="a sv-span" style="left:${silentFrom + 16}px;width:${silentTo - silentFrom - 32}px"><i></i><span><b>${unit(h.silence, lang)}</b>${pick(lang, { en: "with no dialogue", ko: "대사 없음" })}</span><i></i></div>
<div class="lane" style="left:${M}px;width:${laneW}px;top:${SEVEN.ad}px;height:${SEVEN.adH}px">${rooms}</div>
${measured}
<div class="a" id="sv-press"><span class="btn">${esc(t.workspace.generate)}</span><i></i>${steps.map((s) => `<span class="step">${esc(s)}</span>`).join("")}</div>
${note(
  pick(lang, {
    en: "Speech timing from Chirp 3 · <i>Tears of Steel</i> © Blender Foundation, CC BY 3.0",
    ko: "대사 시점: Chirp 3 · <i>Tears of Steel</i> © Blender Foundation, CC BY 3.0",
  }),
)}`;
  const render = `
const S = D.S, L = D.L;
reveal($('#sv-head'), prog(t, 0, 0.7));
$$('.sv-shot').forEach((el, i) => { el.style.opacity = prog(t, 0.05 + i * 0.15, 0.6);
  el.firstChild.style.transform = 'scale(' + (1.0 + 0.035 * t / D.T) + ')'; });
$$('.sv-lane, .sv-edge, .sv-ko').forEach((el) => { el.style.opacity = prog(t, 0.2, 0.6); });
reveal($('.sv-span'), prog(t, 0.5, 0.6), 0);
$$('.sv-room').forEach((el, i) => { el.style.opacity = prog(t, S[0] + 0.2 + i * 0.3, 0.5); });
$$('.sv-bar').forEach((el, i) => {
  const p = lin(t, S[0] + 0.9 + i * 1.3, 1.2);
  el.style.width = (Number(el.dataset.w) * ease(p)) + 'px';
  $$('.sv-sub')[i].style.opacity = prog(t, S[0] + 0.9 + i * 1.3, 0.4);
});
// The measurements come with the words that say each line was measured.
$$('.sv-m').forEach((el, i) => reveal(el, prog(t, S[0] + L[0] * ${MEASURED_AT} + i * 0.5, 0.5), 10));
// Generate and what one press of it runs, in order (the product, not how this sample was started).
reveal($('#sv-press .btn'), prog(t, S[1], 0.5), 8);
$('#sv-press i').style.opacity = prog(t, S[1] + 0.4, 0.4);
$$('#sv-press .step').forEach((el, i) => reveal(el, prog(t, S[1] + 0.7 + i * 0.45, 0.45), 8));`;
  return pageHtml({ lang, css, body, render, data: timing });
}
