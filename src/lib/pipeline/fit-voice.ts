import { speedUpLine, trimSilence, type TrimmedLine } from "../media/narration-track";
import { ServiceError } from "../errors";
import type { ClipContext } from "./context";
import { latest, triedBefore, withFailedWordings } from "./cues";
import type { RunEvent } from "./events";
import { spokenUnits, unitBudget } from "./length";
import { mapLimit } from "./map-limit";
import type { Cue, Language } from "./schemas";
import { synthesizeLine } from "./voice";
import { reviseLines } from "./write";

/** Voice → shorten rounds before a line that still overruns its window is dropped. */
const MAX_SHORTEN_ROUNDS = 2;
/**
 * Fastest a take is played: the limit kept from when Chirp 3 HD set its own speaking rate. The FFmpeg
 * atempo speed-up that replaced it (2026-10-03) has not been listened to at this rate.
 */
const MAX_SPEAKING_RATE = 1.15;
/** Shortening aims below the window so the re-voiced line lands inside it. */
const SHORTEN_TARGET = 0.9;
/** A sped-up line aims this much under its window, so rounding does not push it over. */
const RATE_HEADROOM = 1.03;
const TTS_CONCURRENCY = 4;

/**
 * Voices approved lines and measures each against its window. A line that overruns is sped up
 * slightly, or shortened by the writer, reviewed again and re-voiced; one that still overruns is
 * dropped. Returns the audio of every line that fits, by cue id.
 *
 * Speeding up stretches the take in hand (FFmpeg atempo, pitch kept) instead of asking Text-to-Speech
 * for a faster one: takes of one text vary by about 10%, so in the QA runs of 2026-10-03 a new take at
 * the higher rate still overran in 12 of 32 tries, and each miss went through a shortening and two
 * reviews (21–90 s). A stretched take is exactly as long as the rate makes it.
 */
export async function voiceToFit(input: {
  active: () => Cue[];
  /** Lines to voice; every active line when unset. */
  pending?: Cue[];
  context: ClipContext;
  language: Language;
  writerModel: string;
  ledgerFile: string;
  emit: (event: RunEvent) => Promise<void>;
  /** A shortened line is a new line: reviewed again, with one rewrite left, before it is voiced. */
  reviewShortened: (cues: Cue[]) => Promise<void>;
}): Promise<Map<string, TrimmedLine>> {
  const { emit, language, writerModel, ledgerFile, context } = input;
  const lines = new Map<string, TrimmedLine>();
  // A retryable Text-to-Speech failure (busy, 5xx) is tried once more before the run gives up.
  const voice = async (cue: Cue) => {
    const request = {
      text: latest(cue).text,
      language,
      speakingRate: 1,
      ledgerFile,
      label: "voice",
    };
    const { wav } = await synthesizeLine(request).catch((error: unknown) => {
      if (!(error instanceof ServiceError) || !error.retryable) throw error;
      console.warn(`Text-to-Speech failed, retrying once: ${cue.id}`);
      return synthesizeLine(request);
    });
    return trimSilence(wav);
  };
  let pending = input.pending ?? input.active();
  for (let pass = 0; pending.length > 0; pass++) {
    const tooLong: Cue[] = [];
    await mapLimit(pending, TTS_CONCURRENCY, async (cue) => {
      const room = cue.windowEnd - cue.start;
      let rate = 1;
      let line = await voice(cue);
      const firstSeconds = line.seconds;
      if (line.seconds > room && line.seconds / MAX_SPEAKING_RATE <= room) {
        rate = round(Math.min(MAX_SPEAKING_RATE, (line.seconds / room) * RATE_HEADROOM));
        line = await speedUpLine(line, rate);
      }
      const fits = line.seconds <= room;
      latest(cue).voice = { seconds: round(line.seconds), rate };
      await emit({
        type: "cue_voiced",
        cueId: cue.id,
        seconds: round(line.seconds),
        rate,
        window: round(room),
        fits,
        ...(rate !== 1 ? { firstSeconds: round(firstSeconds) } : {}),
      });
      if (fits) {
        cue.status = "fits";
        cue.seconds = line.seconds;
        cue.rate = rate;
        lines.set(cue.id, line);
      } else tooLong.push(cue);
    });
    if (tooLong.length === 0) break;
    if (pass >= MAX_SHORTEN_ROUNDS) {
      for (const cue of tooLong) {
        cue.status = "dropped";
        cue.droppedReason = "too_long";
        dropVoicing(cue);
        await emit({ type: "cue_dropped", cueId: cue.id, reason: "too_long" });
      }
      break;
    }
    const { revisions: shortened } = await reviseLines({
      context,
      model: writerModel,
      ledgerFile,
      label: `shorten:${pass + 1}`,
      requests: tooLong.map((cue) => {
        const room = cue.windowEnd - cue.start;
        const maxUnits = unitBudget(room * SHORTEN_TARGET, language);
        const spoken = latest(cue).voice?.seconds ?? 0;
        return {
          cue,
          text: latest(cue).text,
          violations: [],
          fix: withFailedWordings(
            cue,
            `Spoken, this line takes ${spoken.toFixed(1)} s but has ${room.toFixed(1)} s of room ` +
              `(${spokenUnits(latest(cue).text, language)} → at most ${maxUnits}). ` +
              `Cut it, keeping the most important visual information.`,
          ),
          maxUnits,
        };
      }),
      otherLines: input
        .active()
        .filter((c) => !tooLong.includes(c))
        .map((c) => ({ id: c.id, start: c.start, text: latest(c).text })),
    });
    for (const cue of tooLong) {
      const text = shortened.get(cue.id);
      // A shortening the writer left out, or a wording the line already had (rejected or too long),
      // counts as none: the overlong line goes, the run carries on.
      if (!text) console.warn(`shorten returned nothing for ${cue.id}; dropping it`);
      if (!text || triedBefore(cue, text)) {
        cue.status = "dropped";
        cue.droppedReason = "unchanged";
        dropVoicing(cue);
        await emit({ type: "cue_dropped", cueId: cue.id, reason: "unchanged" });
        continue;
      }
      cue.versions.push({ text: text.trim(), by: "shorten", model: writerModel });
      cue.status = "pending";
      await emit({ type: "cue_revised", cueId: cue.id, by: "shorten", text, model: writerModel });
    }
    await input.reviewShortened(tooLong.filter((c) => c.status !== "dropped"));
    pending = tooLong.filter((c) => c.status === "approved");
  }
  return lines;
}

/** A dropped line is not heard: it keeps no measured length from an earlier voicing that fit. */
function dropVoicing(cue: Cue): void {
  delete cue.seconds;
  delete cue.rate;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
