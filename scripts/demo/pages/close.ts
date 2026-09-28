/**
 * "close": Scene's name set between the two lines of dialogue from the hook (the caption says the
 * tagline, so the card does not repeat it), and where to try it: the live URL, and the code once it
 * is public.
 */
import { SUBMISSION } from "../../deck/facts";
import { film } from "../facts";
import { labels } from "../labels";
import { esc, pageHtml, pick, STAGE, type PageTiming } from "./shell";

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
