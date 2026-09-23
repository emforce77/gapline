/**
 * 10. Scene listens twice: the first eleven seconds of the opening, drawn to one seconds scale. From the
 * top: the soundtrack's spectrogram (the voice is visible); the words as a second recognizer hears
 * them slice by slice; Scene's first listen of the whole clip, which put the launch call two seconds
 * early and left a silence over it; listening once (the evaluation's run, 22 Sep), the line Scene
 * wrote into that silence, spoken over the call; listening twice (23 Sep), the second listen, which
 * heard the call and closed the silence, so no line lies there. The runs' days are in the notes. Under
 * it, what Scene does. Runs are compared by time spans (data/recognizers).
 */
import { MIN_GAP_SECONDS } from "../../../src/lib/pipeline/gaps";
import { RELISTEN_PADDING_SECONDS } from "../../../src/lib/pipeline/relisten";
import { analysis } from "../data/analysis";
import { launchCall as lc, OPENING_SPAN } from "../data/recognizers";
import { opening } from "../data/sample";
import { dayMonthYear, esc, intro, PASS_MARK, px, REJECT_MARK, secs, slide, usd } from "../html";
import { notesFor } from "../notes";
import { LAUNCH_SPECTROGRAM, spectrogramUrl, VOICE_BAND_HZ } from "../spectrogram";
import { MARGIN, W } from "../theme";

const X0 = 440;
const X1 = W - MARGIN;
const Y = {
  spec: 258,
  words: 452,
  slices: 490,
  chirp: 590,
  before: 668,
  after: 746,
  axis: 822,
  now: 894,
};
const LANE_H = 36;
/** Where the arrow from the first listen's placement turns towards the words' true place. */
const ARROW_Y = 560;
/** Space between a lane's last mark and the verdict written after it. */
const VERDICT_GAP = 24;
const AXIS_LABEL_STEP_S = 2;
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five"];
/** Dollar figures in the notes: four decimals, as the run ledgers keep them. */
const NOTE_USD_DIGITS = 4;

const pps = (X1 - X0) / (OPENING_SPAN[1] - OPENING_SPAN[0]);
const x = (t: number) => X0 + (t - OPENING_SPAN[0]) * pps;
const mid = (s: { start: number; end: number }) => (x(s.start) + x(s.end)) / 2;
/** SVG path coordinates: plain numbers, two decimals. */
const n2 = (v: number) => Math.round(v * 100) / 100;
/** Seconds as the notes write a span: "4.40–6.16 s". */
const range = (s: { start: number; end: number }) => `${s.start.toFixed(2)}–${secs(s.end)}`;
/** A run's day in Seoul, as the notes write it: "22 Sep 2026". */
const seoulDay = (d: Date) =>
  dayMonthYear(d.toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" }));
/** A quoted phrase inside a sentence of the notes, without its own full stop. */
const quoted = (text: string) => `“${esc(text.replace(/\.$/, ""))}”`;
/** The short run id the notes print: the part after the last dash. */
const shortId = (runId: string) => `…${runId.slice(runId.lastIndexOf("-") + 1)}`;

export function caughtSlide(): string {
  const note = notesFor("Scene listens twice");
  if (
    LAUNCH_SPECTROGRAM.from !== OPENING_SPAN[0] ||
    LAUNCH_SPECTROGRAM.to !== OPENING_SPAN[1] ||
    Math.abs(LAUNCH_SPECTROGRAM.width - (X1 - X0)) > 1
  )
    throw new Error("the spectrogram is not drawn to the slide's seconds scale");
  const early = NUMBER_WORDS[Math.round(lc.early)];
  if (!early) throw new Error(`no word for ${lc.early} s`);
  const { gap, line } = lc.before;
  const heardAgain = lc.after.relisten;
  if (analysis.runId !== lc.after.relistenRunId)
    throw new Error("the second-listen note's day is not the day of the run that listened again");
  // The after lane draws the sample's lines in the span: there are none to draw.
  const firstLine = Math.min(...opening.lines.map((l) => l.start));
  if (firstLine < OPENING_SPAN[1])
    throw new Error("a line of the sample starts inside the drawn span; the after lane shows none");
  const call = lc.slices.find((s) => s.start === lc.heard.start);
  if (!call) throw new Error("the launch call is not one of the slices");

  const sliceNote = note(
    `A second recognizer (${esc(lc.source)}, on a CPU) on ${lc.slices.map((s) => `${s.from.toFixed(2)}–${s.to.toFixed(2)}`).join(", ")} s of the clip, ${dayMonthYear(lc.checkedAt)}: ${lc.slices.map((s) => quoted(s.text)).join(", ")}. On the whole clip it puts the call at ${range(lc.wholeClip)}. Above: the clip’s soundtrack, 0–${VOICE_BAND_HZ / 1000} kHz (ffmpeg); stacked harmonics are a voice.`,
  );
  const firstNote = note(
    `Speech-to-Text v2, Chirp 3, on the whole clip; both runs below heard the same. It put ${quoted(lc.text)} at ${range(lc.chirp)}, where the slices find ${quoted(lc.slices[0].text)}, and heard nothing from ${gap.start.toFixed(2)} to ${secs(gap.end)}.`,
  );
  const beforeNote = note(
    `The evaluation’s default run of this clip, ${seoulDay(lc.before.day)} (${esc(lc.before.runId)}): Scene wrote the title card “<span lang="ko">${esc(line.text)}</span>” (${esc(line.gloss)}) into that silence at ${secs(line.start)}, voiced ${secs(line.voiced)}; it passed review and played over the call.`,
  );
  const afterNote = note(
    `Run ${esc(lc.after.relistenRunId)}, ${seoulDay(analysis.day)}, whose hearing the sample (${esc(shortId(lc.after.runId))}) reused: Chirp 3 recognized the clip’s ${lc.after.report.gapsChecked} silences again (${lc.after.report.billedSeconds} billed seconds, ${usd(lc.after.report.costUsd, NOTE_USD_DIGITS)}), found ${lc.after.report.wordsFound} words and closed ${secs(lc.after.report.blockedSeconds)} of room: ${quoted(heardAgain.text)}, at ${range(heardAgain)}. The sample’s first line starts at ${secs(firstLine)}.`,
  );
  const nowNote = note(
    `Before any line is written, Scene recognizes each silence of ${MIN_GAP_SECONDS} s or more again on its own, with ${RELISTEN_PADDING_SECONDS} s of audio either side; words it finds close the silence. A unit test replays this case with the slices’ timing.`,
  );

  const spectrogram = `<img class="still" src="${spectrogramUrl(LAUNCH_SPECTROGRAM)}" alt="" style="left:${X0}px;top:${Y.spec}px;width:${LAUNCH_SPECTROGRAM.width}px;height:${LAUNCH_SPECTROGRAM.height}px">`;
  const sliceLane = lc.slices
    .map(
      (s) =>
        `<div class="lane cg-slice" style="left:${px(x(s.from))};width:${px(x(s.to) - x(s.from))};top:${Y.slices}px;height:${LANE_H}px">${s.words
          .map(
            (w) =>
              `<div class="clip dialogue" style="left:${px(x(w.start) - x(s.from))};width:${px(Math.max((w.end - w.start) * pps, 2))}"></div>`,
          )
          .join("")}</div>`,
    )
    .join("");
  const speechBlock = (s: { start: number; end: number }) =>
    `<div class="clip dialogue" style="left:${px(x(s.start) - X0)};width:${px(Math.max((s.end - s.start) * pps, 2))}"></div>`;
  const firstLane =
    lc.chirpSpeech.map(speechBlock).join("") +
    `<div class="cg-gap" style="left:${px(x(gap.start) - X0)};width:${px(gap.seconds * pps)}"><span>looked silent</span></div>`;
  const beforeLane =
    `<div class="room" style="left:${px(x(line.start) - X0)};width:${px((line.windowEnd - line.start) * pps)}"></div>` +
    `<div class="clip ad" style="left:${px(x(line.start) - X0)};width:${px(line.voiced * pps)}"></div>`;
  // Both verdicts start after the before-run's silence, so they read as one column.
  const verdictX = x(Math.max(gap.end, heardAgain.end)) + VERDICT_GAP;
  const arrow = `<svg class="cg-svg" width="${W}" height="1080" viewBox="0 0 ${W} 1080" aria-hidden="true">
  <defs><marker id="cg-h" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#ece9e3"/></marker></defs>
  <path d="M${n2(mid(lc.chirp))} ${Y.chirp - 4} V${ARROW_Y} H${n2(mid(lc.heard))} V${Y.slices + LANE_H + 8}" class="cg-arrow" marker-end="url(#cg-h)"/>
</svg>`;
  // The call's true place, as the slices hear it, carried down through the lanes below.
  const callBand = `<div class="cg-band" style="left:${px(x(call.start))};width:${px(x(call.end) - x(call.start))};top:${Y.slices}px;height:${Y.after + LANE_H - Y.slices}px"></div>`;
  const ticks = Array.from(
    { length: OPENING_SPAN[1] - OPENING_SPAN[0] + 1 },
    (_, i) => OPENING_SPAN[0] + i,
  )
    .map((t) => {
      const tick = `<div class="cg-tick" style="left:${px(x(t))}"></div>`;
      if (t === OPENING_SPAN[1])
        return `${tick}<p class="cg-t" style="right:${px(W - x(t))}">${t} s</p>`;
      if (t % AXIS_LABEL_STEP_S !== 0) return tick;
      return `${tick}<p class="cg-t" style="left:${px(x(t))};transform:translateX(-50%)">${t}</p>`;
    })
    .join("");
  const head = (top: number, height: number, label: string, sub = "") =>
    `<div class="cg-head" style="top:${top}px;height:${height}px"><p class="label">${label}</p>${sub ? `<p class="cg-sub">${sub}</p>` : ""}</div>`;
  const lane = (top: number, inner: string) =>
    `<div class="lane" style="left:${X0}px;width:${px(X1 - X0)};top:${top}px;height:${LANE_H}px">${inner}</div>`;

  return slide({
    id: "s-caught",
    name: "caught",
    kind: "exhibit",
    body: `
${intro(`Speech timing can be ${early} seconds off, so Scene listens twice.`, undefined, 1500)}
${spectrogram}
${head(Y.spec, LAUNCH_SPECTROGRAM.height, "Sound", "voice band")}
${callBand}
<p class="cg-said" style="left:${px(x(call.start))};top:${Y.words}px">${esc(call.text)}</p>
${head(Y.slices, LANE_H, `Another recognizer${sliceNote}`, "slice by slice")}
${sliceLane}
${arrow}
<p class="cg-early" style="right:${px(W - mid(lc.chirp) + 14)};top:${ARROW_Y - 34}px">${secs(lc.early)} early</p>
${head(Y.chirp, LANE_H, `Scene’s first listen${firstNote}`, "whole clip")}
${lane(Y.chirp, firstLane)}
${head(Y.before, LANE_H, `Listening once${beforeNote}`, "Scene’s line")}
${lane(Y.before, beforeLane)}
<p class="verdict cg-v" style="left:${px(verdictX)};top:${Y.before}px;line-height:${LANE_H}px">${REJECT_MARK}<span>spoken over the call</span></p>
${head(Y.after, LANE_H, `Listening twice${afterNote}`, "second listen")}
${lane(Y.after, speechBlock(heardAgain))}
<p class="verdict cg-v" style="left:${px(verdictX)};top:${Y.after}px;line-height:${LANE_H}px">${PASS_MARK}<span>call heard, silence closed, no line</span></p>
<div class="cg-axis" style="top:${Y.axis}px"></div>
<div style="position:absolute;left:0;width:${W}px;top:${Y.axis}px">${ticks}</div>
<div class="cg-now" style="left:${MARGIN}px;top:${Y.now}px;width:${W - 2 * MARGIN}px">
  <p class="body">Before it writes into a silence, Scene listens to it again on its own. Here that caught the launch call and kept the line out.${nowNote}</p>
</div>`,
  });
}

export const CAUGHT_CSS = `
.cg-head { position:absolute; left:${MARGIN}px; width:${X0 - MARGIN - 24}px; display:flex; flex-direction:column; justify-content:center; }
.cg-head .label { white-space:nowrap; line-height:1.2; }
.cg-sub { font-size:var(--fs-label); line-height:1.2; color:var(--ink-400); white-space:nowrap; }
.cg-said { position:absolute; font-size:var(--fs-label); line-height:30px; font-weight:600; color:var(--ink-100); white-space:nowrap; }
.cg-slice { background:var(--lane); }
.cg-band { position:absolute; background:rgba(236,233,227,.06); border-left:1px dashed var(--tick); border-right:1px dashed var(--tick); }
.cg-gap { position:absolute; top:0; height:100%; background:rgba(236,233,227,.1); box-shadow:inset 0 0 0 2px rgba(236,233,227,.5);
  border-radius:3px; display:flex; align-items:center; }
.cg-gap span { padding-left:12px; font-size:var(--fs-label); font-weight:500; color:var(--ink-100); white-space:nowrap; }
.cg-svg { position:absolute; left:0; top:0; }
.cg-arrow { fill:none; stroke:var(--ink-100); stroke-width:2; }
.cg-early { position:absolute; font-size:var(--fs-label); line-height:1.3; font-weight:600; color:var(--ink-100); white-space:nowrap; }
.cg-v { position:absolute; white-space:nowrap; }
.cg-axis { position:absolute; left:${X0}px; width:${X1 - X0}px; height:2px; background:var(--rule); }
.cg-tick { position:absolute; top:0; width:1px; height:12px; background:var(--tick); }
.cg-t { position:absolute; top:16px; font-size:var(--fs-label); color:var(--ink-400); font-variant-numeric:tabular-nums; white-space:nowrap; }
.cg-now { position:absolute; border-top:1px solid var(--rule); padding-top:18px; }
.cg-now .body { font-size:var(--fs-body); line-height:1.4; color:var(--ink-100); }
`;
