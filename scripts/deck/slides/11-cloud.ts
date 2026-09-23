/**
 * 11. Built on Google Cloud, drawn as an architecture diagram: the project's region with the deploy
 * path (Cloud Build into Artifact Registry), the Cloud Run service and its container with the stages
 * that call each Google AI API, Cloud Storage with the two mechanisms that make it safe to share
 * (a mounted volume, conditional writes) and Secret Manager; the browser outside, fed by server-sent
 * events; two checks made on the live service. Service settings are read from deploy/cloud-run.sh and
 * the Gemini access wording from GEMINI_ACCESS_LABEL (src/lib/models.ts), the one place it may change.
 */
import { GEMINI_ACCESS_LABEL, MODELS } from "../../../src/lib/models";
import { editSession } from "../data/demo";
import { SPEC } from "../data/deploy";
import { esc, PASS_MARK, slide } from "../html";
import { notesFor } from "../notes";
import { MARGIN, W } from "../theme";

const GEMINI_NAME = "Gemini 3.8 Flash";
if (!MODELS.flash.endsWith("gemini-3.8-flash"))
  throw new Error(`the slide names ${GEMINI_NAME} but the app uses ${MODELS.flash}`);

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const REGION: Rect = { x: 440, y: 196, w: 910, h: 754 };
const BUILD: Rect = { x: 462, y: 248, w: 220, h: 60 };
const REGISTRY: Rect = { x: 726, y: 248, w: 262, h: 60 };
const RUN: Rect = { x: 462, y: 352, w: 866, h: 388 };
const BOX: Rect = { x: 486, y: 446, w: 818, h: 272 };
const API_X = 1400;
const API_W = W - MARGIN - API_X;
const STT: Rect = { x: API_X, y: 452, w: API_W, h: 84 };
const GEMINI: Rect = { x: API_X, y: 548, w: API_W, h: 112 };
const TTS: Rect = { x: API_X, y: 672, w: API_W, h: 84 };
const STORAGE: Rect = { x: 462, y: 780, w: 560, h: 150 };
const SECRET: Rect = { x: 1042, y: 780, w: 286, h: 150 };
const BROWSER: Rect = { x: MARGIN, y: 480, w: 150, h: 110 };
const LIVE_TOP = 800;
/**
 * The stages inside the container, named as the how-it-works slide names them. Hear and Watch run
 * side by side (the pipeline starts both at once), then Write, Review and Voice run right, and
 * Measure, Mix and Final check run back left under them.
 */
const PARALLEL = ["Hear", "Watch"];
const TOP_ROW = ["Write", "Review", "Voice"];
const BACK_ROW = ["Measure", "Mix", "Final check"];
const CHIP = { w: 150, h: 44, gap: 36, left: 510, parallel: [520, 580], row: 550, back: 668 };

const midY = (r: Rect) => r.y + r.h / 2;
const at = (r: Rect) => `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;

function box(r: Rect, title: string, lines: string[], cls = ""): string {
  const body = lines.map((l) => `<p class="cl-x">${l}</p>`).join("");
  return `<div class="cl-box ${cls}" style="${at(r)}"><p class="cl-t">${title}</p>${body}</div>`;
}

export function cloudSlide(): string {
  const note = notesFor(11, "One Cloud Run service…");
  if (!editSession.idempotentRepeat)
    throw new Error("the live check no longer shows an idempotent edit");
  const settings = note(
    `From the deploy script: ${SPEC.env}, ${SPEC.cpu} vCPU, ${SPEC.memory}, concurrency ${SPEC.concurrency}, ${SPEC.min}–${SPEC.max} instances, the bucket mounted as a volume, the model key from Secret Manager; built from source by Cloud Build into Artifact Registry. A run is one request; progress streams back as server-sent events.`,
  );
  const storage = note(
    "A budget reservation or an edit request is claimed by writing an object only if its generation still matches (ifGenerationMatch). Two tabs cannot spend the same dollar or make the same edit twice. Each paid call is logged with its cost.",
  );
  const apis = note(
    `Speech-to-Text v2, Chirp 3, called in the “us” multi-region: Google lists Chirp 3 only in the us and eu multi-regions (Chirp 3 model page, read 23 Sep 2026). 55 s chunks; since 23 Sep 2026 each silence is also recognized again on its own, a change not deployed yet. Text-to-Speech, Chirp 3 HD voice Charon. Gemini access: ${esc(GEMINI_ACCESS_LABEL)}.`,
  );
  const live = note(
    `22 Sep 2026, on the revision then deployed: an edit request sent twice made one version; ${editSession.privateRoutesDenied} of ${editSession.privateRoutesChecked} private routes answered 404 to a visitor who does not own them.`,
  );
  const arrowPath = (x1: number, y1: number, x2: number, y2: number) =>
    `<path d="M${x1} ${y1} L${x2} ${y2}" class="cl-c thin" marker-end="url(#cl-s)"/>`;
  const arrow = (x1: number, y1: number, x2: number, y2: number, cls = "cl-c", both = false) =>
    `<path d="M${x1} ${y1} L${x2} ${y2}" class="${cls}" marker-end="url(#cl-h)"${both ? ' marker-start="url(#cl-h)"' : ""}/>`;
  const colX = (i: number) => CHIP.left + i * (CHIP.w + CHIP.gap);
  const chip = (name: string, left: number, cy: number) =>
    `<p class="cl-stage" style="left:${left}px;top:${cy - CHIP.h / 2}px;width:${CHIP.w}px;height:${CHIP.h}px">${name}</p>`;
  const chips = [
    ...PARALLEL.map((n, i) => chip(n, colX(0), CHIP.parallel[i])),
    ...TOP_ROW.map((n, i) => chip(n, colX(i + 1), CHIP.row)),
    // The back row runs right to left, starting under the last stage of the top row.
    ...BACK_ROW.map((n, i) => chip(n, colX(TOP_ROW.length - i), CHIP.back)),
  ].join("");
  const chipArrows = [
    ...CHIP.parallel.map((y) =>
      arrowPath(colX(0) + CHIP.w + 4, y, colX(1) - 4, CHIP.row + (y < CHIP.row ? -8 : 8)),
    ),
    ...TOP_ROW.slice(1).map((_, i) =>
      arrowPath(colX(i + 1) + CHIP.w + 4, CHIP.row, colX(i + 2) - 4, CHIP.row),
    ),
    arrowPath(
      colX(TOP_ROW.length) + CHIP.w / 2,
      CHIP.row + CHIP.h / 2 + 4,
      colX(TOP_ROW.length) + CHIP.w / 2,
      CHIP.back - CHIP.h / 2 - 4,
    ),
    ...BACK_ROW.slice(1).map((_, i) =>
      arrowPath(
        colX(TOP_ROW.length - i) - 4,
        CHIP.back,
        colX(TOP_ROW.length - i - 1) + CHIP.w + 4,
        CHIP.back,
      ),
    ),
  ];
  const svg = [
    arrow(BROWSER.x + BROWSER.w + 6, midY(BROWSER) - 26, RUN.x - 6, midY(BROWSER) - 26),
    arrow(RUN.x - 6, midY(BROWSER) + 26, BROWSER.x + BROWSER.w + 6, midY(BROWSER) + 26),
    arrow(BUILD.x + BUILD.w + 6, midY(BUILD), REGISTRY.x - 6, midY(BUILD)),
    arrow(
      REGISTRY.x + REGISTRY.w / 2,
      REGISTRY.y + REGISTRY.h + 4,
      REGISTRY.x + REGISTRY.w / 2,
      RUN.y - 6,
      "cl-c dash",
    ),
    arrow(BOX.x + BOX.w + 6, midY(STT), STT.x - 6, midY(STT)),
    arrow(BOX.x + BOX.w + 6, midY(GEMINI), GEMINI.x - 6, midY(GEMINI)),
    arrow(BOX.x + BOX.w + 6, midY(TTS), TTS.x - 6, midY(TTS)),
    arrow(
      STORAGE.x + STORAGE.w / 2,
      STORAGE.y - 6,
      STORAGE.x + STORAGE.w / 2,
      RUN.y + RUN.h + 6,
      "cl-c",
      true,
    ),
    arrow(SECRET.x + SECRET.w / 2, SECRET.y - 6, SECRET.x + SECRET.w / 2, RUN.y + RUN.h + 6),
  ].join("");

  return slide({
    id: "s-cloud",
    name: "google-cloud",
    folio: 11,
    kind: "exhibit",
    body: `
<div class="intro"><h1 class="headline" style="max-width:1728px">One Cloud Run service, three Google models.</h1></div>
<div class="cl-region" style="${at(REGION)}"></div>
<p class="cl-region-l" style="left:${REGION.x + 22}px;top:${REGION.y + 12}px">Google Cloud · ${SPEC.region}</p>
<svg class="cl-svg" width="${W}" height="1080" viewBox="0 0 ${W} 1080" aria-hidden="true">
  <defs><marker id="cl-h" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#a9acb2"/></marker>
  <marker id="cl-s" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="#80848b"/></marker></defs>
  ${svg}
</svg>
${box(BUILD, "Cloud Build", [], "slim")}
${box(REGISTRY, "Artifact Registry", [], "slim")}
<p class="cl-edge" style="left:${REGISTRY.x + REGISTRY.w / 2 + 14}px;top:${REGISTRY.y + REGISTRY.h + 2}px">deploy</p>
<div class="cl-box run" style="${at(RUN)}"><p class="cl-t big">Cloud Run service${settings}</p><p class="cl-x">${SPEC.env} · ${SPEC.cpu} vCPU · ${SPEC.memory} · ${SPEC.min}–${SPEC.max} instances</p></div>
<div class="cl-box inner" style="${at(BOX)}"><p class="cl-t">Container: Next.js + FFmpeg</p></div>
<svg class="cl-svg" width="${W}" height="1080" viewBox="0 0 ${W} 1080" aria-hidden="true">${chipArrows.join("")}</svg>
${chips}
<p class="cl-col-l" style="left:${API_X}px;top:${STT.y - 44}px">Google models${apis}</p>
${box(STT, "Speech-to-Text v2, Chirp 3", ["word timings"])}
${box(GEMINI, GEMINI_NAME, [`<span class="cl-aside">${esc(GEMINI_ACCESS_LABEL)}</span>`, "watches, writes, reviews"])}
${box(TTS, "Text-to-Speech, Chirp 3 HD", ["one voice per line"])}
${box(STORAGE, `Cloud Storage${storage}`, ["mounted as a volume: clips, runs, audio", "conditional writes: no double spend"])}
${box(SECRET, "Secret Manager", ["model API key"])}
${box(BROWSER, "Browser", ["the editor"])}
<p class="cl-edge" style="left:${BROWSER.x + BROWSER.w + 12}px;top:${midY(BROWSER) - 62}px">clip, edits</p>
<p class="cl-edge" style="left:${BROWSER.x + BROWSER.w + 12}px;top:${midY(BROWSER) + 34}px">progress (SSE)</p>
<div class="cl-live" style="left:${API_X}px;top:${LIVE_TOP}px;width:${API_W}px">
  <p class="label">Checked on the live service${live}</p>
  <p class="cl-check">${PASS_MARK}An edit sent twice made one version</p>
  <p class="cl-check">${PASS_MARK}Other visitors get 404 on private files</p>
</div>`,
  });
}

export const CLOUD_CSS = `
.cl-svg { position:absolute; left:0; top:0; }
.cl-c { fill:none; stroke:var(--ink-300); stroke-width:2; }
.cl-c.dash { stroke-dasharray:7 6; }
.cl-region { position:absolute; border:2px dashed #4a4d53; border-radius:14px; }
.cl-region-l { position:absolute; font-size:24px; font-weight:600; color:var(--ink-300); }
.cl-box { position:absolute; border:2px solid #3a3c41; border-radius:8px; background:var(--lane); padding:10px 16px; }
.cl-box.slim { display:flex; align-items:center; padding:0 16px; }
.cl-box.run { border-color:var(--ink-300); background:#101012; padding:14px 22px; }
.cl-box.inner { border-color:#4a4d53; background:var(--lane); padding:12px 20px; }
.cl-t { font-size:26px; line-height:1.2; font-weight:600; color:var(--ink-100); }
.cl-t.big { font-size:30px; }
.cl-x { margin-top:4px; font-size:24px; line-height:1.25; color:var(--ink-300); }
.cl-aside { color:var(--ink-100); font-weight:500; }
.cl-stage { position:absolute; display:flex; align-items:center; justify-content:center; border:1px solid #4a4d53;
  border-radius:22px; background:var(--screen); font-size:24px; font-weight:500; color:var(--ink-100); white-space:nowrap; }
.cl-c.thin { stroke:var(--ink-400); stroke-width:2; }
.cl-col-l { position:absolute; font-size:24px; font-weight:600; color:var(--ink-300); }
.cl-edge { position:absolute; font-size:24px; color:var(--ink-300); white-space:nowrap; }
.cl-live { position:absolute; }
.cl-check { display:flex; align-items:center; gap:12px; margin-top:12px; font-size:26px; line-height:1.3; color:var(--ink-100); }
.cl-check svg { flex:none; }
`;
