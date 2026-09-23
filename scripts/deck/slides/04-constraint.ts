/**
 * 04. The constraint, drawn from the final track on a plain seconds axis: picture, dialogue with the
 * usable silences outlined and labelled, and Scene's lines as measured voice inside each line's room.
 * The lines an editor typed say so. The launch call Chirp 3 timed early is drawn where it is heard,
 * inside the silence Chirp 3 left, with the line an editor removed from there struck through.
 */
import { MIN_GAP_SECONDS, SPEECH_GUARD_SECONDS } from "../../../src/lib/pipeline/gaps";
import { opening, seven } from "../data/demo";
import { launchCall } from "../data/recognizers";
import { gloss } from "../glosses";
import { esc, px, REJECT_MARK, secs, slide } from "../html";
import { notesFor } from "../notes";
import { stillUrl, thumbTimes } from "../stills";
import { MARGIN, W } from "../theme";

const X0 = 440;
const X1 = W - MARGIN;
const Y = {
  thumbs: 318,
  thumbsH: 96,
  notes: 432,
  dlg: 494,
  dlgH: 60,
  gapLabels: 562,
  lines: 648,
  linesH: 46,
  lineTags: 700,
  axis: 752,
  result: 850,
};
/** Direct labels inside the lane, placed on the widest stretch of each kind. */
const IN_LANE_MIN_W = 130;
const AXIS_STEP_S = 10;
/** A round tick label closer than this to the end label is left out, so "60" and "65 s" do not touch. */
const END_LABEL_CLEAR_PX = 120;
const KMCC_P10 =
  "화면해설이 침범할 수 없는 영역은 대사와 중요한 음향 효과로 지정하는 것이 바람직함";

const pps = (X1 - X0) / opening.clip;
const x = (t: number) => X0 + t * pps;

export function constraintSlide(): string {
  const note = notesFor(4, "Every line has to fit…");
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
      const short = g.id === opening.shortestId;
      // The first and last labels hug their ends so nothing hangs past the axis.
      const pos =
        i === 0
          ? `left:${px(x(g.start))}`
          : i === opening.gaps.length - 1
            ? `right:${px(W - x(g.end))};text-align:right`
            : `left:${px(x((g.start + g.end) / 2))};transform:translateX(-50%)`;
      // The silence that holds the launch call: its length struck, since it is not silent.
      if (g.id === launchCall.gap.id)
        return `<p class="ct-gl" style="${pos};top:${Y.gapLabels}px"><del class="strike">${g.seconds.toFixed(2)}</del></p>`;
      return `<p class="ct-gl${short ? " short" : ""}" style="${pos};top:${Y.gapLabels}px">${g.seconds.toFixed(2)}${short ? "<span>shortest</span>" : ""}</p>`;
    })
    .join("");
  const widestGap = opening.gaps.reduce((m, g) => (g.seconds > m.seconds ? g : m));
  const widestSpeech = opening.speech.reduce((m, s) => (s.end - s.start > m.end - m.start ? s : m));
  if (
    (widestGap.end - widestGap.start) * pps < IN_LANE_MIN_W ||
    (widestSpeech.end - widestSpeech.start) * pps < IN_LANE_MIN_W
  )
    throw new Error("no stretch wide enough for an in-lane label");
  const inLane =
    `<p class="ct-in" style="left:${px(x(widestGap.start) + 12)};top:${Y.dlg}px;line-height:${Y.dlgH}px">usable silence</p>` +
    `<p class="ct-in dark" style="left:${px(x(widestSpeech.start) + 12)};top:${Y.dlg}px;line-height:${Y.dlgH}px">dialogue</p>`;
  const block = (s: { start: number; end: number }) =>
    `<div class="clip dialogue" style="left:${px(x(s.start) - X0)};width:${px(Math.max((s.end - s.start) * pps, 2))}"></div>`;
  // Chirp 3's first pass, plus the launch call where it is heard (Chirp 3 put its words earlier).
  const speech = [...opening.speech, launchCall.heard].map(block).join("");
  const lines = opening.lines
    .map(
      (l) =>
        `<div class="room" style="left:${px(x(l.start) - X0)};width:${px((l.windowEnd - l.start) * pps)}"></div>` +
        `<div class="clip ad" style="left:${px(x(l.start) - X0)};width:${px(l.voiced * pps)}"></div>`,
    )
    .join("");
  const removed = opening.removed
    .map(
      (l) =>
        `<div class="ct-removed" style="left:${px(x(l.start) - X0)};width:${px(l.voiced * pps)}"></div>`,
    )
    .join("");
  const typed = opening.lines.filter((l) => l.byEditor);
  const ticks = Array.from(
    { length: Math.floor(opening.clip / AXIS_STEP_S) + 1 },
    (_, i) => i * AXIS_STEP_S,
  )
    .concat(opening.clip)
    .map((t) => {
      const tick = `<div class="ct-tick" style="left:${px(x(t))}"></div>`;
      if (t === opening.clip)
        return `${tick}<p class="ct-t" style="right:${px(W - x(t))}">${t} s</p>`;
      if (x(opening.clip) - x(t) < END_LABEL_CLEAR_PX) return tick;
      return `${tick}<p class="ct-t" style="left:${px(x(t))};transform:translateX(-50%)">${t}</p>`;
    })
    .join("");
  const hook = opening.gaps.find((g) => g.id === seven.usable.id);
  if (!hook) throw new Error("the seven-second gap is missing from the timeline");
  const call = launchCall;
  if (opening.removed.length !== 1 || opening.removed[0].id !== call.line.id)
    throw new Error("the slide draws one removed line: the one over the launch call");
  const sum = opening.speechTotal + opening.gapTotal + opening.remainder;
  if (Math.abs(sum - opening.clip) > 0.011)
    throw new Error("the three parts do not add up to the clip");

  const quoteNote = note(
    `Korea Media &amp; Communications Commission (KMCC), 『장애인방송 프로그램 제공 가이드라인』 (guideline for accessible broadcasting), p.10: “${esc(KMCC_P10)}”; our translation. Its clauses are mostly recommendations.`,
  );
  const callNote = note(
    `Chirp 3 put “${esc(call.text)}” at ${call.chirp.start}–${secs(call.chirp.end)}. Recognized slice by slice, a second recognizer (faster-whisper small) hears it at ${call.heard.start.toFixed(2)}–${secs(call.heard.end)}, inside the ${secs(call.gap.seconds)} silence Chirp 3 left at ${call.gap.start}–${secs(call.gap.end)}. Scene’s line there (${secs(call.line.start)}, ${secs(call.line.voiced)} long) played over the call; an editor removed it.`,
  );
  const lanesNote = note(
    `Final track, after ${opening.sessions} editor sessions: ${opening.clip} s = ${opening.speechTotal.toFixed(2)} s dialogue + ${opening.gapTotal.toFixed(2)} s usable silence + ${opening.remainder.toFixed(2)} s margins and short pauses, as Scene’s gap finder made them from Chirp 3’s first pass: a ${SPEECH_GUARD_SECONDS} s margin around its speech, no pauses under ${MIN_GAP_SECONDS} s. ${secs(call.gap.seconds)} of that silence holds the launch call.`,
  );
  const typedNote = note(
    `At ${typed.map((l) => `${l.start} s`).join(" and ")}; Scene voiced, measured and reviewed them like its own. None of the ${opening.lines.length} overlaps speech that Chirp 3 or the second recognizer hears, on the whole clip or slice by slice.`,
  );

  return slide({
    id: "s-constraint",
    name: "constraint",
    folio: 4,
    kind: "exhibit",
    filmCredit: true,
    body: `
<div class="intro split" style="align-items:flex-start">
  <h1 class="headline" style="flex-basis:900px">Every line has to fit a silence that is already in the film.</h1>
  <blockquote class="ct-quote">
    <p class="ct-qgloss">“${esc(gloss(KMCC_P10))}”</p>
    <p class="ct-cite">Korea’s audio-description guideline (KMCC), p.10${quoteNote}</p>
  </blockquote>
</div>
${thumbs}
<div class="ct-head" style="top:${Y.thumbs}px;height:${Y.thumbsH}px"><p class="label">Picture</p></div>
<div class="ct-head" style="top:${Y.dlg}px;height:${Y.dlgH}px"><p class="label">Dialogue${lanesNote}</p></div>
<div class="ct-head" style="top:${Y.lines}px;height:${Y.linesH}px"><p class="label">Scene’s lines <span class="muted">${secs(opening.narrationTotal)}</span></p></div>
<p class="ct-note" style="left:${px(x(call.heard.start))};top:${Y.notes}px">Chirp 3 timed the launch call ${secs(call.early)} early${callNote}</p>
<div class="ct-leader" style="left:${px(x((call.heard.start + call.heard.end) / 2))};top:${Y.notes + 34}px;height:${Y.dlg - Y.notes - 34}px"></div>
<p class="ct-note right" style="right:${px(W - x(hook.end))};top:${Y.notes}px">the seven seconds, less margins</p>
<div class="ct-leader" style="left:${px(x((hook.start + hook.end) / 2))};top:${Y.notes + 34}px;height:${Y.dlg - Y.notes - 34}px"></div>
<div class="lane" style="left:${X0}px;width:${px(X1 - X0)};top:${Y.dlg}px;height:${Y.dlgH}px">${gaps}${speech}</div>
<div class="lane" style="left:${X0}px;width:${px(X1 - X0)};top:${Y.lines}px;height:${Y.linesH}px">${lines}${removed}</div>
${inLane}
${gapLabels}
${typed.map((l) => `<p class="ct-typed" style="left:${px(x(l.start))};top:${Y.lineTags}px">editor</p>`).join("")}
${opening.removed.map((l) => `<p class="verdict ct-gone" style="left:${px(x(l.start))};top:${Y.lineTags}px">${REJECT_MARK}removed</p>`).join("")}
<div class="ct-axis" style="top:${Y.axis}px"></div>
<div style="position:absolute;left:0;width:${W}px;top:${Y.axis}px">${ticks}</div>
<p class="ct-result" style="left:${MARGIN}px;top:${Y.result}px">${opening.lines.length} lines fit; an editor typed ${typed.length} and removed ${opening.removed.length}. None overlaps speech either recognizer hears.${typedNote}</p>`,
  });
}

export const CONSTRAINT_CSS = `
.ct-quote { flex:0 1 740px; border-top:2px solid var(--rule); padding-top:14px; margin-bottom:6px; }
.ct-qgloss { font-family:var(--serif); font-style:italic; font-size:28px; line-height:1.3; color:var(--ink-100); }
.ct-cite { margin-top:8px; font-size:24px; line-height:1.35; color:var(--ink-400); }
.ct-head { position:absolute; left:${MARGIN}px; width:${X0 - MARGIN - 24}px; display:flex; flex-direction:column; justify-content:center; }
.ct-head .label { white-space:nowrap; }
.ct-sub { font-size:24px; line-height:1.3; color:var(--ink-400); }
.ct-gap { position:absolute; top:0; height:100%; background:rgba(236,233,227,.1); box-shadow:inset 0 0 0 2px rgba(236,233,227,.5); border-radius:3px; }
.ct-removed { position:absolute; top:0; height:100%; border:2px dashed var(--ink-300); border-radius:3px;
  background:linear-gradient(var(--ink-100), var(--ink-100)) center / 100% 3px no-repeat; }
.ct-gone { position:absolute; gap:6px; font-size:24px; font-weight:500; white-space:nowrap; }
.ct-gl { position:absolute; text-align:center; font-size:24px; color:var(--ink-300);
  font-variant-numeric:tabular-nums; white-space:nowrap; }
.ct-gl.short { color:var(--ink-100); }
.ct-gl span { display:block; font-size:24px; color:var(--ink-400); }
.ct-typed { position:absolute; font-size:24px; color:var(--amber); white-space:nowrap; }
.ct-note { position:absolute; font-size:24px; color:var(--ink-300); white-space:nowrap; }
.ct-note.right { text-align:right; }
.ct-leader { position:absolute; width:2px; background:var(--ink-300); }
.ct-axis { position:absolute; left:${X0}px; width:${X1 - X0}px; height:2px; background:var(--rule); }
.ct-tick { position:absolute; top:0; width:1px; height:12px; background:var(--tick); }
.ct-t { position:absolute; top:16px; font-size:24px; color:var(--ink-400); font-variant-numeric:tabular-nums; white-space:nowrap; }
.ct-in { position:absolute; font-size:22px; font-weight:500; color:var(--ink-100); white-space:nowrap; }
.ct-in.dark { color:#f4f4f5; }
.ct-result { position:absolute; font-size:32px; line-height:1.3; color:var(--ink-100); }
`;
