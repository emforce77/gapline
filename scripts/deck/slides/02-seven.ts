/**
 * 02. The hook, drawn to scale: the picture strip is exactly the silence between "…locked." and
 * "This is pretty freaky.", cut at its real shot boundary, with the dialogue at both ends and Scene's
 * two lines as measured voice inside their room. The line an editor typed says so.
 */
import { seven } from "../data/demo";
import { sevenHeard } from "../data/recognizers";
import { dayMonthYear, esc, px, secs, slide } from "../html";
import { notesFor } from "../notes";
import { sevenShots, stillUrl } from "../stills";
import { MARGIN, W } from "../theme";

const Y = {
  body: 186,
  edge: 292,
  strip: 338,
  stripH: 404,
  sub: 606,
  dlgText: 758,
  dlg: 798,
  dlgH: 64,
  ad: 884,
  adH: 50,
  tag: 942,
};
const SHOT_GAP = 3;
/** Lower share of each frame darkened under the subtitles, as film subtitles are, so they stay legible. */
const SCRIM = 0.5;
const SUB_INSET = 24;
/** Seconds of dialogue shown on each side of the silence, so both lines of dialogue read in full. */
const PAD_S = 0.3;
/** Where each shot's crop sits in its frame, chosen by eye for the lettering and the brain. */
const FOCUS = ["22% 40%", "50% 34%"];

const domain = [seven.locked.start - PAD_S, seven.freaky.end + PAD_S] as const;
const pps = (W - 2 * MARGIN) / (domain[1] - domain[0]);
const x = (t: number) => MARGIN + (t - domain[0]) * pps;

export function sevenSlide(): string {
  const note = notesFor(2, "For seven seconds…");
  const from = seven.locked.end;
  const to = seven.freaky.start;
  const shown = sevenShots.filter((s) => s.end > from && s.start < to);
  if (shown.length !== FOCUS.length)
    throw new Error(`expected ${FOCUS.length} shots in the silence`);
  const shotBox = (s: (typeof shown)[number]) => ({
    a: x(Math.max(s.start, from)),
    b: x(Math.min(s.end, to)),
  });
  const shots = shown
    .map((s, i) => {
      const { a, b } = shotBox(s);
      const w = i === shown.length - 1 ? b - a : b - a - SHOT_GAP;
      return (
        `<img class="still" src="${stillUrl(`seven-${sevenShots.indexOf(s)}`)}" alt="" style="left:${px(a)};top:${Y.strip}px;width:${px(w)};height:${Y.stripH}px;object-position:${FOCUS[i]}">` +
        `<div class="sv-scrim" style="left:${px(a)};top:${Y.strip + Y.stripH * (1 - SCRIM)}px;width:${px(w)};height:${Y.stripH * SCRIM}px"></div>`
      );
    })
    .join("");

  const subs = seven.lines
    .map((l) => {
      const shot = shown.find((s) => l.start >= s.start && l.start < s.end);
      if (!shot) throw new Error(`line ${l.id} is outside the strip's shots`);
      const { a, b } = shotBox(shot);
      return `<p class="sub sv-sub on-film" lang="ko" style="left:${px(a + SUB_INSET)};width:${px(b - a - 2 * SUB_INSET)};top:${Y.sub}px">${esc(l.text)}<span class="gloss" lang="en">${esc(l.gloss)}</span></p>`;
    })
    .join("");

  const hum = note(
    `No words between ${secs(from)} and ${secs(to)}: Chirp 3 (Speech-to-Text v2) and a second recognizer (faster-whisper small) hear none on the whole clip, and the second hears none in that stretch recognized on its own (${dayMonthYear(sevenHeard.checkedAt)}); its spectrogram shows no voice, only steady tones. “Hum and music” is Scene’s own sound label (Gemini); no person has listened for it.`,
  );
  const typed = seven.lines.filter((l) => l.byEditor);
  if (typed.length !== 1) throw new Error("expected one editor-typed line in the seven seconds");
  const clips = seven.lines
    .map(
      (l) =>
        `<div class="room" style="left:${px(x(l.start) - MARGIN)};width:${px(x(l.windowEnd) - x(l.start))}"></div>` +
        `<div class="clip ad" style="left:${px(x(l.start) - MARGIN)};width:${px(l.voiced * pps)}"><span class="sv-clip">${secs(l.voiced)}</span></div>`,
    )
    .join("");
  const tags = typed
    .map(
      (l) =>
        `<p class="sv-tag" style="left:${px(x(l.start))};top:${Y.tag}px">typed by an editor${note(
          `Typed by an editor from the reviewer’s suggested fix, then voiced, measured and reviewed by Scene. Glosses are ours.`,
        )}</p>`,
    )
    .join("");

  return slide({
    id: "s-seven",
    name: "seven-seconds",
    folio: 2,
    kind: "exhibit",
    filmCredit: true,
    body: `
<div class="intro"><h1 class="headline" style="max-width:1728px">For seven seconds, a blind viewer hears no words.</h1></div>
<p class="body sv-body" style="left:${MARGIN}px;top:${Y.body}px">Only hum and music${hum}, then someone says <q>This is pretty freaky.</q> In Scene’s Korean track, two lines fill the silence and end before the next word.</p>
<p class="sv-edge" style="left:${px(x(from))};top:${Y.edge}px">${secs(from)}</p>
<p class="sv-edge" style="right:${px(W - x(to))};top:${Y.edge}px;text-align:right">${secs(to)}</p>
<div class="sv-inout" style="left:${px(x(from))};width:${px(x(to) - x(from))};top:${Y.edge + 34}px"></div>
${shots}
${subs}
<p class="sv-say" style="right:${px(W - x(from))};top:${Y.dlgText}px;text-align:right">“…${esc(seven.locked.text)}”</p>
<p class="sv-say" style="left:${px(x(to))};top:${Y.dlgText}px">“${esc(seven.freaky.text)}”</p>
<div class="lane" style="left:${MARGIN}px;width:${W - 2 * MARGIN}px;top:${Y.dlg}px;height:${Y.dlgH}px">
  <div class="clip dialogue" style="left:${px(x(seven.locked.start) - MARGIN)};width:${px((seven.locked.end - seven.locked.start) * pps)}"></div>
  <div class="sv-span" style="left:${px(x(from) - MARGIN + 16)};width:${px(x(to) - x(from) - 32)}"><i></i><span><b class="num">${secs(seven.silence)}</b> with no dialogue</span><i></i></div>
  <div class="clip dialogue" style="left:${px(x(to) - MARGIN)};width:${px((seven.freaky.end - seven.freaky.start) * pps)}"></div>
</div>
<div class="lane" style="left:${MARGIN}px;width:${W - 2 * MARGIN}px;top:${Y.ad}px;height:${Y.adH}px">${clips}</div>
${tags}`,
  });
}

export const SEVEN_CSS = `
.sv-body { position:absolute; width:1240px; }
.sv-edge { position:absolute; font-size:24px; color:var(--ink-100); font-variant-numeric:tabular-nums; }
.sv-inout { position:absolute; height:14px; border-left:2px solid var(--ink-100); border-right:2px solid var(--ink-100);
  border-top:2px solid var(--ink-100); }
.sv-scrim { position:absolute; background:linear-gradient(to bottom, rgba(9,9,10,0), rgba(9,9,10,.72)); }
.sv-sub { font-size:36px; line-height:1.25; }
.sv-sub .gloss { font-size:24px; }
.sv-say { position:absolute; font-size:24px; font-weight:500; color:var(--ink-100); white-space:nowrap; }
.sv-span { position:absolute; top:0; height:100%; display:flex; align-items:center; gap:24px; }
.sv-span i { flex:1; height:2px; background:var(--ink-400); }
.sv-span span { font-size:28px; color:var(--ink-300); white-space:nowrap; }
.sv-span b { font-weight:400; font-size:60px; color:var(--ink-100); margin-right:10px; vertical-align:-4px; }
.sv-clip { display:block; padding:0 12px; font-size:22px; font-weight:600; line-height:${Y.adH}px; font-variant-numeric:tabular-nums; }
.sv-tag { position:absolute; font-size:24px; color:var(--ink-300); white-space:nowrap; }
`;
