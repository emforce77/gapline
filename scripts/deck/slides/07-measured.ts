/**
 * 07. Measured, not estimated: the newspaper line fits its room by word count, overruns it when
 * spoken, and once came back longer after it was sped up. Bars are seconds on one scale, each take
 * labelled with its speaking rate; the unstored 1.0x take of the first shortening is drawn as the
 * range the speed-up rule implies, outlined, never as a measurement.
 */
import { fitRule, newspaper as n } from "../data/city";
import { esc, intro, px, secs, slide } from "../html";
import { notesFor } from "../notes";
import { stillUrl } from "../stills";
import { MARGIN } from "../theme";

const PIC = { top: 268, w: 780, h: 325 };
const CHART = { left: 960, top: 300, rowH: 96, barTop: 36, barH: 34 };
const AXIS_MAX_S = 5;
const BAR_SPAN = 520;
const VALUE_X = CHART.left + BAR_SPAN + 24;
const pps = BAR_SPAN / AXIS_MAX_S;
/** Straight single quotes inside a quoted line become typographic ones. */
const inner = (text: string) => text.replace(/'([^']*)'/g, "‘$1’");
const rate = (r: number) => `${r.toFixed(r === 1 ? 1 : 2)}×`;

type Kind = "estimate" | "voice" | "inferred";
interface Row {
  label: string;
  seconds: number;
  kind: Kind;
  value: string;
  tag: string;
}

export function measuredSlide(): string {
  const note = notesFor(7, "The word count said it fit…");
  const [draft, shortened, again] = n.tries;
  const roomX = CHART.left + n.room * pps;
  const budget = note(
    `${n.wordsPerSecond} words a second is MediaScribe’s published budget and Scene’s own writing budget. The draft has ${draft.words} words: ${secs(n.estimate)}.`,
  );
  const inferred = note(
    `Not stored. Scene re-voices a take that overruns at rate = take ÷ room × ${fitRule.headroom}, rounded; the stored rate, ${rate(shortened.rate)}, puts this take at ${n.firstTake.low.toFixed(2)}–${secs(n.firstTake.high)}. Re-voiced ${Math.round((shortened.rate - 1) * 100)}% faster, it came back longer, at ${secs(shortened.voiced)}.`,
  );
  const rows: Row[] = [
    {
      label: `Estimate: ${draft.words} words at ${n.wordsPerSecond} a second${budget}`,
      seconds: n.estimate,
      kind: "estimate",
      value: secs(n.estimate),
      tag: "fits on paper",
    },
    {
      label: `Voiced at ${rate(draft.rate)}`,
      seconds: draft.voiced,
      kind: "voice",
      value: secs(draft.voiced),
      tag: "too long",
    },
    {
      label: `Shortened, at 1.0×${inferred}`,
      seconds: (n.firstTake.low + n.firstTake.high) / 2,
      kind: "inferred",
      value: `${n.firstTake.low.toFixed(2)}–${secs(n.firstTake.high)}`,
      tag: "inferred",
    },
    {
      label: `The same line at ${rate(shortened.rate)}`,
      seconds: shortened.voiced,
      kind: "voice",
      value: secs(shortened.voiced),
      tag: "came back longer",
    },
    {
      label: `Shortened again: same words`,
      seconds: again.voiced,
      kind: "voice",
      value: secs(again.voiced),
      tag: `at ${rate(again.rate)}`,
    },
  ];
  const bars = rows
    .map((r, i) => {
      const top = CHART.top + i * CHART.rowH;
      const barTop = top + CHART.barTop;
      const over = r.seconds - n.room;
      const overflow =
        r.kind === "voice" && over > 0
          ? `<div class="ms-over" style="left:${px(roomX)};top:${barTop}px;width:${px(over * pps)}"></div>`
          : "";
      return `<p class="ms-l" style="left:${CHART.left}px;top:${top}px">${r.label}</p>
<div class="ms-bar ${r.kind}" style="left:${CHART.left}px;top:${barTop}px;width:${px(r.seconds * pps)}"></div>${overflow}
<div class="ms-room" style="left:${px(roomX - 1)};top:${barTop - 8}px;height:${CHART.barH + 16}px"></div>
<p class="ms-v" style="left:${VALUE_X}px;top:${barTop - 4}px">${r.value} <span>${r.tag}</span></p>`;
    })
    .join("");
  const bottom = CHART.top + rows.length * CHART.rowH;
  const one = (t: number) => t.toFixed(1);
  const sameWords = `${one((n.firstTake.low + n.firstTake.high) / 2)}, ${one(shortened.voiced)} and ${secs(again.voiced, 1)}`;
  const faster = Math.round((shortened.rate - 1) * 100);
  if (one(n.firstTake.low) !== one(n.firstTake.high))
    throw new Error(
      "the inferred take no longer rounds to one tenth; the sentence prints one value",
    );
  const room = note(
    `English run, city sequence, default reviewer, 22 Sep 2026. The line starts on the headline’s shot (${n.shot.start}–${n.shot.end} s); Scene’s next line starts at ${n.windowEnd} s, on the next shot. The first of the three takes is inferred, not stored.`,
  );
  const result = note(
    `The final check listed the headline among what the track misses. Speed-ups stop at ${fitRule.maxRate}×; after ${fitRule.shortenings} shortenings a line that still overruns is dropped.`,
  );

  return slide({
    id: "s-measured",
    name: "measured",
    folio: 7,
    kind: "exhibit",
    filmCredit: true,
    body: `
${intro(`The word count said it fit; the voice took ${secs(draft.voiced)}.`, undefined, 1728)}
<img class="still ms-pic" src="${stillUrl("news")}" alt="" style="left:${MARGIN}px;top:${PIC.top}px;width:${PIC.w}px;height:${PIC.h}px;object-position:40% 50%">
<p class="ms-draft" style="left:${MARGIN}px;top:${PIC.top + PIC.h + 28}px;width:${PIC.w}px">“${esc(inner(draft.text))}”</p>
<p class="ms-short" style="left:${MARGIN}px;top:${PIC.top + PIC.h + 136}px;width:${PIC.w}px">Shortened: “${esc(inner(shortened.text))}”</p>
<p class="ms-roomlabel" style="left:${px(roomX - 1)};top:${CHART.top - 44}px">${secs(n.room)} room</p>
${bars}
<p class="body ms-body" style="left:${CHART.left}px;top:${bottom + 16}px">Room: ${secs(n.room)}, from ${secs(n.start, 1)} to Scene’s next line at ${secs(n.windowEnd, 1)}.${room} <b>The same words took ${sameWords}; ${faster}% faster came back longer.</b></p>
<p class="ms-result" style="left:${CHART.left}px;top:${bottom + 152}px"><b>Dropped</b>, and listed as missing.${result}</p>`,
  });
}

export const MEASURED_CSS = `
.ms-pic { border-radius:4px; }
.ms-draft { position:absolute; font-size:34px; line-height:1.25; font-weight:500; color:var(--amber); }
.ms-short { position:absolute; font-size:24px; line-height:1.35; color:var(--ink-300); }
.ms-body { position:absolute; width:860px; font-size:28px; }
.ms-l { position:absolute; font-size:24px; line-height:1.3; color:var(--ink-100); font-weight:600; white-space:nowrap; }
.ms-bar { position:absolute; height:${CHART.barH}px; border-radius:3px; }
.ms-bar.estimate { border:2px dashed var(--ink-300); }
.ms-bar.voice { background:var(--amber); }
.ms-bar.inferred { border:2px dashed var(--amber); }
.ms-v { position:absolute; font-size:28px; line-height:40px; color:var(--ink-100); font-variant-numeric:tabular-nums; white-space:nowrap; }
.ms-v span { color:var(--ink-300); margin-left:8px; font-size:24px; }
.ms-room { position:absolute; width:0; border-left:3px solid var(--ink-100); }
.ms-over { position:absolute; height:${CHART.barH}px; background:repeating-linear-gradient(135deg, rgba(9,9,10,.55) 0 3px, transparent 3px 10px); }
.ms-roomlabel { position:absolute; transform:translateX(-50%); font-size:24px; color:var(--ink-100); white-space:nowrap; }
.ms-result { position:absolute; font-size:32px; color:var(--ink-100); }
.ms-result b { font-weight:600; }
`;
