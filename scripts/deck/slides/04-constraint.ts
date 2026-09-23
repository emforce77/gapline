/**
 * 04. The constraint, drawn from the sample track on a plain seconds axis: picture, dialogue (every
 * segment Scene heard, overlaps drawn once) with the usable silences outlined and labelled, and
 * Scene's lines as measured voice inside each line's slot. The launch call that only the second listen
 * heard is bracketed, so the silence it closed reads as dialogue.
 */
import { MIN_GAP_SECONDS, SPEECH_GUARD_SECONDS } from "../../../src/lib/pipeline/gaps";
import { launchCall, nearestSpeech } from "../data/recognizers";
import { unionOf } from "../data/runs";
import { opening, seven } from "../data/sample";
import { gloss } from "../glosses";
import { esc, px, secs, slide } from "../html";
import { notesFor } from "../notes";
import { stillUrl, thumbTimes } from "../stills";
import { MARGIN, W } from "../theme";

const X0 = 440;
const X1 = W - MARGIN;
const Y = {
  thumbs: 318,
  thumbsH: 96,
  notes: 432,
  bracket: 482,
  dlg: 494,
  dlgH: 60,
  gapLabels: 562,
  lines: 648,
  linesH: 46,
  axis: 730,
  result: 826,
};
/** Direct labels inside the lane, placed on the widest stretch of each kind. */
const IN_LANE_MIN_W = 130;
const AXIS_STEP_S = 10;
/** Every other tick is labelled: the seconds matter less than where the silences fall. */
const AXIS_LABEL_STEP_S = 20;
/** A round tick label closer than this to the end label is left out, so "60" and "65 s" do not touch. */
const END_LABEL_CLEAR_PX = 120;
/** Gap to leave between a callout's text and the top of its leader. */
const LEADER_TOP = 38;
const KMCC_P10 =
  "화면해설이 침범할 수 없는 영역은 대사와 중요한 음향 효과로 지정하는 것이 바람직함";

const pps = (X1 - X0) / opening.clip;
const x = (t: number) => X0 + t * pps;

export function constraintSlide(): string {
  const note = notesFor("Fit the silence");
  const slot = opening.clip / thumbTimes.length;
  const thumbs = thumbTimes
    .map(
      (_, i) =>
        `<img class="still" src="${stillUrl(`thumb-${i}`)}" alt="" style="left:${px(x(i * slot))};top:${Y.thumbs}px;width:${px(slot * pps - 3)};height:${Y.thumbsH}px">`,
    )
    .join("");
  const gaps = opening.gaps
    .map(
      (g) =>
        `<div class="ct-gap" style="left:${px(x(g.start) - X0)};width:${px((g.end - g.start) * pps)}"></div>`,
    )
    .join("");
  const gapLabels = opening.gaps
    .map((g, i) => {
      // The first and last labels hug their ends so nothing hangs past the axis.
      const pos =
        i === 0
          ? `left:${px(x(g.start))}`
          : i === opening.gaps.length - 1
            ? `right:${px(W - x(g.end))};text-align:right`
            : `left:${px(x((g.start + g.end) / 2))};transform:translateX(-50%)`;
      return `<p class="ct-gl" style="${pos};top:${Y.gapLabels}px">${secs(g.seconds, 1)}</p>`;
    })
    .join("");

  // Dialogue as heard: the first pass and the second listen, where they overlap drawn once.
  const heard = unionOf(opening.speech);
  const widestGap = opening.gaps.reduce((m, g) => (g.seconds > m.seconds ? g : m));
  const widestSpeech = heard.reduce((m, s) => (s.end - s.start > m.end - m.start ? s : m));
  if (
    (widestGap.end - widestGap.start) * pps < IN_LANE_MIN_W ||
    (widestSpeech.end - widestSpeech.start) * pps < IN_LANE_MIN_W
  )
    throw new Error("no stretch wide enough for an in-lane label");
  const inLane =
    `<p class="ct-in" style="left:${px(x(widestGap.start) + 12)};top:${Y.dlg}px;line-height:${Y.dlgH}px">usable silence</p>` +
    `<p class="ct-in dark" style="left:${px(x(widestSpeech.start) + 12)};top:${Y.dlg}px;line-height:${Y.dlgH}px">dialogue</p>`;
  const speech = heard
    .map(
      (s) =>
        `<div class="clip dialogue" style="left:${px(x(s.start) - X0)};width:${px(Math.max((s.end - s.start) * pps, 2))}"></div>`,
    )
    .join("");
  const lines = opening.lines
    .map(
      (l) =>
        `<div class="room" style="left:${px(x(l.start) - X0)};width:${px((l.windowEnd - l.start) * pps)}"></div>` +
        `<div class="clip ad" style="left:${px(x(l.start) - X0)};width:${px(l.voiced * pps)}"></div>`,
    )
    .join("");
  const ticks = Array.from(
    { length: Math.floor(opening.clip / AXIS_STEP_S) + 1 },
    (_, i) => i * AXIS_STEP_S,
  )
    .concat(opening.clip)
    .map((t) => {
      const tick = `<div class="ct-tick" style="left:${px(x(t))}"></div>`;
      if (t === opening.clip)
        return `${tick}<p class="ct-t" style="right:${px(W - x(t))}">${t} s</p>`;
      if (x(opening.clip) - x(t) < END_LABEL_CLEAR_PX || t % AXIS_LABEL_STEP_S !== 0) return tick;
      return `${tick}<p class="ct-t" style="left:${px(x(t))};transform:translateX(-50%)">${t}</p>`;
    })
    .join("");
  const hook = opening.gaps.find((g) => g.id === seven.usable.id);
  if (!hook) throw new Error("the seven-second gap is missing from the timeline");
  const sum = opening.speechTotal + opening.gapTotal + opening.remainder;
  if (Math.abs(sum - opening.clip) > 0.011)
    throw new Error("the three parts do not add up to the clip");
  // The launch call as the second listen heard it: it must be part of the dialogue drawn here.
  const second = launchCall.after.relisten;
  if (!heard.some((s) => s.start <= second.start && s.end >= second.end))
    throw new Error("the second listen's segment is not inside the drawn dialogue");

  const quoteNote = note(
    `Korea Media &amp; Communications Commission (KMCC), 『장애인방송 프로그램 제공 가이드라인』 (guideline for accessible broadcasting), p.10: “${esc(KMCC_P10)}”; our translation. Its clauses are mostly recommendations.`,
  );
  const lanesNote = note(
    `The sample track, one automatic run: ${opening.clip} s = ${opening.speechTotal.toFixed(2)} s dialogue + ${opening.gapTotal.toFixed(2)} s usable silence + ${opening.remainder.toFixed(2)} s margins and short pauses, as Scene’s gap finder made them: a ${SPEECH_GUARD_SECONDS} s margin around speech, no pauses under ${MIN_GAP_SECONDS} s. Dialogue counts each second once where the second listen overlaps the first.`,
  );
  const callNote = note(
    `Chirp 3’s first pass put the launch call, “${esc(launchCall.text)}”, at ${launchCall.chirp.start}–${secs(launchCall.chirp.end)}, ${secs(launchCall.early)} early, so ${launchCall.before.gap.start}–${secs(launchCall.before.gap.end)} looked silent. The second listen recognizes each silence again on its own; it heard the call at ${second.start}–${secs(second.end)} and closed that silence (in an earlier run of the same clip, whose hearing the sample reused). A second recognizer (faster-whisper small) hears it at ${launchCall.heard.start.toFixed(2)}–${secs(launchCall.heard.end)}.`,
  );
  const resultNote = note(
    `Checked by the deck’s build: none of the ${opening.lines.length} lines overlaps speech that Chirp 3 or the second recognizer hears, on the whole clip or slice by slice. The closest starts ${secs(nearestSpeech)} after speech.`,
  );
  const midSecond = (second.start + second.end) / 2;

  return slide({
    id: "s-constraint",
    name: "constraint",
    kind: "exhibit",
    filmCredit: true,
    body: `
<div class="intro split" style="align-items:flex-start">
  <h1 class="headline" style="flex-basis:900px">Every line has to fit a silence that is already in the film.</h1>
  <blockquote class="ct-quote">
    <p class="ct-qgloss">“${esc(gloss(KMCC_P10))}”</p>
    <p class="ct-cite">Korea’s audio-description guideline${quoteNote}</p>
  </blockquote>
</div>
${thumbs}
<div class="ct-head" style="top:${Y.thumbs}px;height:${Y.thumbsH}px"><p class="label">Picture</p></div>
<div class="ct-head" style="top:${Y.dlg}px;height:${Y.dlgH}px"><p class="label">Dialogue${lanesNote}</p></div>
<div class="ct-head" style="top:${Y.lines}px;height:${Y.linesH}px"><p class="label">Scene’s lines</p></div>
<p class="ct-note" style="left:${px(x(second.start))};top:${Y.notes}px">heard on the second listen${callNote}</p>
<div class="ct-leader" style="left:${px(x(midSecond) - 1)};top:${Y.notes + LEADER_TOP}px;height:${Y.bracket - Y.notes - LEADER_TOP}px"></div>
<div class="ct-bracket" style="left:${px(x(second.start))};width:${px((second.end - second.start) * pps)};top:${Y.bracket}px"></div>
<p class="ct-note right" style="right:${px(W - x(hook.end))};top:${Y.notes}px">the seven seconds</p>
<div class="ct-leader" style="left:${px(x((hook.start + hook.end) / 2) - 1)};top:${Y.notes + LEADER_TOP}px;height:${Y.dlg - Y.notes - LEADER_TOP}px"></div>
<div class="lane" style="left:${X0}px;width:${px(X1 - X0)};top:${Y.dlg}px;height:${Y.dlgH}px">${gaps}${speech}</div>
<div class="lane" style="left:${X0}px;width:${px(X1 - X0)};top:${Y.lines}px;height:${Y.linesH}px">${lines}</div>
${inLane}
${gapLabels}
<div class="ct-axis" style="top:${Y.axis}px"></div>
<div style="position:absolute;left:0;width:${W}px;top:${Y.axis}px">${ticks}</div>
<p class="body ct-result" style="left:${MARGIN}px;top:${Y.result}px"><span>Scene fit ${opening.lines.length} lines, ${secs(opening.narrationTotal, 1)} of voice, into ${opening.gaps.length} usable silences in ${opening.clip}${" "}s.</span><span>None talks over speech; a second recognizer confirms it.${resultNote}</span></p>`,
  });
}

export const CONSTRAINT_CSS = `
.ct-quote { flex:0 1 740px; border-top:2px solid var(--rule); padding-top:14px; margin-bottom:6px; }
.ct-qgloss { font-family:var(--serif); font-style:italic; font-size:var(--fs-body); line-height:1.3; color:var(--ink-100); }
.ct-cite { margin-top:8px; font-size:var(--fs-label); line-height:1.35; color:var(--ink-400); }
.ct-head { position:absolute; left:${MARGIN}px; width:${X0 - MARGIN - 24}px; display:flex; flex-direction:column; justify-content:center; }
.ct-head .label { white-space:nowrap; }
.ct-gap { position:absolute; top:0; height:100%; background:rgba(236,233,227,.1); box-shadow:inset 0 0 0 2px rgba(236,233,227,.5); border-radius:3px; }
.ct-gl { position:absolute; text-align:center; font-size:var(--fs-label); color:var(--ink-300);
  font-variant-numeric:tabular-nums; white-space:nowrap; }
.ct-note { position:absolute; font-size:var(--fs-label); color:var(--ink-300); white-space:nowrap; }
.ct-note.right { text-align:right; }
.ct-leader { position:absolute; width:2px; background:var(--ink-300); }
.ct-bracket { position:absolute; height:8px; border:2px solid var(--ink-300); border-bottom:0; }
.ct-axis { position:absolute; left:${X0}px; width:${X1 - X0}px; height:2px; background:var(--rule); }
.ct-tick { position:absolute; top:0; width:1px; height:12px; background:var(--tick); }
.ct-t { position:absolute; top:16px; font-size:var(--fs-label); color:var(--ink-400); font-variant-numeric:tabular-nums; white-space:nowrap; }
.ct-in { position:absolute; font-size:var(--fs-label); font-weight:500; color:var(--ink-100); white-space:nowrap; }
.ct-in.dark { color:#f4f4f5; }
.ct-result { position:absolute; width:${W - 2 * MARGIN}px; color:var(--ink-100); }
.ct-result span { display:block; }
`;
