/**
 * 10. Scene listens twice: the first eleven seconds of the opening, drawn to one seconds scale. From the
 * top: the soundtrack's spectrogram (the voice is visible), with the launch call's true place carried
 * down as a band; Scene's first listen of the whole clip, which mistimed the call and left a silence
 * over it; listening once (the evaluation's run, 22 Sep), the line Scene wrote into that silence,
 * spoken over the call; listening twice (23 Sep), the second listen, which heard the call and closed
 * the silence, so no line lies there. Under it, what Scene does. The band comes from the second
 * recognizer the build runs (data/recognizers), which stays a build check and is not named on the slide.
 */
import { analysis } from "../data/analysis";
import { launchCall as lc, OPENING_SPAN } from "../data/recognizers";
import { opening } from "../data/sample";
import { esc, intro, PASS_MARK, px, REJECT_MARK, slide } from "../html";
import { LAUNCH_SPECTROGRAM, spectrogramUrl } from "../spectrogram";
import { MARGIN, W } from "../theme";

const X0 = 440;
const X1 = W - MARGIN;
const Y = {
  spec: 258,
  words: 460,
  chirp: 530,
  before: 616,
  after: 702,
  axis: 782,
  now: 864,
};
const LANE_H = 36;
/** How far the call's band reaches above the first lane. */
const BAND_ABOVE = 14;
/** Space between a lane's last mark and the verdict written after it. */
const VERDICT_GAP = 24;
const AXIS_LABEL_STEP_S = 2;

const pps = (X1 - X0) / (OPENING_SPAN[1] - OPENING_SPAN[0]);
const x = (t: number) => X0 + (t - OPENING_SPAN[0]) * pps;

export function caughtSlide(): string {
  if (
    LAUNCH_SPECTROGRAM.from !== OPENING_SPAN[0] ||
    LAUNCH_SPECTROGRAM.to !== OPENING_SPAN[1] ||
    Math.abs(LAUNCH_SPECTROGRAM.width - (X1 - X0)) > 1
  )
    throw new Error("the spectrogram is not drawn to the slide's seconds scale");
  const { gap, line } = lc.before;
  const heardAgain = lc.after.relisten;
  if (analysis.runId !== lc.after.relistenRunId)
    throw new Error("the second listen drawn is not from the run whose hearing the sample reused");
  // The after lane draws the sample's lines in the span: there are none to draw.
  const firstLine = Math.min(...opening.lines.map((l) => l.start));
  if (firstLine < OPENING_SPAN[1])
    throw new Error("a line of the sample starts inside the drawn span; the after lane shows none");
  const call = lc.slices.find((s) => s.start === lc.heard.start);
  if (!call) throw new Error("the launch call is not one of the slices");

  const spectrogram = `<img class="still" src="${spectrogramUrl(LAUNCH_SPECTROGRAM)}" alt="" style="left:${X0}px;top:${Y.spec}px;width:${LAUNCH_SPECTROGRAM.width}px;height:${LAUNCH_SPECTROGRAM.height}px">`;
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
  // The call's true place, as the slices hear it, carried down through the lanes below.
  const bandTop = Y.chirp - BAND_ABOVE;
  const callBand = `<div class="cg-band" style="left:${px(x(call.start))};width:${px(x(call.end) - x(call.start))};top:${bandTop}px;height:${Y.after + LANE_H - bandTop}px"></div>`;
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
${intro("The first listen mistimed the launch call, so Scene listens twice.", undefined, 1500)}
${spectrogram}
${head(Y.spec, LAUNCH_SPECTROGRAM.height, "Sound", "voice band")}
${callBand}
<p class="cg-said" style="left:${px(x(call.start))};top:${Y.words}px">${esc(call.text)}</p>
${head(Y.chirp, LANE_H, "Scene’s first listen", "whole clip")}
${lane(Y.chirp, firstLane)}
${head(Y.before, LANE_H, "Listening once", "Scene’s line")}
${lane(Y.before, beforeLane)}
<p class="verdict cg-v" style="left:${px(verdictX)};top:${Y.before}px;line-height:${LANE_H}px">${REJECT_MARK}<span>spoken over the call</span></p>
${head(Y.after, LANE_H, "Listening twice", "second listen")}
${lane(Y.after, speechBlock(heardAgain))}
<p class="verdict cg-v" style="left:${px(verdictX)};top:${Y.after}px;line-height:${LANE_H}px">${PASS_MARK}<span>call heard, silence closed, no line</span></p>
<div class="cg-axis" style="top:${Y.axis}px"></div>
<div style="position:absolute;left:0;width:${W}px;top:${Y.axis}px">${ticks}</div>
<div class="cg-now" style="left:${MARGIN}px;top:${Y.now}px;width:${W - 2 * MARGIN}px">
  <p class="body">Before it writes into a silence, Scene listens to it again on its own. Here that caught the launch call and kept the line out.</p>
</div>`,
  });
}

export const CAUGHT_CSS = `
.cg-head { position:absolute; left:${MARGIN}px; width:${X0 - MARGIN - 24}px; display:flex; flex-direction:column; justify-content:center; }
.cg-head .label { white-space:nowrap; line-height:1.2; }
.cg-sub { font-size:var(--fs-label); line-height:1.2; color:var(--ink-400); white-space:nowrap; }
.cg-said { position:absolute; font-size:var(--fs-label); line-height:30px; font-weight:600; color:var(--ink-100); white-space:nowrap; }
.cg-band { position:absolute; background:rgba(236,233,227,.06); border-left:1px dashed var(--tick); border-right:1px dashed var(--tick); }
.cg-gap { position:absolute; top:0; height:100%; background:rgba(236,233,227,.1); box-shadow:inset 0 0 0 2px rgba(236,233,227,.5);
  border-radius:3px; display:flex; align-items:center; }
.cg-gap span { padding-left:12px; font-size:var(--fs-label); font-weight:500; color:var(--ink-100); white-space:nowrap; }
.cg-v { position:absolute; white-space:nowrap; }
.cg-axis { position:absolute; left:${X0}px; width:${X1 - X0}px; height:2px; background:var(--rule); }
.cg-tick { position:absolute; top:0; width:1px; height:12px; background:var(--tick); }
.cg-t { position:absolute; top:16px; font-size:var(--fs-label); color:var(--ink-400); font-variant-numeric:tabular-nums; white-space:nowrap; }
.cg-now { position:absolute; border-top:1px solid var(--rule); padding-top:18px; }
.cg-now .body { font-size:var(--fs-body); line-height:1.4; color:var(--ink-100); }
`;
