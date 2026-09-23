/**
 * 08. The product: one press of Generate makes the whole track.
 * Four crops of the workspace on the pinned sample run, each shown at 1:1 of the 2x capture so the
 * app's own text reads at slide size: the Generate button, the player's switches (Eyes closed), the
 * timeline around the chosen line, and the panel of the line the final check sent back and Scene
 * rewrote. Each crop has its caption above it, and a ring marks what the caption names. The prose
 * tells the optional edit once (its cost, measured on the live service, is in the notes), and the
 * sample's own figures with the reused hearing and watching said beside them.
 */
import { analysis } from "../data/analysis";
import { liveCheck } from "../data/live-check";
import { line, runId, summary } from "../data/sample";
import { dayMonthYear, esc, intro, px, slide, usd } from "../html";
import { notesFor } from "../notes";
import {
  DEVICE_SCALE,
  screenSize,
  screenUrl,
  WORKSPACE_VIEWPORT,
  workspaceCapture,
  type Box,
  type ScreenKey,
} from "../screens";
import { MARGIN, W } from "../theme";

/** The headline column: it ends before the Generate button, which spans the right column. */
const HEADLINE_W = 1000;
const INTRO_TOP = 76;
/** Where the two columns of crops start, under the headline. */
const ROW_TOP = 282;
/** A caption line above each crop, and the space under a crop before the next caption. */
const CAPTION_H = 40;
const STACK_GAP = 22;
/** How far a ring stands off the element it marks. */
const RING_PAD = 6;
const SECONDS_PER_MINUTE = 60;
/** How wide the fade is where the timeline crop cuts into the clip. */
const FADE_PX = 64;
/** The prose under the line panel: three lines of 30 px type at the theme's 1.5 line height. */
const BODY_LINES = 3;
const BODY_LINE_PX = 45;

const minutesSeconds = (s: number) =>
  `${Math.floor(s / SECONDS_PER_MINUTE)} min ${Math.round(s % SECONDS_PER_MINUTE)} s`;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

interface Placed {
  key: ScreenKey;
  left: number;
  top: number;
  width: number;
  height: number;
}
/** The timeline crop starts mid-clip, so its left edge fades out instead of ending hard. */
const CUT_LEFT: ScreenKey = "timeline";

/** A crop at 1:1 of its PNG. */
function crop(p: Placed): string {
  return `<div class="pd-shot${p.key === CUT_LEFT ? " cut-left" : ""}" style="left:${px(p.left)};top:${px(p.top)};width:${px(p.width)};height:${px(p.height)}"><img src="${screenUrl(p.key)}" alt="" style="width:${px(p.width)};height:${px(p.height)}"></div>`;
}

/** A ring around an element of a placed crop (box in CSS pixels of the capture). */
function ring(p: Placed, b: Box): string {
  const s = DEVICE_SCALE;
  return `<div class="pd-ring" style="left:${px(p.left + b.x * s - RING_PAD)};top:${px(p.top + b.y * s - RING_PAD)};width:${px(b.width * s + 2 * RING_PAD)};height:${px(b.height * s + 2 * RING_PAD)}"></div>`;
}

export function editorSlide(): string {
  const note = notesFor("Product");
  const capture = workspaceCapture();
  const size = (key: ScreenKey) => {
    const png = screenSize(key);
    const css = capture.crops[key];
    if (Math.abs(png.width - css.width * DEVICE_SCALE) > DEVICE_SCALE)
      throw new Error(`${key} is not a ${DEVICE_SCALE}x capture`);
    return png;
  };
  if (!capture.lineHeading.includes(String(line.start)))
    throw new Error(
      `the captured line is "${capture.lineHeading}", not the line at ${line.start} s`,
    );
  if (line.rejectedBy !== "final check")
    throw new Error("the caption says the final check sent the captured line back");

  // Right column: the line panel, then the prose. Left column: the switches, then the timeline.
  const lineSize = size("line");
  const rightX = W - MARGIN - lineSize.width;
  const lineShot: Placed = { key: "line", left: rightX, top: ROW_TOP + CAPTION_H, ...lineSize };
  const controlsSize = size("controls");
  const controls: Placed = {
    key: "controls",
    left: MARGIN,
    top: ROW_TOP + CAPTION_H,
    ...controlsSize,
  };
  const timelineTop = controls.top + controls.height + STACK_GAP + CAPTION_H;
  const timeline: Placed = { key: "timeline", left: MARGIN, top: timelineTop, ...size("timeline") };
  if (timeline.width !== controls.width)
    throw new Error("the switches and the timeline no longer line up");
  if (MARGIN + timeline.width > rightX) throw new Error("the timeline runs into the line panel");
  // Top right, beside the headline: the button the headline is about.
  const generateSize = size("generate");
  const generate: Placed = {
    key: "generate",
    left: W - MARGIN - generateSize.width,
    top: INTRO_TOP + CAPTION_H,
    ...generateSize,
  };
  if (MARGIN + HEADLINE_W > generate.left)
    throw new Error("the headline runs into the Generate button");

  const shots = note(
    `Captured ${dayMonthYear(capture.capturedAt)} from the app at ${DEVICE_SCALE}× in a ${WORKSPACE_VIEWPORT.width} × ${WORKSPACE_VIEWPORT.height} window, English interface, Korean narration, on the sample run (${esc(capture.runId)}) with “${esc(capture.lineHeading)}” chosen; the Generate button with Brief density chosen, which has no track of this clip. Each crop is shown pixel for pixel; the timeline starts at the player’s switches.`,
  );
  const edit = note(
    `Measured on the live Cloud Run service (revision ${esc(liveCheck.revision)}), ${dayMonthYear(isoDay(liveCheck.day))}, editing one line of an earlier track of this clip: ${usd(liveCheck.editCostUsd, 6)} of API calls and ${liveCheck.editSeconds} s until the new track was mixed; the other ${liveCheck.reusedAudioFiles} lines’ audio reused byte for byte.`,
  );
  const figures = note(
    `The sample run, ${dayMonthYear(isoDay(summary.day))} (${esc(runId)}): ${usd(summary.costUsd, 4)} and ${summary.seconds} s by its own summary and call ledger, for ${summary.lines} lines in ${summary.clipSeconds} s of film. It was started from the command line through the same path as the Generate button. It reused the hearing and watching of an earlier run of the clip (${esc(analysis.runId)}): ${usd(analysis.costUsd, 4)} and ${analysis.seconds} s.`,
  );

  // Under the line panel: the prose, then the sample's figures in small type.
  const bodyTop = lineShot.top + lineShot.height + STACK_GAP;
  const figuresTop = bodyTop + BODY_LINES * BODY_LINE_PX + STACK_GAP;

  const caption = (text: string, left: number, top: number, width: number, align = "left") =>
    `<p class="pd-cap" style="left:${px(left)};top:${px(top)};width:${px(width)};text-align:${align}">${text}</p>`;
  const { callouts } = capture;

  return slide({
    id: "s-editor",
    name: "product",
    kind: "exhibit",
    filmCredit: true,
    body: `
${intro("One press of Generate makes the whole track.", undefined, HEADLINE_W)}
${caption("One press runs every step", generate.left - MARGIN, INTRO_TOP, generate.width + MARGIN, "right")}
${crop(generate)}
${caption("Eyes closed: listen as its audience will", controls.left, ROW_TOP, controls.width, "right")}
${crop(controls)}${ring(controls, callouts.eyesClosed.box)}
${caption(`Each line in the silence it fits${shots}`, timeline.left, timelineTop - CAPTION_H, timeline.width)}
${crop(timeline)}
${caption("Scene rewrote the line the final check sent back", lineShot.left, ROW_TOP, lineShot.width)}
${crop(lineShot)}${ring(lineShot, callouts.fixed.box)}
<p class="body pd-body" style="left:${px(rightX)};top:${px(bodyTop)};width:${px(lineShot.width)}">Want different words? You can still edit any line; Scene re-voices just that one and checks the track again.${edit}</p>
<p class="tag pd-figures" style="left:${px(rightX)};top:${px(figuresTop)};width:${px(lineShot.width)}">Sample: ${summary.lines} lines in ${minutesSeconds(summary.seconds)} for ${usd(summary.costUsd)} in API calls; the clip’s hearing and watching came from an earlier run.${figures}</p>`,
  });
}

export const EDITOR_CSS = `
.pd-shot { position:absolute; overflow:hidden; border-radius:10px; outline:1px solid var(--rule); background:var(--lane); }
.pd-shot.cut-left img { -webkit-mask-image:linear-gradient(to right, transparent 0, #000 ${FADE_PX}px);
  mask-image:linear-gradient(to right, transparent 0, #000 ${FADE_PX}px); }
.pd-shot img { display:block; }
.pd-ring { position:absolute; border:2px solid var(--ink-100); border-radius:12px; }
.pd-cap { position:absolute; font-size:var(--fs-label); line-height:1.3; font-weight:600; color:var(--ink-100); }
.pd-body { position:absolute; }
.pd-figures { position:absolute; color:var(--ink-300); }
`;
