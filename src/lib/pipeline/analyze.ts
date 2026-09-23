import { validateAnalysis, type AnalysisParts } from "../store/analysis";
import type { RunEvent, StageId } from "./events";
import { chirpRecognizer, hearSpeech } from "./hear";
import { relistenGaps } from "./relisten";
import type { SceneMap, SpeechSegment } from "./schemas";
import { watchClip } from "./watch";

/** Runs one named stage, emitting its start and its end with the seconds it took. */
export type StageRunner = <T>(name: StageId, work: () => Promise<T>) => Promise<T>;

/**
 * Hearing and watching, side by side. Hearing is the first recognition pass, then every usable
 * silence recognized again on its own (relisten.ts). Each part is validated and saved as soon as it
 * is complete, so a later failure does not lose it; a saved part is reused instead of paid for again.
 */
export async function analyzeClip(input: {
  clipFile: string;
  clipSeconds: number;
  /** Spoken language of the film, for the recognizer (BCP-47, e.g. en-US). */
  filmLanguageCode: string;
  watchModel: string;
  ledgerFile: string;
  videoDataUrl: Promise<string>;
  cached?: AnalysisParts;
  onAnalysis?: (part: AnalysisParts) => Promise<void>;
  stage: StageRunner;
  emit: (event: RunEvent) => Promise<void>;
}): Promise<{ speech: SpeechSegment[]; scene: SceneMap }> {
  const { clipFile, clipSeconds, ledgerFile, stage } = input;
  const hear = async () => {
    const firstPass = await stage("hear", () =>
      hearSpeech({ clipFile, clipSeconds, languageCode: input.filmLanguageCode, ledgerFile }),
    );
    const { speech, report } = await stage("relisten", () =>
      relistenGaps({
        speech: firstPass,
        clipSeconds,
        ledgerFile,
        recognize: chirpRecognizer(clipFile, input.filmLanguageCode),
      }),
    );
    await input.emit({ type: "relisten", ...report });
    validateAnalysis({ speech }, clipSeconds);
    await input.onAnalysis?.({ speech });
    return speech;
  };
  const watch = () =>
    stage("watch", async () => {
      const scene = await watchClip({
        videoDataUrl: await input.videoDataUrl,
        clipSeconds,
        model: input.watchModel,
        ledgerFile,
      });
      validateAnalysis({ scene }, clipSeconds);
      await input.onAnalysis?.({ scene });
      return scene;
    });
  const [speech, scene] = await Promise.allSettled([
    input.cached?.speech ? Promise.resolve(input.cached.speech) : hear(),
    input.cached?.scene ? Promise.resolve(input.cached.scene) : watch(),
  ]);
  if (speech.status === "rejected") throw speech.reason;
  if (scene.status === "rejected") throw scene.reason;
  return { speech: speech.value, scene: scene.value };
}
