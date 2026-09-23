/**
 * 03. Why now: the ten-year cinema lawsuit and the streaming duty on one dated track, then what one
 * accessible film costs by hand and the subsidy cut, drawn to scale. Sources are endnotes; the case
 * number stays on the slide because the ruling is the slide's point.
 */
import { HAND_MADE, LAWSUIT, STREAMING_DUTY, SUBSIDY } from "../facts";
import { dayMonthYear, intro, monthYear, px, slide } from "../html";
import { notesFor } from "../notes";
import { MARGIN, W } from "../theme";

const YEAR0 = 2016;
const YEAR1 = 2027;
const YEAR_LABEL_STEP = 2;
const Y = { labels: 296, lane: 478, laneH: 64, duty: 578, axis: 670, bottom: 768 };
const EVENT_LABEL_W = [470, 300, 520];
const SUBSIDY_BAR_MAX = 560;
/** The 2017 ruling that ties the duty to films arriving with a file: the business case rests on it. */
const FILE_EVENT = 0;

function yearFraction(iso: string): number {
  const d = new Date(`${iso}T00:00:00Z`);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  const end = Date.UTC(d.getUTCFullYear() + 1, 0, 1);
  return d.getUTCFullYear() + (d.getTime() - start) / (end - start);
}
const x = (iso: string) =>
  MARGIN + ((yearFraction(iso) - YEAR0) / (YEAR1 - YEAR0)) * (W - 2 * MARGIN);
const xYear = (year: number) => MARGIN + ((year - YEAR0) / (YEAR1 - YEAR0)) * (W - 2 * MARGIN);

/** Short labels for the slide; the full wording and the source go to the notes. */
const EVENT_TEXT = [
  "First ruling: only films that arrive with a description or caption file",
  "Appeals court caps it at 3% of screenings",
  "Supreme Court: it is discrimination, and the 3% cap is set aside",
];
const EVENT_NOTE = [
  "Seoul Central District Court 2016가합508596, 7 Dec 2017: the duty covered films whose producer or distributor supplied description or caption files (화면해설 또는 자막 파일).",
  "Seoul High Court, 25 Nov 2021: open screenings at 3% of each chain’s screenings, only at multiplexes with a 300-seat hall.",
  "Supreme Court 2022다203507, 3 Sep 2026 (press release): discrimination upheld; the appeals court’s cap weighed the chains’ costs too heavily and was sent back. No new quota yet.",
];

export function whyNowSlide(): string {
  const note = notesFor(3, "The duty to describe widens…");
  if (LAWSUIT.events.length !== EVENT_TEXT.length) throw new Error("lawsuit events changed");
  const last = LAWSUIT.events[LAWSUIT.events.length - 1];
  const filed = note(
    `Filed ${dayMonthYear(LAWSUIT.filed)} against CJ CGV, Lotte Cultureworks and Megabox (MaxMovie; Kyunghyang).`,
  );
  const events = LAWSUIT.events
    .map((e, i) => {
      const at = x(e.date);
      const isLast = i === LAWSUIT.events.length - 1;
      const pos = isLast ? `right:${px(W - at + 12)}` : `left:${px(at + 12)}`;
      const tag = isLast ? `<span class="tag wn-case" lang="ko">2022다203507</span>` : "";
      return (
        `<div class="wn-tick" style="left:${px(at - 1)};top:${Y.labels + 6}px;height:${Y.lane - Y.labels - 6}px"></div>` +
        `<div class="wn-event${isLast ? " last" : ""}${i === FILE_EVENT ? " key" : ""}" style="${pos};top:${Y.labels}px;width:${EVENT_LABEL_W[i]}px"><p class="wn-date">${monthYear(e.date)}</p><p>${EVENT_TEXT[i]}${note(EVENT_NOTE[i])}</p>${tag}</div>`
      );
    })
    .join("");
  const years = Array.from({ length: YEAR1 - YEAR0 + 1 }, (_, i) => YEAR0 + i)
    .map((y) => {
      const tick = `<div class="wn-yt" style="left:${px(xYear(y))}"></div>`;
      const labelled = (y - YEAR0) % YEAR_LABEL_STEP === 0 && y < YEAR1;
      return labelled
        ? `${tick}<p class="wn-year" style="left:${px(xYear(y) + 6)}">${y}</p>`
        : tick;
    })
    .join("");
  const duty = note(
    "Korea Media &amp; Communications Commission (KMCC) notice amended 29 Jun 2026: streaming services get a duty to make efforts, with no quota or penalty reported (ZDNet Korea; Digital Daily).",
  );
  const cut = Math.round((1 - SUBSIDY.after.won / SUBSIDY.before.won) * 100);
  const HALF = 50;
  if (cut <= HALF) throw new Error("the headline says the subsidy was more than halved");
  const bar = (year: number, won: number) =>
    `<div class="wn-bar"><span class="wn-by">${year}</span><i style="width:${px((won / SUBSIDY.before.won) * SUBSIDY_BAR_MAX)}"></i><span class="wn-bv">₩${won.toFixed(2)}B</span></div>`;
  const hand = note(
    `Barrier-Free Film Committee FAQ (undated): about ₩${HAND_MADE.wonMillions}M per Korean film, description and captions together. ${HAND_MADE.months} months, about ${HAND_MADE.specialists} people: committee interview, 더나은미래, 2019. ₩1,358 per US$ (22 Sep 2026).`,
  );
  const subsidy = note(`Korea Blind Union statement and KMCC’s reply to Beminor, 13 Mar 2026.`);

  return slide({
    id: "s-why",
    name: "why-now",
    folio: 3,
    kind: "exhibit",
    body: `
${intro("The duty to describe widens while TV’s accessibility subsidy is more than halved.", undefined, 1728)}
${events}
<div class="lane wn-lane" style="left:${px(x(LAWSUIT.filed))};width:${px(x(last.date) - x(LAWSUIT.filed))};top:${Y.lane}px;height:${Y.laneH}px">
  <p class="wn-suit">Blind and deaf moviegoers v. CGV, Lotte Cinema, Megabox${filed}</p>
</div>
<div class="wn-duty" style="left:${px(x(STREAMING_DUTY.date) - 9)};top:${Y.duty}px"></div>
<div class="wn-dutylabel" style="right:${px(W - x(STREAMING_DUTY.date) + 20)};top:${Y.duty - 8}px"><p class="wn-date">${monthYear(STREAMING_DUTY.date)}</p><p>Streaming gets a duty to make efforts${duty}</p></div>
<div class="wn-axis" style="top:${Y.axis}px"></div>
<div style="position:absolute;left:0;top:${Y.axis}px">${years}</div>

<div class="wn-block" style="left:${MARGIN}px;top:${Y.bottom}px;width:820px">
  <p class="label">One accessible film, made by hand</p>
  <p class="wn-hand">About ${HAND_MADE.months} months, ${HAND_MADE.specialists} specialists and ₩${HAND_MADE.wonMillions} million (≈US$${HAND_MADE.usdThousands}k)${hand}</p>
</div>
<div class="wn-block" style="left:1040px;top:${Y.bottom}px;width:784px">
  <p class="label">Subsidy for described, captioned and signed TV${subsidy}</p>
  ${bar(SUBSIDY.before.year, SUBSIDY.before.won)}
  ${bar(SUBSIDY.after.year, SUBSIDY.after.won)}
  <p class="wn-cut">−${cut}% in one year</p>
</div>`,
  });
}

export const WHY_NOW_CSS = `
.wn-tick { position:absolute; width:2px; background:var(--ink-300); }
.wn-event { position:absolute; font-size:26px; line-height:1.3; color:var(--ink-100); text-wrap:balance; }
.wn-event.last { text-align:right; }
.wn-event.key p:not(.wn-date) { font-weight:600; }
.wn-case { display:block; margin-top:6px; }
.wn-date { font-size:24px; font-weight:600; color:var(--ink-400); }
.wn-lane { background:var(--dialogue); border-radius:3px; display:flex; align-items:center; }
.wn-suit { padding:0 20px; font-size:24px; font-weight:500; color:#f4f4f5; white-space:nowrap; }
.wn-suit sup.fn a { color:#f4f4f5; }
.wn-duty { position:absolute; width:18px; height:18px; transform:rotate(45deg); border:2px solid var(--ink-100); }
.wn-dutylabel { position:absolute; width:560px; text-align:right; font-size:26px; line-height:1.3; color:var(--ink-100); }
.wn-axis { position:absolute; left:${MARGIN}px; width:${W - 2 * MARGIN}px; height:2px; background:var(--rule); }
.wn-yt { position:absolute; top:0; width:1px; height:12px; background:var(--tick); }
.wn-year { position:absolute; top:14px; font-size:24px; color:var(--ink-400); font-variant-numeric:tabular-nums; }
.wn-block { position:absolute; }
.wn-hand { margin-top:14px; font-family:var(--serif); font-size:48px; line-height:1.15; color:var(--ink-100); text-wrap:balance; }
.wn-bar { display:flex; align-items:center; gap:16px; margin-top:16px; }
.wn-bar i { display:block; height:34px; background:var(--dialogue); border-radius:2px; }
.wn-by { width:64px; font-size:24px; color:var(--ink-300); font-variant-numeric:tabular-nums; }
.wn-bv { font-size:24px; color:var(--ink-100); font-variant-numeric:tabular-nums; }
.wn-cut { margin-top:16px; font-size:30px; font-weight:600; color:var(--ink-100); font-variant-numeric:tabular-nums; }
`;
