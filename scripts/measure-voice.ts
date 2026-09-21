/**
 * Measures narrator speaking speed (characters / words per second) per language and rate.
 * Out: runtime/measure/voice-rates-<stamp>.json — the numbers the writer's length budget uses.
 */
import { writeFile } from "node:fs/promises";
import { synthesizeLine, type NarrationLanguage } from "../src/lib/pipeline/voice";

const LINES: Record<NarrationLanguage, string[]> = {
  ko: [
    "로켓 엔진이 불을 뿜으며 거대한 발사대가 흔들린다.",
    "운하 위 다리에서 청년과 붉은 머리 여자가 난간에 기대어 선다.",
    "여자가 기계 손을 들어 올린다.",
    "어두운 실험실, 접시 위에 놓인 뇌가 분홍빛으로 빛난다.",
  ],
  en: [
    "Rocket engines roar to life as the launch tower shakes.",
    "On a bridge over a canal, a young man and a red-haired woman lean on the railing.",
    "She raises her mechanical hand.",
    "In a dark lab, a brain on a plate glows pink.",
  ],
};
const RATES = [1.0, 1.15];

async function main(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ledgerFile = `runtime/measure/voice-${stamp}.ledger.jsonl`;
  const rows = [];
  for (const language of ["ko", "en"] as NarrationLanguage[]) {
    for (const rate of RATES) {
      for (const text of LINES[language]) {
        const { seconds } = await synthesizeLine({
          text,
          language,
          speakingRate: rate,
          ledgerFile,
          label: "measure-voice",
        });
        const chars = [...text.replace(/\s/g, "")].length;
        const words = text.split(/\s+/).length;
        rows.push({
          language,
          rate,
          text,
          seconds,
          charsPerSecond: chars / seconds,
          wordsPerSecond: words / seconds,
        });
      }
    }
  }
  for (const language of ["ko", "en"]) {
    for (const rate of RATES) {
      const r = rows.filter((x) => x.language === language && x.rate === rate);
      const cps = r.reduce((s, x) => s + x.charsPerSecond, 0) / r.length;
      const wps = r.reduce((s, x) => s + x.wordsPerSecond, 0) / r.length;
      console.log(
        `${language} rate=${rate}: ${cps.toFixed(2)} non-space chars/s, ${wps.toFixed(2)} words/s, lines ${r.map((x) => x.seconds.toFixed(2)).join(", ")}`,
      );
    }
  }
  await writeFile(`runtime/measure/voice-rates-${stamp}.json`, JSON.stringify(rows, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
