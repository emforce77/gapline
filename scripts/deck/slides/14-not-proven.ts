/**
 * 14. What we will test next: each claim not proven yet beside the test that would prove it, then
 * today's limits stated plainly (from the app's own contract and the deploy script) and the path for
 * long films, framed as a plan.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MAX_UPLOAD_SECONDS } from "../../../src/lib/api-contract";
import { esc, NBSP, slide } from "../html";
import { REPO } from "../paths";
import { MARGIN, W } from "../theme";

const MAX_INSTANCES = readFileSync(join(REPO, "deploy/cloud-run.sh"), "utf8").match(
  /--max-instances (\d+)/,
)?.[1];
if (!MAX_INSTANCES) throw new Error("deploy/cloud-run.sh has no --max-instances");

/** The table starts under the two-line headline; the band of today's limits under the table. */
const TABLE_TOP = 282;
const BAND_TOP = 710;

const ROWS: { open: string; test: string }[] = [
  {
    open: "Blind and low-vision viewers find the lines useful",
    test: "Listening sessions with them",
  },
  {
    open: "Describers would ship the automatic track",
    test: "Describers review three automatic tracks and count the lines they would change",
  },
  {
    open: "It carries to other Asia-Pacific languages",
    test: "One guideline and voice per language, reviewed by native describers",
  },
];

export function notProvenSlide(): string {
  const rows = ROWS.map((r) => `<tr><td>${esc(r.open)}</td><td>${esc(r.test)}</td></tr>`).join("");

  return slide({
    id: "s-open",
    name: "not-proven",
    kind: "exhibit",
    body: `
<div class="intro"><h1 class="headline" style="max-width:1728px">Next we test it with blind viewers and professional describers.</h1></div>
<table class="np-table" style="left:${MARGIN}px;top:${TABLE_TOP}px;width:${W - 2 * MARGIN}px">
  <tbody>${rows}</tbody>
</table>
<div class="np-band" style="left:${MARGIN}px;top:${BAND_TOP}px;width:${W - 2 * MARGIN}px">
  <div><p class="label">Prototype limits</p><p>One Cloud Run service, up to ${MAX_INSTANCES} instances; clips up to ${MAX_UPLOAD_SECONDS}${NBSP}s, one request each.</p></div>
  <div><p class="label">Next, for whole films</p><p>Split at shot boundaries; one Cloud Run job per scene, same checks.</p></div>
</div>`,
  });
}

export const NOT_PROVEN_CSS = `
.np-table { position:absolute; border-collapse:collapse; table-layout:fixed; }
.np-table td:first-child { width:760px; }
.np-table td { vertical-align:top; padding:22px 48px 22px 0; border-top:1px solid var(--rule); font-size:var(--fs-body); line-height:1.35; text-wrap:balance; }
.np-table td:first-child { font-family:var(--serif); font-size:38px; line-height:1.2; color:var(--ink-100); }
.np-table td:last-child { color:var(--ink-300); }
.np-band { position:absolute; display:grid; grid-template-columns:760px 1fr; border-top:2px solid var(--ink-300); padding-top:18px; }
.np-band > div { padding-right:48px; }
.np-band p:not(.label) { margin-top:8px; font-size:var(--fs-body); line-height:1.4; color:var(--ink-100); text-wrap:balance; }
`;
