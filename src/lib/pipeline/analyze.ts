import { validateAnalysis, type AnalysisParts } from "../store/analysis";
import { measureAudible, trimToAudible } from "./audible";
import type { RelistenReport, RunEvent, StageId } from "./events";
import { assessRoom, findGaps } from "./gaps";
import { chirpRecognizer, hearSpeech } from "./hear";
import { relistenGaps } from "./relisten";
import type { SceneMap, SpeechSegment } from "./schemas";
import { watchClip } from "./watch";

/** The re-listen of a clip with nothing to hear: no silence was recognized again. */
const SOUNDLESS_REPORT: RelistenReport = {
  gapsChecked: 0,
  wordsFound: 0,
  blockedSeconds: 0,
  soundless: true,
};

/** Runs one named stage, emitting its start and its end with the seconds it took. */
export type StageRunner = <T>(name: StageId, work: () => Promise<T>) => Promise<T>;

/**
 * Hearing and watching, side by side. Hearing first measures where the soundtrack can be heard at
 * all (audible.ts), then runs the first recognition pass and recognizes every usable silence again
 * on its own (relisten.ts); speech is then kept to audible audio. A clip whose soundtrack is silent
 * or missing is never sent to the recognizer: its speech is empty, as recognizing and trimming it
 * would make it, and the re-listen report says why. Each part is validated and saved as soon as it
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
    const { audible, firstPass } = await stage("hear", async () => {
      const audible = await measureAudible(clipFile);
      if (audible.length === 0) {
        console.info("hear: the soundtrack is silent; nothing is sent to Speech-to-Text");
        return { audible, firstPass: [] };
      }
      const firstPass = await hearSpeech({
        clipFile,
        clipSeconds,
        languageCode: input.filmLanguageCode,
        ledgerFile,
      });
      return { audible, firstPass };
    });
    const { speech: heard, report } = await stage("relisten", async () =>
      audible.length === 0
        ? { speech: [], report: SOUNDLESS_REPORT }
        : relistenGaps({
            speech: firstPass,
            clipSeconds,
            ledgerFile,
            recognize: chirpRecognizer(clipFile, input.filmLanguageCode),
          }),
    );
    await input.emit({ type: "relisten", ...report });
    const { speech, dropped, shortened } = trimToAudible(heard, audible);
    if (dropped + shortened > 0) {
      const room = (s: typeof speech) =>
        assessRoom(findGaps({ speech: s, sounds: [] }, clipSeconds), clipSeconds).gapSeconds;
      console.info(
        `hear: speech trimmed to audible audio: ${dropped} dropped, ${shortened} shortened, ` +
          `${(room(speech) - room(heard)).toFixed(2)} s of room freed`,
      );
    }
    validateAnalysis({ speech }, clipSeconds);
    await input.onAnalysis?.({ speech });
    return speech;
  };
  const watch = () =>
    stage("watch", async () => {
      const scene = await watchClip({
        videoDataUrl: await input.videoDataUrl,
        clipSeconds,
        audible: await measureAudible(clipFile),
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
