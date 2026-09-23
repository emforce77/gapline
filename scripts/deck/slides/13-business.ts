/**
 * 13. Business case, stated as our bet: who would pay, who runs it and who benefits; where the gap
 * is, drawn to scale from KOFIC's 2025 count (Korean releases mostly get an accessible version, few
 * reach a screening, so the bet is on foreign films); published per-minute prices for description on
 * a log scale with Scene's own API cost per minute set on the same axis as a hollow mark. That cost is
 * the sample's API calls: the run plus the hearing and watching it reused from an earlier run of the
 * clip (data/analysis.ts); servers and storage are not in it. Sources are notes.
 */
import { cost } from "../data/analysis";
import { round2 } from "../data/runs";
import { summary } from "../data/sample";
import { AUDIENCE, HAND_MADE, KOFIC_2025, PRICE_POINTS } from "../facts";
import { dayMonthYear, esc, px, slide, usd } from "../html";
import { notesFor } from "../notes";
import { MARGIN, W } from "../theme";

const PERCENT = 100;
/** Dollar figures in the notes: four decimals, as the run ledgers keep them. */
const NOTE_USD_DIGITS = 4;
const CHART = { label: 1000, left: 1370, right: W - MARGIN - 24, top: 330, rowH: 120, markTop: 30 };
const LOG_MIN = -1; // $0.10
const LOG_MAX = 2; // $100
const TICKS = [0.1, 1, 10, 100];
const RELEASES = { top: 700, barMax: 520, rowH: 50, barH: 22 };

const x = (v: number) =>
  CHART.left + ((Math.log10(v) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * (CHART.right - CHART.left);
const money = (v: number) => (v < 1 ? `$${v.toFixed(2)}` : `$${v % 1 === 0 ? v : v.toFixed(2)}`);

export function businessSlide(): string {
  const note = notesFor("Business");
  const review = cost.runByStage.review;
  if (review === undefined) throw new Error("no review cost in the sample's summary");
  const reviewShare = Math.round((review / cost.runCostUsd) * PERCENT);
  const scene = round2(cost.allInPerMinuteUsd);
  if (
    [...PRICE_POINTS.flatMap((p) => [p.low, p.high]), scene].some(
      (v) => Math.log10(v) < LOG_MIN || Math.log10(v) > LOG_MAX,
    )
  )
    throw new Error("a price or cost falls outside the chart's axis");

  const pays = note(
    `Who pays, and a price below human-written description, are our hypotheses, not yet tested with a buyer. The 2017 ruling tied cinemas’ duty to films whose producer or distributor supplies the file; Korean films mostly get one through KOFIC’s programme, so we start with foreign films. Streaming has had a duty to make efforts since June 2026.`,
  );
  const serves = note(
    `${esc(AUDIENCE.koreansRegistered.replace(/^a/, "A"))} registered: ${esc(AUDIENCE.koreaSource)}. Nearly two in three (${esc(AUDIENCE.asiaPacificShare)}) of the world’s ${esc(AUDIENCE.worldBlind)} blind people live in Asia-Pacific: ${esc(AUDIENCE.worldSource)}.`,
  );
  const releases = note(
    `${esc(KOFIC_2025.source)}; a single secondary source. Accessible versions (<span lang="ko">가치봄</span>) carry description and captions. By hand, one Korean film costs about ₩${HAND_MADE.wonMillions}M and one foreign film about ₩${HAND_MADE.foreignWonMillions}M with Korean dubbing (Barrier-Free Film Committee FAQ, undated).`,
  );
  const prices = note(
    `${PRICE_POINTS.map((p) => `${esc(p.who)}: ${p.high > p.low ? `${money(p.low)}–${money(p.high)}` : money(p.low)} a minute (${esc(p.source)})`).join(". ")}.`,
  );
  const costNote = note(
    `Scene’s API calls for the ${summary.clipSeconds} s Korean sample, ${dayMonthYear(summary.day.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }))}: the run ${usd(cost.runCostUsd, NOTE_USD_DIGITS)} and ${Math.round(cost.runSeconds)} s, the reviewer ${reviewShare}% of it. Its hearing and watching were reused from an earlier run of the same clip: ${usd(cost.analysisCostUsd, NOTE_USD_DIGITS)} and ${Math.round(cost.analysisSeconds)} s. All in, ${usd(cost.allInCostUsd, NOTE_USD_DIGITS)}: ${money(scene)} a minute. Servers and storage are not included.`,
  );

  const rows = [
    ...PRICE_POINTS.map((p) => ({
      who: esc(p.who),
      value: p.high > p.low ? `${money(p.low)}–${money(p.high)}` : money(p.low),
      marks:
        p.high > p.low
          ? `<div class="bz-range" style="left:${px(x(p.low))};width:${px(x(p.high) - x(p.low))}"></div>`
          : `<div class="bz-dot" style="left:${px(x(p.low) - 9)}"></div>`,
    })),
    {
      who: `Scene’s API cost${costNote}`,
      value: `${money(scene)} a minute, API calls only`,
      marks: `<div class="bz-dot hollow" style="left:${px(x(scene) - 9)}"></div>`,
    },
  ]
    .map((r, i) => {
      const top = CHART.top + i * CHART.rowH;
      return `<p class="bz-who" style="left:${CHART.label}px;top:${top}px"><b>${r.who}</b>${r.value}</p><div class="bz-marks" style="top:${top + CHART.markTop}px">${r.marks}</div>`;
    })
    .join("");
  const axisTop = CHART.top + (PRICE_POINTS.length + 1) * CHART.rowH - 24;
  const ticks = TICKS.map(
    (t) =>
      `<div class="bz-tick" style="left:${px(x(t))};top:${CHART.top}px;height:${axisTop - CHART.top}px"></div><p class="bz-t" style="left:${px(x(t))};top:${axisTop + 6}px">${money(t)}</p>`,
  ).join("");

  const bar = (n: number, label: string) =>
    `<div class="bz-rel"><i style="width:${px((n / KOFIC_2025.releases) * RELEASES.barMax)}"></i><span><b>${n}</b> ${label}</span></div>`;

  return slide({
    id: "s-business",
    name: "business",
    kind: "exhibit",
    body: `
<div class="intro"><h1 class="headline" style="max-width:1500px">Our bet: whoever supplies a film’s description file would pay Scene to make it.</h1></div>
<dl class="bz-who-list" style="left:${MARGIN}px;top:${CHART.top - 30}px">
  <dt>Would pay</dt><dd>Foreign-film distributors and streaming services${pays}</dd>
  <dd class="bz-why">Foreign films have no public programme</dd>
  <dt>Runs it</dt><dd>Teams preparing accessible versions</dd>
  <dt>Benefits</dt><dd>Blind and low-vision viewers: ${esc(AUDIENCE.koreansRegistered)} in Korea${serves}</dd>
</dl>
<div class="bz-rels" style="left:${MARGIN}px;top:${RELEASES.top}px">
  <p class="label">Korean films mostly get a description file already (2025)${releases}</p>
  ${bar(KOFIC_2025.releases, "released")}
  ${bar(KOFIC_2025.accessible, "made accessible")}
  ${bar(KOFIC_2025.screened, "screened barrier-free")}
</div>
<p class="label bz-chartl" style="left:${CHART.label}px;top:${CHART.top - 56}px">Price per minute, log scale${prices}</p>
${ticks}${rows}
`,
  });
}

export const BUSINESS_CSS = `
.bz-who-list { position:absolute; width:800px; display:grid; grid-template-columns:150px 1fr; row-gap:24px; column-gap:24px; }
.bz-who-list dt { font-size:var(--fs-label); font-weight:600; color:var(--ink-300); padding-top:6px; }
.bz-who-list dd { font-size:var(--fs-body); line-height:1.3; color:var(--ink-100); text-wrap:balance; }
.bz-who-list dd.bz-why { grid-column:2; margin-top:-16px; font-size:var(--fs-label); color:var(--ink-300); }
.bz-rels { position:absolute; width:800px; }
.bz-rel { display:flex; align-items:center; gap:16px; margin-top:14px; height:${RELEASES.barH + 8}px; }
.bz-rel i { display:block; flex:none; height:${RELEASES.barH}px; background:var(--dialogue); border-radius:2px; }
.bz-rel span { font-size:var(--fs-label); color:var(--ink-300); white-space:nowrap; font-variant-numeric:tabular-nums; }
.bz-rel b { font-weight:600; color:var(--ink-100); }
.bz-chartl { position:absolute; }
.bz-who { position:absolute; width:360px; font-size:var(--fs-label); line-height:1.3; color:var(--ink-300); font-variant-numeric:tabular-nums; }
.bz-who b { display:block; font-weight:600; color:var(--ink-100); }
.bz-marks { position:absolute; left:0; width:${W}px; height:18px; }
.bz-range { position:absolute; top:1px; height:16px; background:var(--ink-300); border-radius:8px; }
.bz-dot { position:absolute; top:0; width:18px; height:18px; border-radius:50%; background:var(--ink-300); }
.bz-dot.hollow { background:var(--screen); border:3px solid var(--ink-100); }
.bz-tick { position:absolute; width:1px; background:var(--rule); }
.bz-t { position:absolute; transform:translateX(-50%); font-size:var(--fs-label); color:var(--ink-400); font-variant-numeric:tabular-nums; }
`;
