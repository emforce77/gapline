import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import type { Language } from "../../src/lib/pipeline/schemas";
import type { DemoData } from "./demo-data";
import { SERVICE_HOST, type CardId } from "./storyboard";
export const CONTENT_WIDTH = 1920;
export const CONTENT_HEIGHT = 960;
export const CHROME_PATH = "/usr/bin/google-chrome";
const font = pathToFileURL(
  join(process.cwd(), "node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2"),
).href;
const icon = pathToFileURL(join(process.cwd(), "src/app/icon.svg")).href;
const style = `@font-face{font-family:Pretendard;src:url('${font}')}*{box-sizing:border-box}body{margin:0;background:#0c0d0f;color:#e7e9ec;font-family:Pretendard,sans-serif}.card{width:1920px;height:960px;padding:80px 110px;display:flex;flex-direction:column}header{display:flex;gap:18px;align-items:center;color:#8a9098;font-size:25px}header img{width:40px;height:40px}h1{font-size:68px;line-height:1.18;margin:38px 0;color:#fff;max-width:1550px}h2{font-size:34px;margin:0 0 15px}p{font-size:30px;line-height:1.5;margin:0}em{font-style:normal;color:#f1b54b}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:28px;margin:24px 0}.item{padding:28px 0;border-top:1px solid #3a3f46}.value{font-size:65px;color:#f1b54b;font-weight:700}.label{font-size:26px;color:#8a9098;margin-top:12px}.note{font-size:23px;line-height:1.6;color:#8a9098;margin-top:auto}.flow{font-size:34px;line-height:1.8;padding:28px;background:#141518;border:1px solid #2c3036;border-radius:10px}.black{background:#000}.black .note{align-self:flex-end;font-size:18px}.url{font-size:39px;color:#f1b54b;overflow-wrap:anywhere}.warning{border-left:3px solid #f1b54b;padding-left:24px;margin-top:25px}`;
const credit = "Tears of Steel · Blender Foundation · CC BY 3.0 · mango.blender.org";
export function cardHtml(card: CardId | "black", lang: Language, data: DemoData): string {
  const ko = lang === "ko";
  const sum = data.standard.summary;
  let body = "";
  if (card === "black") body = `<div class="note">${credit}</div>`;
  if (card === "problem")
    body = `<h1>${ko ? "장면을 근거로 쓰고,<br><em>사람이 고쳐 완성합니다.</em>" : "Grounded in the scene.<br><em>Finished by an editor.</em>"}</h1><div class="grid"><div class="item"><h2>${ko ? "누구를 위해" : "Who it serves"}</h2><p>${ko ? "시각장애인과 저시력 시청자를 위한 해설을 만드는 편집자" : "Editors creating description for blind and low-vision viewers"}</p></div><div class="item"><h2>${ko ? "어떤 문제" : "What is missing"}</h2><p>${ko ? "대사로 전달되지 않는 행동, 장소 변화, 화면 속 글자" : "Actions, setting changes and text that dialogue cannot convey"}</p></div><div class="item"><h2>${ko ? "씬의 작업 방식" : "The Scene workflow"}</h2><p>${ko ? "장면 근거 → 반려 이유 → 한 문장 수정 → 다시 듣기" : "Scene evidence → review reason → sentence edit → listen again"}</p></div></div><div class="note">${ko ? "한국어·영어 · 90초 이하 영상 · 편집자의 확인을 포함하는 제작 도구" : "Korean and English · clips up to 90 seconds · editor review remains part of production"}</div>`;
  if (card === "pipeline")
    body = `<h1>${ko ? "실제로 배포된 구성" : "What actually runs"}</h1><div class="flow">Browser → <em>Cloud Run · Next.js + FFmpeg</em><br>Chirp 3 STT → Gemini watch / write / review → Chirp 3 HD TTS<br>Gemini inference: <em>OpenRouter</em><br>Cloud Storage: clips, analysis, immutable runs, WAVs<br>Secret Manager: API key · Storage generation preconditions: budgets</div><div class="note">${ko ? "ADK·Agent Engine·협업 편집·장편 작업은 이번 범위 밖입니다." : "No ADK, Agent Engine, collaboration system or long-film worker is claimed."}</div>`;
  if (card === "numbers")
    body = `<h1>${ko ? "측정한 것과, 아직 확인할 것" : "Measured results. Visible limits."}</h1><div class="grid"><div class="item"><div class="value">${data.evaluationRuns}</div><div class="label">${ko ? "평가 실행 기록" : "screening run records"}</div></div><div class="item"><div class="value">$${sum.costUsd.toFixed(3)}</div><div class="label">${ko ? "선정 원본의 API 비용" : "pinned generation API cost"}</div></div><div class="item"><div class="value">${Math.round(sum.wallSeconds)} s</div><div class="label">${ko ? "선정 원본의 처리시간" : "pinned generation wall time"}</div></div></div><p>${ko ? "Cloud Run + Cloud Storage + Secret Manager<br>Gemini via OpenRouter · Google Cloud STT / TTS" : "Cloud Run + Cloud Storage + Secret Manager<br>Gemini via OpenRouter · Google Cloud STT / TTS"}</p><p class="warning">${ko ? `${data.evaluationDone}회 완료 · ${data.evaluationFailed}회 음성 시각 오류로 중단.<br>핵심 시간 전환을 놓친 후보는 탈락. 기존 검수 강도 유지.` : `${data.evaluationDone} completed · ${data.evaluationFailed} stopped for invalid speech timing.<br>Medium review lost an essential time jump. High review retained.`}</p><div class="note">${ko ? "독립 ASR은 실제 청취 확인을 대신하지 않습니다. API 비용은 인프라 비용을 제외합니다." : "Independent ASR does not replace listening acceptance. API cost excludes cloud infrastructure."}</div>`;
  if (card === "close")
    body = `<h1 style="font-size:140px;margin-top:100px">Scene<em>.</em></h1><p>${ko ? "장면을 근거로, 사람이 마무리하는 한국어 화면해설." : "Korean audio description, grounded in the scene and finished by an editor."}</p><p class="url" style="margin-top:45px">${SERVICE_HOST}</p><div class="note">${credit}<br>${ko ? "GitHub 공개와 공식 제출은 소유자가 별도로 결정합니다." : "Source publication and official submission remain with the owner."}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body><div class="card ${card === "black" ? "black" : ""}">${card !== "black" ? `<header><img src="${icon}" alt="Scene">SCENE · ${ko ? "제작 도구 시연" : "EDITOR WORKFLOW DEMO"}</header>` : ""}${body}</div></body></html>`;
}
export async function renderCards(
  lang: Language,
  data: DemoData,
  outDir: string,
): Promise<Record<CardId | "black", string>> {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  try {
    const page = await browser.newPage({
      viewport: { width: CONTENT_WIDTH, height: CONTENT_HEIGHT },
    });
    const files = {} as Record<CardId | "black", string>;
    for (const id of ["black", "problem", "pipeline", "numbers", "close"] as const) {
      const file = join(outDir, `${id}.html`);
      await writeFile(file, cardHtml(id, lang, data));
      await page.goto(pathToFileURL(file).href);
      await page.evaluate(() => document.fonts.ready);
      files[id] = join(outDir, `${id}.png`);
      await page.screenshot({ path: files[id] });
    }
    return files;
  } finally {
    await browser.close();
  }
}
