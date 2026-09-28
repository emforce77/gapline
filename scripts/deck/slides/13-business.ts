/**
 * 13. Business case, stated as our bet: who would pay, who runs it and who benefits (in Korea and
 * across Asia-Pacific), beside what description costs per minute today, on a log scale. Gapline's own
 * cost is not on the chart: one sample run is no price. Sources are notes.
 */
import { AUDIENCE, KOFIC_2025, PRICE_POINTS } from "../facts";
import { esc, px, slide } from "../html";
import { notesFor } from "../notes";
import { MARGIN, W } from "../theme";

const CHART = { label: 1000, left: 1370, right: W - MARGIN - 24, top: 350, rowH: 150, markTop: 30 };
const LOG_MIN = -1; // $0.10
const LOG_MAX = 2; // $100
const TICKS = [0.1, 1, 10, 100];

const x = (v: number) =>
  CHART.left + ((Math.log10(v) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * (CHART.right - CHART.left);
const money = (v: number) => (v < 1 ? `$${v.toFixed(2)}` : `$${v % 1 === 0 ? v : v.toFixed(2)}`);

export function businessSlide(): string {
  const note = notesFor("Business");
  if (
    PRICE_POINTS.flatMap((p) => [p.low, p.high]).some(
      (v) => Math.log10(v) < LOG_MIN || Math.log10(v) > LOG_MAX,
    )
  )
    throw new Error("a price falls outside the chart's axis");

  const pays = note(
    `The 2017 ruling tied cinemas’ duty to films whose producer or distributor supplies the file; streaming services have had a duty to make efforts since June 2026.`,
  );
  const program = note(
    `The Korean Film Council (KOFIC) runs a barrier-free program for Korean releases (${esc(KOFIC_2025.source)}).`,
  );
  const korea = note(
    `${esc(AUDIENCE.koreansRegistered.replace(/^a/, "A"))} registered: ${esc(AUDIENCE.koreaSource)}.`,
  );
  const region = note(
    `${esc(AUDIENCE.asiaPacificShare.replace(/^a/, "A"))} of the world’s ${esc(AUDIENCE.worldBlind)} blind people: ${esc(AUDIENCE.worldSource)}.`,
  );
  const prices = note(
    `${PRICE_POINTS.map((p) => `${esc(p.who)}: ${p.high > p.low ? `${money(p.low)}–${money(p.high)}` : money(p.low)} a minute (${esc(p.source)})`).join(". ")}.`,
  );

  const rows = PRICE_POINTS.map((p) => ({
    who: esc(p.who),
    value: p.high > p.low ? `${money(p.low)}–${money(p.high)}` : money(p.low),
    marks:
      p.high > p.low
        ? `<div class="bz-range" style="left:${px(x(p.low))};width:${px(x(p.high) - x(p.low))}"></div>`
        : `<div class="bz-dot" style="left:${px(x(p.low) - 9)}"></div>`,
  }))
    .map((r, i) => {
      const top = CHART.top + i * CHART.rowH;
      return `<p class="bz-who" style="left:${CHART.label}px;top:${top}px"><b>${r.who}</b>${r.value}</p><div class="bz-marks" style="top:${top + CHART.markTop}px">${r.marks}</div>`;
    })
    .join("");
  const axisTop = CHART.top + PRICE_POINTS.length * CHART.rowH - 24;
  const ticks = TICKS.map(
    (t) =>
      `<div class="bz-tick" style="left:${px(x(t))};top:${CHART.top}px;height:${axisTop - CHART.top}px"></div><p class="bz-t" style="left:${px(x(t))};top:${axisTop + 6}px">${money(t)}</p>`,
  ).join("");

  return slide({
    id: "s-business",
    name: "business",
    kind: "exhibit",
    body: `
<div class="intro"><h1 class="headline" style="max-width:1500px">Our bet: whoever supplies a film’s description file would pay Gapline to make it.</h1></div>
<dl class="bz-who-list" style="left:${MARGIN}px;top:${CHART.top - 30}px">
  <dt>Would pay</dt><dd>Foreign-film distributors and streaming services${pays}</dd>
  <dd class="bz-why">A public program covers Korean films${program}</dd>
  <dt>Runs it</dt><dd>Teams preparing accessible versions</dd>
  <dt>Benefits</dt><dd>Blind and low-vision viewers: ${esc(AUDIENCE.koreansRegistered)} in Korea${korea}</dd>
  <dd class="bz-also">Nearly two in three of the world’s blind people live in Asia-Pacific${region}</dd>
</dl>
<p class="label bz-chartl" style="left:${CHART.label}px;top:${CHART.top - 56}px">What description costs per minute today, log scale${prices}</p>
${ticks}${rows}
`,
  });
}

export const BUSINESS_CSS = `
.bz-who-list { position:absolute; width:800px; display:grid; grid-template-columns:150px 1fr; row-gap:40px; column-gap:24px; }
.bz-who-list dt { font-size:var(--fs-label); font-weight:600; color:var(--ink-300); padding-top:6px; }
.bz-who-list dd { font-size:var(--fs-body); line-height:1.3; color:var(--ink-100); text-wrap:balance; }
.bz-who-list dd.bz-why { grid-column:2; margin-top:-32px; font-size:var(--fs-label); color:var(--ink-300); }
.bz-who-list dd.bz-also { grid-column:2; margin-top:-22px; }
.bz-chartl { position:absolute; }
.bz-who { position:absolute; width:360px; font-size:var(--fs-label); line-height:1.3; color:var(--ink-300); font-variant-numeric:tabular-nums; }
.bz-who b { display:block; font-weight:600; color:var(--ink-100); }
.bz-marks { position:absolute; left:0; width:${W}px; height:18px; }
.bz-range { position:absolute; top:1px; height:16px; background:var(--ink-300); border-radius:8px; }
.bz-dot { position:absolute; top:0; width:18px; height:18px; border-radius:50%; background:var(--ink-300); }
.bz-tick { position:absolute; width:1px; background:var(--rule); }
.bz-t { position:absolute; transform:translateX(-50%); font-size:var(--fs-label); color:var(--ink-400); font-variant-numeric:tabular-nums; }
`;
