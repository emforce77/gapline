/**
 * 08. The product: the whole English workspace, captured fresh at device scale 2 with the line the
 * editor restored (54.2 s) selected, and three numbered callouts placed from the element boxes the
 * capture recorded. Beside it, the editor's fix in two sentences and a plain count of the lines an
 * editor typed in this track and the one an editor removed.
 */
import { editSession, lineHistory, opening } from "../data/demo";
import { dayMonthYear, esc, px, secs, slide, usd } from "../html";
import { notesFor } from "../notes";
import {
  DEVICE_SCALE,
  screenSize,
  screenUrl,
  WORKSPACE_VIEWPORT,
  workspaceCapture,
  type Box,
  type WorkspaceBoxes,
} from "../screens";
import { MARGIN, W } from "../theme";

/** The workspace capture, scaled to this width; its height follows the crop under the timeline. */
const SHOT = { left: MARGIN, top: 196, width: 1310 };
const COL_GAP = 40;
const MARKER = 44;
/** The eyes-closed inset: a window on the centre of the blacked-out player, enlarged. */
const EYES = { width: 1600 };
const EYES_BOX = { w: 348, h: 124 };
/** Where each marker sits on its box, as fractions of the box (chosen to avoid covering text). */
const CALLOUTS: {
  key: keyof WorkspaceBoxes;
  at: [number, number];
  text: string;
}[] = [
  {
    key: "timeline",
    at: [0.06, 0.12],
    text: "Timeline: each line’s room, its measured voice inside",
  },
  {
    key: "rejection",
    at: [0.93, 0.08],
    text: "Rejections with rule, page and every version",
  },
  {
    key: "eyesClosed",
    at: [0.5, -0.9],
    text: "Eyes closed: hear it as its audience will",
  },
];

export function editorSlide(): string {
  const note = notesFor(8, "Every line shows its room…");
  const size = screenSize("workspace");
  if (size.width !== WORKSPACE_VIEWPORT.width * DEVICE_SCALE)
    throw new Error("workspace capture is not at 2x");
  const scale = SHOT.width / WORKSPACE_VIEWPORT.width;
  const shotW = SHOT.width;
  const shotH = (size.height / DEVICE_SCALE) * scale;
  const { capturedAt, boxes, lineHeading } = workspaceCapture();
  const lineName = lineHeading.match(/^Line \d+/)?.[0];
  if (!lineName || !lineHeading.includes(String(lineHistory.start)))
    throw new Error(
      `the captured line is "${lineHeading}", not the line at ${lineHistory.start} s`,
    );
  const place = (b: Box, [fx, fy]: [number, number]) => ({
    x: SHOT.left + (b.x + b.width * fx) * scale,
    y: SHOT.top + (b.y + b.height * fy) * scale,
  });
  const markers = CALLOUTS.map((c, i) => {
    const p = place(boxes[c.key], c.at);
    return `<span class="ed-mark" style="left:${px(p.x - MARKER / 2)};top:${px(p.y - MARKER / 2)}">${i + 1}</span>`;
  }).join("");
  const colLeft = SHOT.left + shotW + COL_GAP;
  // The eyes-closed frame, enlarged around its centre so the spoken line reads at slide size.
  const eyesSize = screenSize("eyesClosed");
  const eyesScale = EYES.width / eyesSize.width;
  const eyes = {
    width: EYES.width,
    left: (eyesSize.width / 2) * eyesScale - EYES_BOX.w / 2,
    top: (eyesSize.height / 2) * eyesScale - EYES_BOX.h / 2,
  };
  const shotNote = note(
    `Captured ${dayMonthYear(capturedAt)} from the app at 2× (${WORKSPACE_VIEWPORT.width} × ${WORKSPACE_VIEWPORT.height} window, cropped under the timeline): English interface, Korean narration, the finished sample track. ${lineName}, at ${lineHistory.start} s, is scrolled to its second rejection and the editor’s version.`,
  );
  const typed = opening.lines.filter((l) => l.byEditor);
  const fixNote = note(
    `That session, on the live service, 22 Sep 2026: ${usd(editSession.costUsd, 3)} of API calls and ${Math.round(editSession.seconds)} s; the other ${editSession.reusedAudioFiles} audio files byte-identical; the previous version kept. An editor’s sentence that is too long or breaks a rule comes back with the reason; Scene does not rewrite it.`,
  );
  const gone = opening.removed.map((l) => `“${esc(l.gloss)}” at ${secs(l.start, 1)}`).join(", ");
  const typedNote = note(
    `Typed: the lines at ${typed.map((l) => secs(l.start, 1)).join(" and ")}. Removed: ${gone}, which played over dialogue. ${opening.sessions} editor sessions in all.`,
  );
  if (typed.length !== 2 || opening.removed.length !== 1)
    throw new Error("the slide says two lines were typed and one removed by an editor");

  return slide({
    id: "s-editor",
    name: "product",
    folio: 8,
    kind: "prose",
    filmCredit: true,
    body: `
<div class="intro"><h1 class="headline" style="max-width:1728px">Every line shows its room, its rule and its history.</h1></div>
<div class="ed-shot" style="left:${SHOT.left}px;top:${SHOT.top}px;width:${px(shotW)};height:${px(shotH)}">
  <img src="${screenUrl("workspace")}" alt="" style="width:${px(shotW)};height:${px(shotH)}">
</div>
${markers}
<div class="ed-col" style="left:${px(colLeft)};top:${SHOT.top}px;width:${px(W - MARGIN - colLeft)}">
  <ol class="ed-callouts">${CALLOUTS.map((c, i) => `<li><span class="ed-num">${i + 1}</span><p>${esc(c.text)}${i === 0 ? shotNote : ""}</p></li>`).join("")}</ol>
  <div class="ed-eyes"><img src="${screenUrl("eyesClosed")}" alt="" style="width:${px(eyes.width)};margin:${px(-eyes.top)} 0 0 ${px(-eyes.left)}"></div>
  <p class="body ed-story">An editor typed the reviewer’s second fix. Scene re-voiced only that line and kept the original: ${usd(editSession.costUsd, 3)} of API calls, ${secs(editSession.seconds, 0)}${fixNote}</p>
  <p class="ed-typed">${typed.length} of the ${opening.lines.length} lines in this track were typed by an editor; an editor removed ${opening.removed.length} more.${typedNote}</p>
</div>`,
  });
}

export const EDITOR_CSS = `
.ed-shot { position:absolute; overflow:hidden; border-radius:10px; border:1px solid var(--rule); background:var(--lane); }
.ed-shot img { display:block; }
.ed-mark { position:absolute; width:${MARKER}px; height:${MARKER}px; border-radius:50%; background:var(--ink-100);
  color:var(--screen); font-size:26px; font-weight:600; line-height:${MARKER}px; text-align:center;
  box-shadow:0 0 0 4px rgba(9,9,10,.85); }
.ed-col { position:absolute; }
.ed-callouts { list-style:none; display:grid; row-gap:20px; }
.ed-callouts li { display:grid; grid-template-columns:${MARKER}px 1fr; column-gap:16px; align-items:start; }
.ed-num { width:${MARKER}px; height:${MARKER}px; border-radius:50%; border:2px solid var(--ink-100); font-size:24px;
  font-weight:600; line-height:${MARKER - 4}px; text-align:center; color:var(--ink-100); }
.ed-callouts p { font-size:26px; line-height:1.3; color:var(--ink-100); }
.ed-eyes { width:${EYES_BOX.w}px; height:${EYES_BOX.h}px; overflow:hidden; margin:18px 0 0 ${MARKER + 16}px;
  border:1px solid var(--rule); border-radius:8px; background:#000; }
.ed-eyes img { display:block; }
.ed-story { margin-top:28px; padding-top:18px; border-top:1px solid var(--rule); font-size:26px; line-height:1.4; }
.ed-typed { margin-top:18px; font-size:26px; line-height:1.4; color:var(--ink-100); }
`;
