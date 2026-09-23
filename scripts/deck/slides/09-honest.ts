/**
 * 09. Scene says what a track still misses: the final check of the automatic Korean run, as the two
 * things it listed, pinned to the last 25 s of the opening where they happen, over the automatic lines
 * and the lines after an editor filled both places. Under it, what the evaluation says about that
 * check: every finished default run flagged, and the cheaper setting that said "checked" too easily.
 */
import { autoCheck, finalRun, opening } from "../data/demo";
import { launchCall } from "../data/recognizers";
import { evaluationFacts, evaluationGrid } from "../data/evaluation";
import { gloss } from "../glosses";
import { esc, px, secs, slide } from "../html";
import { notesFor } from "../notes";
import { MARGIN, W } from "../theme";

/** The stretch of the opening the exhibit shows: both misses and the lines around them. */
const DOMAIN = [40, 65] as const;
const X0 = 360;
const X1 = W - MARGIN;
const Y = { cards: 214, cardH: 290, lanes: 560, laneH: 44, laneGap: 14, axis: 740, facts: 836 };
const AXIS_STEP_S = 5;
const CARD_W = [640, 700];
/** The clip where the cheaper setting said "checked" while both essential facts were missing. */
const INTERVIEW_ID = "eval-ko-intro";

const pps = (X1 - X0) / (DOMAIN[1] - DOMAIN[0]);
const x = (t: number) => X0 + (Math.max(DOMAIN[0], Math.min(DOMAIN[1], t)) - DOMAIN[0]) * pps;
const inDomain = (s: { start: number; end: number }) => s.end > DOMAIN[0] && s.start < DOMAIN[1];
const laneTop = (i: number) => Y.lanes + i * (Y.laneH + Y.laneGap);

export function honestSlide(): string {
  const note = notesFor(9, "Scene says what a track still misses");
  const f = evaluationFacts;
  const finishedMedium = evaluationGrid.filter((row) =>
    ["review_needed", "checked"].includes(row.cells.medium.kind),
  );
  const checkedMedium = finishedMedium.filter((row) => row.cells.medium.kind === "checked");
  const missed = f.checkedButMissed[0];
  if (missed.id !== INTERVIEW_ID)
    throw new Error("the cheaper setting's miss moved to another clip");
  if (autoCheck.missing.some((m) => m.at < DOMAIN[0] || m.at > DOMAIN[1]))
    throw new Error("a listed miss falls outside the exhibit's stretch");
  const still = autoCheck.stillMissing;
  if (autoCheck.finalStatus !== "review_needed")
    throw new Error("the finished track is no longer marked Review needed; the note says it is");
  const stillList = still
    .map(
      (m) =>
        `${secs(m.at, 1)} (“${esc(m.gloss)}”${m.duringDialogue ? ", during dialogue, where there is no room" : ""})`,
    )
    .join(", ");
  // The moment listed in the silence over the launch call is explained in the note.
  const overCall = still.find((m) => m.gapId === launchCall.gap.id);
  if (!overCall)
    throw new Error("the finished track's check no longer lists the launch-call silence");

  const shortest = autoCheck.lines
    .filter((l) => l.start >= DOMAIN[0])
    .reduce((a, b) => (b.voiced < a.voiced ? b : a));
  const listNote = note(
    `Scene’s final check on the automatic Korean run of the ${opening.clip} s opening (default reviewer, 22 Sep 2026) marked it “Review needed” and listed these two moments, in Korean; the English is ours. They are the check’s findings, not lines to be spoken. A model decides what counts as missing. The automatic run’s short line at ${secs(shortest.start, 1)} is “${esc(gloss(shortest.text))}” (${secs(shortest.voiced)}).`,
  );
  const filledNote = note(
    `The editor’s lines: “${esc(autoCheck.missing.map((m) => m.filled.gloss).join("” and “"))}” The finished track is checked again and is still “Review needed”: it lists ${still.length} moments: ${stillList}. At ${secs(overCall.at, 1)} an editor removed a line spoken over the launch call; the check reads Chirp 3’s timings, which leave that stretch silent.`,
  );
  const runs = note(
    `${f.runs} test runs on ${f.clips} openly licensed clips, 22 Sep 2026; every run is in the evaluation write-up in the repo.`,
  );
  const cheaper = note(
    `Same rules, less reasoning. On the ${missed.seconds} s Korean interview it said “checked” while both essential facts, written down before the run, were missing; the default reviewer listed both.`,
  );

  const cards = autoCheck.missing
    .map((m, i) => {
      const left = i === 0 ? X0 : X1 - CARD_W[i];
      const at = x(m.at);
      if (at < left + 24 || at > left + CARD_W[i] - 24)
        throw new Error(`the pin at ${m.at} s falls outside its card`);
      return (
        `<div class="hn-card" data-fit style="left:${px(left)};top:${Y.cards}px;width:${CARD_W[i]}px;height:${Y.cardH}px"><p class="hn-at mono">missing at ${secs(m.at, 1)}</p><p class="hn-what">${esc(m.gloss)}${i === 0 ? listNote : ""}</p><p class="hn-ko" lang="ko">${esc(m.what)}</p></div>` +
        `<div class="hn-pin" style="left:${px(at - 1)};top:${Y.cards + Y.cardH}px;height:${laneTop(0) + Y.laneH / 2 - Y.cards - Y.cardH}px"></div>` +
        `<div class="hn-dot" style="left:${px(at - 9)};top:${laneTop(0) + Y.laneH / 2 - 9}px"></div>`
      );
    })
    .join("");
  const clip = (s: { start: number; end: number }, cls: string, text = "") =>
    `<div class="clip ${cls}" style="left:${px(x(s.start) - X0)};width:${px(Math.max(x(s.end) - x(s.start), 2))}">${text ? `<span class="hn-in">${text}</span>` : ""}</div>`;
  const speech = finalRun.speech.filter(inDomain).map((s) => clip(s, "dialogue"));
  const before = autoCheck.lines
    .map((l) => ({ start: l.start, end: l.start + l.voiced }))
    .filter(inDomain)
    .map((s) => clip(s, "ad"));
  const typed = opening.lines.filter((l) => l.byEditor);
  if (
    typed.length !== autoCheck.missing.length ||
    typed.some((l, i) => l.id !== autoCheck.missing[i].filled.id)
  )
    throw new Error("the editor's lines do not match the listed misses");
  const after = opening.lines
    .map((l) => ({ start: l.start, end: l.start + l.voiced, id: l.id }))
    .filter(inDomain)
    .map((s) => {
      const editor = typed.findIndex((l) => l.id === s.id);
      return clip(s, "ad", editor < 0 ? "" : `editor${editor === 0 ? filledNote : ""}`);
    });
  const lanes = [
    ["Automatic run", before],
    ["After an editor", after],
    ["Dialogue", speech],
  ] as const;
  const laneHtml = lanes
    .map(
      ([label, clips], i) =>
        `<p class="label hn-lane-l" style="top:${laneTop(i)}px;line-height:${Y.laneH}px">${label}</p><div class="lane" style="left:${X0}px;width:${px(X1 - X0)};top:${laneTop(i)}px;height:${Y.laneH}px">${clips.join("")}</div>`,
    )
    .join("");
  const ticks = Array.from(
    { length: (DOMAIN[1] - DOMAIN[0]) / AXIS_STEP_S + 1 },
    (_, i) => DOMAIN[0] + i * AXIS_STEP_S,
  )
    .map(
      (t) =>
        `<div class="hn-tick" style="left:${px(x(t))}"></div><p class="hn-t" style="${t === DOMAIN[1] ? `right:${px(W - x(t))}` : `left:${px(x(t))};transform:translateX(-50%)`}">${t === DOMAIN[1] ? `${t} s` : t}</p>`,
    )
    .join("");

  return slide({
    id: "s-honest",
    name: "honest",
    folio: 9,
    kind: "exhibit",
    body: `
<div class="intro"><h1 class="headline" style="max-width:1728px">Scene says what a track still misses.</h1></div>
${laneHtml}
${cards}
<div class="hn-axis" style="top:${Y.axis}px"></div>
<div style="position:absolute;left:0;width:${W}px;top:${Y.axis}px">${ticks}</div>
<div class="hn-facts" style="left:${MARGIN}px;top:${Y.facts}px;width:${W - 2 * MARGIN}px">
  <p>${f.defaultFlagged} of ${f.defaultFinished} finished test runs with the default reviewer came back “Review needed”, each with a list.${runs}</p>
  <p>A cheaper setting said “checked” for ${checkedMedium.length} of ${finishedMedium.length}, one missing both essential facts; we kept the stricter reviewer.${cheaper}</p>
</div>`,
  });
}

export const HONEST_CSS = `
.hn-card { position:absolute; border-top:3px solid var(--ink-100); padding-top:12px; }
.hn-at { font-size:24px; color:var(--ink-300); }
.hn-what { margin-top:8px; font-family:var(--serif); font-size:36px; line-height:1.2; color:var(--ink-100); text-wrap:balance; }
.hn-ko { margin-top:10px; font-size:24px; line-height:1.4; color:var(--ink-300); }
.hn-pin { position:absolute; width:2px; background:var(--ink-100); }
.hn-dot { position:absolute; width:18px; height:18px; border-radius:50%; border:3px solid var(--ink-100); background:var(--screen); }
.hn-lane-l { position:absolute; left:${MARGIN}px; white-space:nowrap; }
.hn-in { display:block; padding:0 10px; font-size:22px; font-weight:600; line-height:${Y.laneH}px; }
.hn-in sup.fn a { color:var(--amber-ink); }
.hn-axis { position:absolute; left:${X0}px; width:${X1 - X0}px; height:2px; background:var(--rule); }
.hn-tick { position:absolute; top:0; width:1px; height:12px; background:var(--tick); }
.hn-t { position:absolute; top:16px; font-size:24px; color:var(--ink-400); font-variant-numeric:tabular-nums; white-space:nowrap; }
.hn-facts { position:absolute; display:grid; grid-template-columns:1fr 1fr; column-gap:80px; border-top:1px solid var(--rule); padding-top:22px; }
.hn-facts p { font-size:28px; line-height:1.4; color:var(--ink-300); }
`;
