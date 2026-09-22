/**
 * The still frames of the demo, drawn as HTML in the app's own tokens (one warm grey ramp, amber for
 * narration) and captured by Chrome at the video's content size. Numbers come from the run summary.
 *
 * Output: runtime/demo/<lang>/cards/<card>.png (1920×960)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { formatSeconds, formatUsd } from "../../src/lib/format";
import type { Language } from "../../src/lib/pipeline/schemas";
import type { DemoData } from "./demo-data";
import { REPO_URL, SERVICE_HOST, type CardId } from "./storyboard";

export const CONTENT_WIDTH = 1920;
export const CONTENT_HEIGHT = 960;
export const CHROME_PATH = "/usr/bin/google-chrome";

const FONT_FILE = join(
  process.cwd(),
  "node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2",
);

const STYLE = `
@font-face { font-family: "Pretendard Variable"; src: url("${pathToFileURL(FONT_FILE).href}") format("woff2"); font-weight: 45 920; }
* { box-sizing: border-box; }
html, body { margin: 0; width: ${CONTENT_WIDTH}px; height: ${CONTENT_HEIGHT}px; background: #0c0d0f; color: #e7e9ec;
  font-family: "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif; -webkit-font-smoothing: antialiased; }
.card { width: 100%; height: 100%; padding: 96px 128px; display: flex; flex-direction: column; }
.kicker { font-size: 26px; font-weight: 600; color: #8a9098; letter-spacing: 0.02em; }
h1 { margin: 16px 0 0; font-size: 68px; line-height: 1.2; font-weight: 700; color: #fff; letter-spacing: -0.02em; }
.accent { color: #f1b54b; }
.facts { margin-top: 64px; display: grid; gap: 28px; }
.fact { display: grid; grid-template-columns: 300px 1fr; gap: 40px; align-items: baseline; padding-top: 28px; border-top: 1px solid #2c3036; }
.fact .big { font-size: 56px; font-weight: 700; color: #fff; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.fact .big.accent { color: #f1b54b; }
.fact p { margin: 0; font-size: 32px; line-height: 1.5; }
.fact small { display: block; margin-top: 8px; font-size: 20px; color: #8a9098; }
.flow { margin-top: 72px; display: grid; grid-template-columns: repeat(6, 1fr); gap: 18px; }
.step { position: relative; padding: 26px 24px; border: 1px solid #3a3f46; border-radius: 12px; background: #141518; min-height: 250px; }
.step.narration { border-color: #f1b54b; }
.step .name { font-size: 30px; font-weight: 700; color: #fff; }
.step .who { margin-top: 10px; font-size: 22px; font-weight: 600; color: #f1b54b; }
.step .who.code { color: #8a9098; }
.step p { margin: 14px 0 0; font-size: 21px; line-height: 1.5; color: #c9ccd1; }
.loops { margin-top: 26px; display: grid; grid-template-columns: repeat(6, 1fr); gap: 18px; font-size: 21px; color: #8a9098; }
.loop { grid-column: span 2; padding: 12px 18px; border-left: 2px solid #d98474; background: rgba(217,132,116,0.08); }
.outputs { margin-top: auto; font-size: 24px; color: #8a9098; }
.outputs b { color: #e7e9ec; font-weight: 600; }
.card > * { flex-shrink: 0; }
.numbers { margin-top: 56px; display: grid; grid-template-columns: 1fr 560px; gap: 72px; align-items: start; }
.stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; background: #2c3036; border: 1px solid #2c3036; border-radius: 12px; overflow: hidden; }
.stat { padding: 26px 36px; background: #141518; }
.stat .v { font-size: 60px; font-weight: 700; color: #fff; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
.stat .v.accent { color: #f1b54b; }
.stat .l { margin-top: 4px; font-size: 26px; color: #8a9098; }
.stages { margin-top: 20px; display: grid; grid-template-columns: 150px 1fr 100px; gap: 14px 20px; align-items: center; font-size: 22px; }
.stages .bar { height: 14px; border-radius: 7px; background: #3a3f46; }
.stages .n { text-align: right; font-variant-numeric: tabular-nums; color: #c9ccd1; }
.close { justify-content: center; }
.wordmark { font-size: 132px; font-weight: 800; color: #fff; letter-spacing: -0.03em; }
.wordmark span { color: #f1b54b; }
.links { margin-top: 48px; display: grid; gap: 14px; font-size: 38px; }
.links .k { display: inline-block; width: 200px; color: #8a9098; }
.credit { margin-top: 72px; font-size: 22px; color: #8a9098; line-height: 1.6; }
.black { background: #000; justify-content: flex-end; align-items: flex-end; }
.black .credit { margin: 0; }
`;

const page = (body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>${STYLE}</style></head><body>${body}</body></html>`;

const FILM_CREDIT = "Tears of Steel · (CC) Blender Foundation | mango.blender.org · CC BY 3.0";

const COPY = {
  en: {
    problemKicker: "The problem",
    problemTitle: `Audio description is <span class="accent">still made by hand.</span>`,
    ruling: "3 Sep 2026",
    rulingText:
      "Korea's Supreme Court overturned the lower-court limit of “3% of screenings, 300+ seat halls” on cinemas' duty to describe films.",
    rulingSource: "Maxmovie, 2026-09-03 · maxmovie.com/news/articleView.html?idxno=501673",
    cost: "₩14M",
    costText:
      "to make one Korean barrier-free film: script, narration and sync all by hand. ₩31M for a foreign film with dubbing.",
    costSource: "Barrier-Free Film Committee FAQ · barrierfreefilms.or.kr",
    scene: "Scene",
    sceneText:
      "writes, reviews, voices and mixes the track automatically, for any short clip, in Korean and English.",
    pipelineKicker: "How it works",
    pipelineTitle: "Every step has its own model. Code joins them.",
    steps: [
      ["Hear", "Chirp 3", "Speech-to-Text times every spoken word."],
      ["Watch", "Gemini 3.8 Flash", "Shots, people, on-screen text and key sounds."],
      ["Find room", "Code", "The clip minus dialogue and key sounds."],
      ["Write", "Gemini 3.8 Flash", "One line per pause, sized to its room."],
      ["Review", "Gemini 3.8 Flash", "Eight rules from Korean broadcast and Netflix guidelines."],
      ["Voice & mix", "Chirp 3 HD", "Measured length; film ducked under narration."],
    ],
    loopReview: "Rejected → rewritten and reviewed again",
    loopVoice: "Too long → spoken 15% faster at most, then shortened",
    outputs:
      "Outputs: <b>described MP4</b> · <b>narration WAV</b> · <b>WebVTT</b> · <b>script JSON</b> with every version and verdict<br>Runs on <b>Cloud Run</b> with a Cloud Storage volume and Secret Manager",
    numbersKicker: "Measured on Cloud Run",
    numbersTitle: (clip: number) => `One ${clip}-second clip, English narration`,
    fit: "lines fit their pauses",
    overlap: "over dialogue",
    rejected: "lines flagged by the reviewer",
    costLabel: "cost of the whole job",
    timeLabel: "from upload to mixed film",
    llm: "Gemini calls",
    costByStage: "Cost by stage",
    stageNames: {
      hear: "Hear",
      watch: "Watch",
      write: "Write",
      review: "Review",
      revise: "Rewrite",
      voice: "Voice",
      shorten: "Shorten",
    } as Record<string, string>,
    tryIt: "Try it",
    code: "Code",
    tagline: "Audio description that fits the silence between the lines.",
  },
  ko: {
    problemKicker: "문제",
    problemTitle: `화면해설은 <span class="accent">아직 사람이 손으로 만듭니다.</span>`,
    ruling: "2026. 9. 3.",
    rulingText:
      "대법원이 극장의 화면해설 제공 의무에 걸려 있던 “300석 이상 상영관, 상영 횟수의 3%” 제한을 파기했습니다.",
    rulingSource: "맥스무비, 2026-09-03 · maxmovie.com/news/articleView.html?idxno=501673",
    cost: "1,400만 원",
    costText:
      "한국 영화 한 편의 배리어프리 제작비. 대본·내레이션·싱크가 모두 수작업입니다. 더빙을 더한 외화는 3,100만 원.",
    costSource: "배리어프리영화위원회 FAQ · barrierfreefilms.or.kr",
    scene: "씬",
    sceneText:
      "짧은 영상이면 무엇이든, 해설을 쓰고 검수하고 읽고 믹스까지 자동으로 합니다. 한국어와 영어.",
    pipelineKicker: "동작 방식",
    pipelineTitle: "단계마다 모델이 따로 있고, 코드가 잇습니다.",
    steps: [
      ["듣기", "Chirp 3", "음성 인식으로 대사를 단어 단위로 잽니다."],
      ["보기", "Gemini 3.8 Flash", "숏, 인물, 화면 속 글자, 주요 소리."],
      ["빈 구간", "코드", "영상에서 대사와 주요 소리를 뺀 시간."],
      ["쓰기", "Gemini 3.8 Flash", "구간마다 한 줄, 구간 길이에 맞춰."],
      ["검수", "Gemini 3.8 Flash", "방송 가이드라인·넷플릭스 기준 8개 규칙."],
      ["음성·믹스", "Chirp 3 HD", "실제 길이 측정, 해설 밑으로 영화 소리 낮춤."],
    ],
    loopReview: "반려 → 다시 쓰고 다시 검수",
    loopVoice: "길면 → 최대 15% 빠르게, 그래도 길면 줄여 쓰기",
    outputs:
      "산출물: <b>해설 MP4</b> · <b>해설 WAV</b> · <b>WebVTT</b> · 모든 버전과 판정이 담긴 <b>대본 JSON</b><br><b>Cloud Run</b>에서 Cloud Storage 볼륨, Secret Manager와 함께 동작",
    numbersKicker: "Cloud Run 실측",
    numbersTitle: (clip: number) => `${clip}초 영상 한 편, 한국어 해설`,
    fit: "빈 구간 안에 들어간 줄",
    overlap: "대사와 겹친 시간",
    rejected: "검수에서 반려된 줄",
    costLabel: "작업 전체 비용",
    timeLabel: "업로드부터 믹스까지",
    llm: "Gemini 호출",
    costByStage: "단계별 비용",
    stageNames: {
      hear: "듣기",
      watch: "보기",
      write: "쓰기",
      review: "검수",
      revise: "다시 쓰기",
      voice: "음성",
      shorten: "줄여 쓰기",
    } as Record<string, string>,
    tryIt: "써 보기",
    code: "코드",
    tagline: "대사 사이의 침묵에 맞춰 쓰는 화면해설.",
  },
};

function cardHtml(card: CardId | "black", lang: Language, data: DemoData): string {
  const c = COPY[lang];
  const summary = data.standard.summary;
  if (card === "black")
    return page(`<div class="card black"><div class="credit">${FILM_CREDIT}</div></div>`);
  if (card === "problem") {
    return page(`<div class="card">
      <div class="kicker">${c.problemKicker}</div>
      <h1>${c.problemTitle}</h1>
      <div class="facts">
        <div class="fact"><div class="big">${c.ruling}</div><p>${c.rulingText}<small>${c.rulingSource}</small></p></div>
        <div class="fact"><div class="big">${c.cost}</div><p>${c.costText}<small>${c.costSource}</small></p></div>
        <div class="fact"><div class="big accent">${c.scene}</div><p>${c.sceneText}</p></div>
      </div></div>`);
  }
  if (card === "pipeline") {
    const steps = c.steps
      .map(([name, who, text], i) => {
        const narration = i >= 3;
        const code = who === "Code" || who === "코드";
        return `<div class="step${narration ? " narration" : ""}"><div class="name">${name}</div><div class="who${code ? " code" : ""}">${who}</div><p>${text}</p></div>`;
      })
      .join("");
    return page(`<div class="card">
      <div class="kicker">${c.pipelineKicker}</div>
      <h1>${c.pipelineTitle}</h1>
      <div class="flow">${steps}</div>
      <div class="loops"><span></span><span></span><span></span><div class="loop">↺ ${c.loopReview}</div><div class="loop" style="grid-column: 6 / 7">↺ ${c.loopVoice}</div></div>
      <div class="outputs">${c.outputs}</div></div>`);
  }
  if (card === "numbers") {
    const stages = Object.entries(summary.costByStage).filter(([, v]) => v > 0);
    const max = Math.max(...stages.map(([, v]) => v));
    const bars = stages
      .map(
        ([k, v]) =>
          `<span>${c.stageNames[k] ?? k}</span><div class="bar" style="width:${(v / max) * 100}%;${k === "voice" ? "background:#f1b54b" : ""}"></div><span class="n">${formatUsd(v, lang)}</span>`,
      )
      .join("");
    const fixed = summary.cuesRejected;
    const minutes = Math.floor(summary.wallSeconds / 60);
    const secs = Math.round(summary.wallSeconds % 60);
    const time = lang === "ko" ? `${minutes}분 ${secs}초` : `${minutes} min ${secs} s`;
    return page(`<div class="card">
      <div class="kicker">${c.numbersKicker}</div>
      <h1>${c.numbersTitle(summary.clipSeconds)}</h1>
      <div class="numbers">
      <div class="stats">
        <div class="stat"><div class="v accent">${summary.cuesFitting}/${summary.cuesShipped}</div><div class="l">${c.fit}</div></div>
        <div class="stat"><div class="v">${formatSeconds(summary.overlapWithSpeechSeconds, lang)}</div><div class="l">${c.overlap}</div></div>
        <div class="stat"><div class="v">${fixed}</div><div class="l">${c.rejected}</div></div>
        <div class="stat"><div class="v">${formatUsd(summary.costUsd, lang)}</div><div class="l">${c.costLabel}</div></div>
        <div class="stat"><div class="v">${time}</div><div class="l">${c.timeLabel}</div></div>
        <div class="stat"><div class="v">${summary.llmCalls}</div><div class="l">${c.llm}</div></div>
      </div>
      <div><div class="kicker">${c.costByStage}</div><div class="stages">${bars}</div></div>
      </div></div>`);
  }
  return page(`<div class="card close">
    <div class="wordmark">${lang === "ko" ? "씬 <span>Scene</span>" : "Scene"}</div>
    <div class="kicker" style="font-size:34px;margin-top:12px">${c.tagline}</div>
    <div class="links">
      <div><span class="k">${c.tryIt}</span>${SERVICE_HOST}</div>
      <div><span class="k">${c.code}</span>${REPO_URL}</div>
    </div>
    <div class="credit">Gemini 3.8 Flash · Chirp 3 · Chirp 3 HD · Cloud Run<br>${FILM_CREDIT}</div></div>`);
}

/** Renders every card for one language and returns their PNG paths. */
export async function renderCards(
  lang: Language,
  data: DemoData,
  outDir: string,
): Promise<Record<CardId | "black", string>> {
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME_PATH });
  try {
    const context = await browser.newContext({
      viewport: { width: CONTENT_WIDTH, height: CONTENT_HEIGHT },
      deviceScaleFactor: 1,
    });
    const tab = await context.newPage();
    const ids: (CardId | "black")[] = ["black", "problem", "pipeline", "numbers", "close"];
    const files = {} as Record<CardId | "black", string>;
    for (const id of ids) {
      const htmlFile = join(outDir, `${id}.html`);
      await writeFile(htmlFile, cardHtml(id, lang, data));
      await tab.goto(pathToFileURL(htmlFile).href);
      await tab.evaluate(() => document.fonts.ready);
      files[id] = join(outDir, `${id}.png`);
      await tab.screenshot({ path: files[id] });
    }
    return files;
  } finally {
    await browser.close();
  }
}
