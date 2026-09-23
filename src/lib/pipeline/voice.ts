import { retryableStatus, ServiceError } from "../errors";
import { appendCallRecord } from "../llm/ledger";
import { googleHeaders } from "../google/auth";
import { parseWav } from "../media/wav";
import { reserveCall } from "../runs/budget";

/** Chirp 3: HD list price, USD per character (US$30 per 1M; first 1M a month free). */
export const TTS_USD_PER_CHARACTER = 30 / 1_000_000;
const SAMPLE_RATE = 24000;

export type NarrationLanguage = "ko" | "en";

/** One calm narrator per language. Chirp 3: HD voices, both confirmed in the voice list. */
export const NARRATOR_VOICES: Record<NarrationLanguage, { languageCode: string; name: string }> = {
  ko: { languageCode: "ko-KR", name: "ko-KR-Chirp3-HD-Charon" },
  en: { languageCode: "en-US", name: "en-US-Chirp3-HD-Charon" },
};

export interface SynthesizedLine {
  wav: Buffer;
  seconds: number;
}

/** Speech from Google Cloud Text-to-Speech; duration is measured from the returned samples. */
export async function synthesizeLine(input: {
  text: string;
  language: NarrationLanguage;
  speakingRate: number;
  ledgerFile: string;
  label: string;
  voiceName?: string;
}): Promise<SynthesizedLine> {
  const started = Date.now();
  const voice = NARRATOR_VOICES[input.language];
  const settleCall = reserveCall([...input.text].length * TTS_USD_PER_CHARACTER);
  let cost: number | null = null;
  try {
    const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers: await googleHeaders(),
      body: JSON.stringify({
        input: { text: input.text },
        voice: { languageCode: voice.languageCode, name: input.voiceName ?? voice.name },
        audioConfig: {
          audioEncoding: "LINEAR16",
          sampleRateHertz: SAMPLE_RATE,
          speakingRate: input.speakingRate,
        },
      }),
    });
    if (!response.ok)
      throw new ServiceError(
        "voice_failed",
        `Text-to-Speech HTTP ${response.status}: ${await response.text()}`,
        retryableStatus(response.status),
      );
    const body = (await response.json()) as { audioContent: string };
    const wav = Buffer.from(body.audioContent, "base64");
    const characters = [...input.text].length;
    cost = characters * TTS_USD_PER_CHARACTER;
    const seconds = parseWav(wav).seconds;
    await appendCallRecord(input.ledgerFile, {
      at: new Date(started).toISOString(),
      label: input.label,
      model: `text-to-speech:${input.voiceName ?? voice.name}`,
      provider: "Google Cloud",
      promptTokens: 0,
      completionTokens: 0,
      costUsd: characters * TTS_USD_PER_CHARACTER,
      latencyMs: Date.now() - started,
      firstTokenMs: null,
      finishReason: "",
      ok: true,
      characters,
    });
    return { wav, seconds };
  } catch (error) {
    await appendCallRecord(input.ledgerFile, {
      at: new Date(started).toISOString(),
      label: input.label,
      model: `text-to-speech:${input.voiceName ?? voice.name}`,
      provider: "Google Cloud",
      promptTokens: 0,
      completionTokens: 0,
      costUsd: cost ?? 0,
      costKnown: cost !== null,
      latencyMs: Date.now() - started,
      firstTokenMs: null,
      finishReason: "",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    settleCall(cost);
  }
}
