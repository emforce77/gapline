import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { cardHtml, CHROME_PATH } from "./cards";
import { DEMO_DIR, loadDemoData } from "./demo-data";
async function main() {
  const data = await loadDemoData("en");
  const records = (await readFile("runtime/evaluation/runs.jsonl", "utf8"))
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  const report = JSON.parse(await readFile("runtime/evaluation/summary.json", "utf8"));
  const base = cardHtml("problem", "en", data);
  const styles = base.match(/<style>([\s\S]*?)<\/style>/)![1];
  const body = (id: Parameters<typeof cardHtml>[0]) =>
    cardHtml(id, "en", data).match(/<body>([\s\S]*)<\/body>/)![1];
  const custom = (title: string, content: string) =>
    `<div class="card"><header>SCENE · IMPLEMENTED UPGRADE · SEPTEMBER 2026</header><h1>${title}</h1>${content}</div>`;
  const pages = [
    body("problem"),
    body("pipeline"),
    custom(
      "Scene evidence → rejection → a real edit",
      `<img style="width:1350px;max-height:640px;object-fit:contain;align-self:center" src="${pathToFileURL(join(DEMO_DIR, "en/rec/editor.png")).href}"><div class="note">Actual Cloud Run editor. Parent: ${data.editBase.runId}<br>Child: ${data.edited.runId}. Unchanged WAVs are reused; the original remains available.</div>`,
    ),
    custom(
      "What changed in the working product",
      `<div class="flow">Exact-gap placement · consistent verdicts · unchanged rewrites rejected<br>Final surviving-output audit with a visible review-needed state<br>One provider retry · immediately persisted validated analysis<br>Sentence/start editing · new child run · unchanged WAV reuse<br>Anonymous upload ownership · conditional cloud budget reservations</div><div class="note">Verification: deterministic regressions plus a mocked-provider FFmpeg workflow, production build, and live browser checks. These are implementation checks, not user-impact measurements.</div>`,
    ),
    custom(
      "Screening selected the stronger reviewer",
      `<p>${records.length} run records over six clip cases: ${records.filter((r) => r.status === "done").length} completed, ${records.filter((r) => r.status !== "done").length} failed.<br>Candidate: medium reasoning. Default retained: high reasoning.</p><table><tr><th>Case</th><th>Decision-changing evidence</th></tr><tr><td>Opening / Korean AD</td><td>Medium lost the essential “40 years later” transition.</td></tr><tr><td>Korean interview</td><td>Both missed introductory visual context. Medium marked the result model-checked.</td></tr><tr><td>Synthetic + Korean holdout</td><td>Invalid zero-duration recognition intervals were rejected; failures are retained.</td></tr></table><div class="note">Known-omission review uses fixed references and sampled frames. Independent ASR disagreements are not certified speech intrusions. Cost/latency with cold versus reused analysis are not compared.</div>`,
    ),
    custom(
      "Measured API spending",
      `<div class="grid"><div class="item"><div class="value">$${report.cost.openRouterUsd.toFixed(3)}</div><div class="label">screening OpenRouter</div></div><div class="item"><div class="value">$${report.cost.googleSpeechUsd.toFixed(3)}</div><div class="label">screening Google speech estimates</div></div><div class="item"><div class="value">$${data.edited.summary.costUsd.toFixed(3)}</div><div class="label">recorded sentence edit</div></div></div><p>Pinned 65-second cold generation: $${data.standard.summary.costUsd.toFixed(3)} API cost; ${Math.round(data.standard.summary.wallSeconds)} seconds.<br>Limits: $20 experiment total; $10/day; public demo $5/day.<br>Key limit unchanged; no automatic recharge.</p><div class="note">Failures and retries remain in ledgers. Unknown costs retain reservations. Cloud infrastructure and narrator-production costs are outside screening totals.</div>`,
    ),
    custom(
      "Limits remain visible",
      `<div class="flow">No blind/low-vision participant study was performed.<br>Model-checked is not independently certified.<br>STT timing disagreements and unverified important sounds remain open.<br>Full-length human listening acceptance is still required.<br>Uploads use anonymous cookies, with no identity recovery.<br>Short-clip request processing, not a durable long-film queue.</div><div class="note">Sources: Tears of Steel / Blender Foundation / CC BY 3.0. Wikitongues, Hanbid / Teddy Nee / CC BY-SA 4.0. Synthetic signal fixture labeled separately. GitHub publication and contest submission remain owner actions.</div>`,
    ),
    body("close"),
  ];
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Scene — editor workflow</title><style>${styles}@page{size:1920px 1080px;margin:0}section{height:1080px;padding-top:60px;break-after:page}section:last-child{break-after:auto}.card{height:960px}table{width:100%;font-size:28px;border-collapse:collapse;margin-top:30px}th,td{text-align:left;padding:22px 15px;border-bottom:1px solid #3a3f46;vertical-align:top}th{color:#f1b54b}td:first-child{width:31%}</style></head><body>${pages.map((p) => `<section>${p}</section>`).join("")}</body></html>`;
  const file = join(DEMO_DIR, "scene-presentation-en.html");
  await mkdir(DEMO_DIR, { recursive: true });
  await writeFile(file, html);
  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => document.fonts.ready);
    await page.pdf({
      path: join(DEMO_DIR, "scene-presentation-en.pdf"),
      printBackground: true,
      preferCSSPageSize: true,
    });
    console.log(
      JSON.stringify({ pages: pages.length, pdf: join(DEMO_DIR, "scene-presentation-en.pdf") }),
    );
  } finally {
    await browser.close();
  }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
