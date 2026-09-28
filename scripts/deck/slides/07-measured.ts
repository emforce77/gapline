/**
 * 07. Measured, not estimated: the newspaper line of the English city run fits its room by word
 * count and overruns it when spoken; shortened and read faster, it still overruns, so Gapline drops it.
 * Three bars on one seconds scale against the room: the estimate, the first voice, and the closest
 * of the shortened takes. The word budget's source is the one note.
 */
import { fitRule, newspaper as n } from "../data/city";
import { esc, intro, px, secs, slide } from "../html";
import { notesFor } from "../notes";
import { stillUrl } from "../stills";
import { MARGIN } from "../theme";

const PIC = { top: 300, w: 780, h: 325 };
const CHART = { left: 960, top: 344, rowH: 118, barTop: 42, barH: 40 };
const AXIS_MAX_S = 5;
const BAR_SPAN = 520;
const VALUE_X = CHART.left + BAR_SPAN + 24;
const pps = BAR_SPAN / AXIS_MAX_S;
const BODY_W = 860;
/** Straight single quotes inside a quoted line become typographic ones. */
const inner = (text: string) => text.replace(/'([^']*)'/g, "‘$1’");

type Kind = "estimate" | "voice";
interface Row {
  label: string;
  seconds: number;
  kind: Kind;
  tag: string;
}

export function measuredSlide(): string {
  const note = notesFor("Measured");
  const [draft, ...shortened] = n.tries;
  // The closest the shortened takes came to the room; every one of them still ran long.
  const closest = shortened.reduce((a, b) => (b.voiced < a.voiced ? b : a));
  if (shortened.length !== fitRule.shortenings || shortened.some((t) => t.voiced <= n.room))
    throw new Error("the newspaper line no longer ran long after every shortening");
  if (closest.rate <= 1) throw new Error("the closest shortened take was not read faster");
  const roomX = CHART.left + n.room * pps;

  const budget = note(
    `${n.wordsPerSecond} words a second is MediaScribe’s published budget and Gapline’s own writing budget.`,
  );
  const rows: Row[] = [
    {
      label: `Estimate: ${draft.words} words${budget}`,
      seconds: n.estimate,
      kind: "estimate",
      tag: "fits on paper",
    },
    { label: "The real voice", seconds: draft.voiced, kind: "voice", tag: "too long" },
    {
      label: "Shortened and sped up",
      seconds: closest.voiced,
      kind: "voice",
      tag: "still too long",
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
<div class="ms-room" style="left:${px(roomX - 1)};top:${barTop - 10}px;height:${CHART.barH + 20}px"></div>
<p class="ms-v" style="left:${VALUE_X}px;top:${barTop}px">${secs(r.seconds)} <span>${r.tag}</span></p>`;
    })
    .join("");
  const bottom = CHART.top + rows.length * CHART.rowH;

  return slide({
    id: "s-measured",
    name: "measured",
    kind: "exhibit",
    filmCredit: true,
    body: `
${intro(`The word count said it fit; the voice took ${secs(draft.voiced)}.`, undefined, 1728)}
<img class="still ms-pic" src="${stillUrl("news")}" alt="" style="left:${MARGIN}px;top:${PIC.top}px;width:${PIC.w}px;height:${PIC.h}px;object-position:40% 50%">
<p class="ms-draft" style="left:${MARGIN}px;top:${PIC.top + PIC.h + 28}px;width:${PIC.w}px">“${esc(inner(draft.text))}”</p>
<p class="ms-roomlabel" style="left:${px(roomX - 1)};top:${CHART.top - 52}px">Room: ${secs(n.room)}</p>
${bars}
<p class="body ms-body" style="left:${CHART.left}px;top:${bottom + 20}px;width:${BODY_W}px">Gapline times the real voice, not a word count. Shortened and sped up, the line still ran long, so Gapline dropped it rather than run into the next line.</p>`,
  });
}

export const MEASURED_CSS = `
.ms-pic { border-radius:4px; }
.ms-draft { position:absolute; font-size:34px; line-height:1.3; font-weight:500; color:var(--ink-100); }
.ms-body { position:absolute; }
.ms-l { position:absolute; font-size:var(--fs-label); line-height:1.3; color:var(--ink-100); font-weight:600; white-space:nowrap; }
.ms-bar { position:absolute; height:${CHART.barH}px; border-radius:3px; }
.ms-bar.estimate { border:2px dashed var(--ink-300); }
.ms-bar.voice { background:var(--amber); }
.ms-v { position:absolute; font-size:30px; line-height:${CHART.barH}px; color:var(--ink-100); font-variant-numeric:tabular-nums; white-space:nowrap; }
.ms-v span { color:var(--ink-300); margin-left:10px; font-size:var(--fs-label); }
.ms-room { position:absolute; width:0; border-left:3px solid var(--ink-100); }
.ms-over { position:absolute; height:${CHART.barH}px; background:repeating-linear-gradient(135deg, rgba(9,9,10,.55) 0 3px, transparent 3px 10px); }
.ms-roomlabel { position:absolute; transform:translateX(-50%); font-size:var(--fs-label); font-weight:600; color:var(--ink-100); white-space:nowrap; }
`;
