/**
 * 13. Business case, stated as our bet: who would pay, who uses it and who benefits; where the gap
 * is, drawn to scale from KOFIC's 2025 count (Korean releases mostly get an accessible version, few
 * reach a screening); published per-minute prices for description on a log scale with Scene's own
 * API cost set on the same axis as hollow marks; and the price as a hypothesis. Sources are notes.
 */
import { originalRun, round2, showcaseCost } from "../data/demo";
import { AUDIENCE, HAND_MADE, KOFIC_2025, PRICE_POINTS } from "../facts";
import { esc, px, slide, usd } from "../html";
import { notesFor } from "../notes";
import { MARGIN, W } from "../theme";

const PERCENT = 100;
const CHART = { label: 1000, left: 1370, right: W - MARGIN - 24, top: 330, rowH: 96, markTop: 30 };
const LOG_MIN = -1; // $0.10
const LOG_MAX = 2; // $100
const TICKS = [0.1, 1, 10, 100];
const RELEASES = { top: 700, barMax: 520, rowH: 50, barH: 22 };

const x = (v: number) =>
  CHART.left + ((Math.log10(v) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * (CHART.right - CHART.left);
const money = (v: number) => (v < 1 ? `$${v.toFixed(2)}` : `$${v % 1 === 0 ? v : v.toFixed(2)}`);

export function businessSlide(): string {
  const note = notesFor(13, "Our bet…");
  const run = originalRun.summary;
  const review = run.costByStage.review;
  if (review === undefined) throw new Error("no review cost in the run summary");
  const reviewShare = Math.round((review / run.costUsd) * PERCENT);
  const scene = [round2(showcaseCost.draftPerMinute), round2(showcaseCost.perMinute)];
  if (
    [...PRICE_POINTS.flatMap((p) => [p.low, p.high]), ...scene].some(
      (v) => Math.log10(v) < LOG_MIN || Math.log10(v) > LOG_MAX,
    )
  )
    throw new Error("a price or cost falls outside the chart's axis");

  const pays = note(
    `Our hypothesis, not yet tested with a buyer. The 2017 ruling tied cinemas’ duty to films whose producer or distributor supplies the file; streaming has had a duty to make efforts since June 2026.`,
  );
  const serves = note(
    `${esc(AUDIENCE.koreansRegistered.replace(/^a/, "A"))} registered: ${esc(AUDIENCE.koreaSource)}. Nearly two in three (${esc(AUDIENCE.asiaPacificShare)}) of the world’s ${esc(AUDIENCE.worldBlind)} blind people: ${esc(AUDIENCE.worldSource)}.`,
  );
  const releases = note(
    `${esc(KOFIC_2025.source)}; a single secondary source. Accessible versions (가치봄) carry description and captions. By hand, one Korean film costs about ₩${HAND_MADE.wonMillions}M and one foreign film about ₩${HAND_MADE.foreignWonMillions}M with Korean dubbing (Barrier-Free Film Committee FAQ, undated).`,
  );
  const prices = note(
    `${PRICE_POINTS.map((p) => `${esc(p.who)}: ${p.high > p.low ? `${money(p.low)}–${money(p.high)}` : money(p.low)} a minute (${esc(p.source)})`).join(". ")}.`,
  );
  const cost = note(
    `Scene’s API calls on the ${run.clipSeconds} s Korean opening, 22–23 Sep 2026. The automatic draft: ${usd(run.costUsd, 4)} and ${Math.round(run.wallSeconds)} s, the reviewer ${reviewShare}% of it. The finished sample adds ${showcaseCost.sessions} editor sessions: ${showcaseCost.runs} runs, ${usd(showcaseCost.usd, 4)} in all. Servers, storage and editor time are not included; editor time is not measured yet.`,
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
      who: `Scene’s API cost${cost}`,
      value: `${money(scene[0])} draft, ${money(scene[1])} finished`,
      marks: scene
        .map((v) => `<div class="bz-dot hollow" style="left:${px(x(v) - 9)}"></div>`)
        .join(""),
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
    folio: 13,
    kind: "exhibit",
    body: `
<div class="intro"><h1 class="headline" style="max-width:1500px">Our bet: whoever supplies the description file pays for Scene’s draft.</h1></div>
<dl class="bz-who-list" style="left:${MARGIN}px;top:${CHART.top - 30}px">
  <dt>Would pay</dt><dd>Distributors and streaming services${pays}</dd>
  <dt>Uses</dt><dd>Description writers and editors</dd>
  <dt>Benefits</dt><dd>Blind and low-vision viewers: ${esc(AUDIENCE.koreansRegistered)} registered in Korea; nearly two in three of the world’s blind live in Asia-Pacific${serves}</dd>
</dl>
<div class="bz-rels" style="left:${MARGIN}px;top:${RELEASES.top}px">
  <p class="label">Korean releases, 2025${releases}</p>
  ${bar(KOFIC_2025.releases, "released")}
  ${bar(KOFIC_2025.accessible, "with an accessible version")}
  ${bar(KOFIC_2025.screened, "in a barrier-free screening")}
  <p class="bz-start">Korean films mostly get a file already. We start with foreign films, ₩${HAND_MADE.foreignWonMillions}M each by hand, and streaming.</p>
</div>
<p class="label bz-chartl" style="left:${CHART.label}px;top:${CHART.top - 56}px">Price per finished minute, log scale${prices}</p>
${ticks}${rows}
<p class="bz-hyp" style="left:${CHART.label}px;top:${axisTop + 72}px;width:${W - MARGIN - CHART.label}px"><b>Our price</b> is a hypothesis: below human-written description.</p>`,
  });
}

export const BUSINESS_CSS = `
.bz-who-list { position:absolute; width:800px; display:grid; grid-template-columns:150px 1fr; row-gap:24px; column-gap:24px; }
.bz-who-list dt { font-size:24px; font-weight:600; color:var(--ink-300); padding-top:6px; }
.bz-who-list dd { font-size:30px; line-height:1.3; color:var(--ink-100); }
.bz-rels { position:absolute; width:800px; }
.bz-rel { display:flex; align-items:center; gap:16px; margin-top:14px; height:${RELEASES.barH + 8}px; }
.bz-rel i { display:block; flex:none; height:${RELEASES.barH}px; background:var(--dialogue); border-radius:2px; }
.bz-rel span { font-size:24px; color:var(--ink-300); white-space:nowrap; font-variant-numeric:tabular-nums; }
.bz-rel b { font-weight:600; color:var(--ink-100); }
.bz-start { margin-top:18px; font-size:28px; line-height:1.3; color:var(--ink-100); }
.bz-chartl { position:absolute; }
.bz-who { position:absolute; width:360px; font-size:24px; line-height:1.3; color:var(--ink-300); font-variant-numeric:tabular-nums; }
.bz-who b { display:block; font-weight:600; color:var(--ink-100); }
.bz-marks { position:absolute; left:0; width:${W}px; height:18px; }
.bz-range { position:absolute; top:1px; height:16px; background:var(--ink-300); border-radius:8px; }
.bz-dot { position:absolute; top:0; width:18px; height:18px; border-radius:50%; background:var(--ink-300); }
.bz-dot.hollow { background:var(--screen); border:3px solid var(--ink-100); }
.bz-tick { position:absolute; width:1px; background:var(--rule); }
.bz-t { position:absolute; transform:translateX(-50%); font-size:24px; color:var(--ink-400); font-variant-numeric:tabular-nums; }
.bz-hyp { position:absolute; font-size:28px; line-height:1.35; color:var(--ink-300); }
.bz-hyp b { font-weight:600; color:var(--ink-100); }
`;
