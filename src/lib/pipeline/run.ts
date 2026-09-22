import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readCallRecords, summarizeCosts } from "../llm/ledger";
import { ProviderError } from "../llm/openrouter";
import { validateAnalysis, type AnalysisParts } from "../store/analysis";
import { encodeWatchingVideo } from "../media/proxies";
import {
  buildNarrationTrack,
  encodeWav,
  trimSilence,
  type TrimmedLine,
} from "../media/narration-track";
import { describedVtt, mixDescribedFilm } from "../media/mix";
import type { ClipContext } from "./context";
import type { RunEvent, RunFiles, RunSummary, TimedRunEvent } from "./events";
import { findGaps } from "./gaps";
import { hearSpeech } from "./hear";
import { spokenUnits, unitBudget } from "./length";
import { reviewLines } from "./review";
import type {
  Cue,
  Density,
  DraftCue,
  Gap,
  Language,
  SceneMap,
  SpeechSegment,
  Verdict,
} from "./schemas";
import { synthesizeLine } from "./voice";
import { watchClip } from "./watch";
import { reviseLines, writeScript, type RevisionRequest } from "./write";

/** Review rounds: one revision chance, then a line that still breaks a rule is dropped. */
const MAX_REVIEW_ROUNDS = 2;
/** Voice → shorten rounds before a line that still overruns its window is dropped. */
const MAX_SHORTEN_ROUNDS = 2;
/** Chirp 3: HD stays natural up to about 15% faster than its default pace. */
const MAX_SPEAKING_RATE = 1.15;
/** A line needs at least this much room. */
const MIN_ROOM_SECONDS = 1.0;
/** Shortening aims below the window so the re-voiced line lands inside it. */
const SHORTEN_TARGET = 0.9;
const TTS_CONCURRENCY = 4;

export interface RunOptions {
  runId: string;
  runDir: string;
  clipFile: string;
  clipSeconds: number;
  /** Spoken language of the film, for the recognizer (BCP-47, e.g. en-US). */
  filmLanguageCode: string;
  language: Language;
  density: Density;
  writerModel: string;
  reviewerModel: string;
  /** Hearing and watching do not depend on narration language or density; later runs reuse them. */
  cached?: AnalysisParts;
  onAnalysis?: (part: AnalysisParts) => Promise<void>;
  emit?: (event: TimedRunEvent) => void;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  });
  const completed = await Promise.allSettled(workers);
  for (const result of completed) if (result.status === "rejected") throw result.reason;
  return results;
}

/** Turns the writer's lines into placed cues: inside a gap, in order, each with its room computed. */
export function placeCues(drafts: DraftCue[], gaps: Gap[]): { placed: Cue[]; dropped: Cue[] } {
  const placed: Cue[] = [];
  const dropped: Cue[] = [];
  const byGap = new Map<string, DraftCue[]>();
  let n = 0;
  for (const draft of drafts) {
    const gap = gaps.find((g) => g.id === draft.gapId && draft.at >= g.start && draft.at < g.end);
    if (!gap || !Number.isFinite(draft.at) || !draft.text.trim()) {
      dropped.push({
        id: `L${++n}`,
        gapId: draft.gapId,
        start: draft.at,
        windowEnd: draft.at,
        versions: [{ text: draft.text, by: "write", model: "" }],
        status: "dropped",
        droppedReason: "invalid_placement",
      });
      continue;
    }
    byGap.set(gap.id, [...(byGap.get(gap.id) ?? []), { ...draft, gapId: gap.id }]);
  }
  for (const gap of gaps) {
    const lines = (byGap.get(gap.id) ?? []).sort((a, b) => a.at - b.at);
    lines.forEach((line, i) => {
      const start = line.at;
      const next = lines[i + 1];
      const windowEnd = next ? Math.min(Math.max(next.at, gap.start), gap.end) : gap.end;
      const cue: Cue = {
        id: `L${++n}`,
        gapId: gap.id,
        start,
        windowEnd,
        versions: [{ text: line.text.trim(), by: "write", model: "" }],
        status: "pending",
      };
      if (windowEnd - start < MIN_ROOM_SECONDS) {
        cue.status = "dropped";
        cue.droppedReason = "no_room";
        dropped.push(cue);
      } else placed.push(cue);
    });
  }
  return { placed, dropped };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function latest(cue: Cue) {
  return cue.versions[cue.versions.length - 1];
}

export function sameWords(a: string, b: string): boolean {
  return (
    a.normalize("NFKC").replace(/\s+/g, " ").trim() ===
    b.normalize("NFKC").replace(/\s+/g, " ").trim()
  );
}

function overlapSeconds(spans: { start: number; end: number }[], speech: SpeechSegment[]): number {
  let total = 0;
  for (const a of spans) {
    for (const b of speech)
      total += Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  }
  return total;
}

/**
 * One description run. The model decides what to say; this code decides where it may be said, whether a
 * line is accepted, how long it really is, and when to stop trying.
 */
export async function runDescription(
  options: RunOptions,
): Promise<{ summary: RunSummary; cues: Cue[] }> {
  const started = Date.now();
  const ledgerFile = join(options.runDir, "ledger.jsonl");
  const eventsFile = join(options.runDir, "events.jsonl");
  await mkdir(join(options.runDir, "voice"), { recursive: true });

  const emit = async (event: RunEvent) => {
    const timed = { ...event, t: round((Date.now() - started) / 1000) } as TimedRunEvent;
    if (event.type !== "writer_delta") await appendFile(eventsFile, `${JSON.stringify(timed)}\n`);
    options.emit?.(timed);
  };
  const stage = async <T>(
    name: Parameters<typeof emitStage>[0],
    work: () => Promise<T>,
  ): Promise<T> => {
    const t0 = Date.now();
    await emitStage(name, "started");
    const result = await work();
    await emitStage(name, "done", (Date.now() - t0) / 1000);
    return result;
  };
  const emitStage = (
    name: "hear" | "watch" | "gaps" | "write" | "review" | "voice" | "verify" | "mix",
    state: "started" | "done",
    seconds?: number,
  ) => emit({ type: "stage", stage: name, state, seconds });

  await emit({
    type: "run_started",
    runId: options.runId,
    language: options.language,
    density: options.density,
    writerModel: options.writerModel,
    reviewerModel: options.reviewerModel,
    clipSeconds: options.clipSeconds,
  });

  try {
    // The small watching copy is needed by watch, write and review; encode it once, in the background.
    const videoDataUrlPromise = encodeWatchingVideo(options.clipFile).then(
      (video) => `data:video/mp4;base64,${video.toString("base64")}`,
    );

    // 1. Hear and watch are independent: run them together.
    const analysisResults = await Promise.allSettled([
      options.cached?.speech
        ? Promise.resolve(options.cached.speech)
        : stage("hear", async () => {
            const speech = await hearSpeech({
              clipFile: options.clipFile,
              clipSeconds: options.clipSeconds,
              languageCode: options.filmLanguageCode,
              ledgerFile,
            });
            validateAnalysis({ speech }, options.clipSeconds);
            await options.onAnalysis?.({ speech });
            return speech;
          }),
      options.cached?.scene
        ? Promise.resolve(options.cached.scene)
        : stage("watch", async () => {
            const scene = await watchClip({
              videoDataUrl: await videoDataUrlPromise,
              clipSeconds: options.clipSeconds,
              model: options.reviewerModel,
              ledgerFile,
            });
            validateAnalysis({ scene }, options.clipSeconds);
            await options.onAnalysis?.({ scene });
            return scene;
          }),
    ]);
    for (const result of analysisResults) if (result.status === "rejected") throw result.reason;
    const speech = (analysisResults[0] as PromiseFulfilledResult<SpeechSegment[]>).value;
    const scene = (analysisResults[1] as PromiseFulfilledResult<SceneMap>).value;
    await emit({ type: "speech", segments: speech });
    await emit({ type: "scene", map: scene });

    // 2. Gaps: where narration may speak.
    const gaps = await stage("gaps", async () =>
      findGaps({ speech, sounds: scene.sounds }, options.clipSeconds),
    );
    await emit({ type: "gaps", gaps });

    const videoDataUrl = await videoDataUrlPromise;
    const context: ClipContext = {
      language: options.language,
      density: options.density,
      clipSeconds: options.clipSeconds,
      speech,
      scene,
      gaps,
      videoDataUrl,
    };

    // 3. Write.
    const drafts = await stage("write", () =>
      writeScript({
        context,
        model: options.writerModel,
        ledgerFile,
        onDelta: (text) =>
          options.emit?.({ type: "writer_delta", text, t: round((Date.now() - started) / 1000) }),
      }),
    );
    const { placed, dropped } = placeCues(drafts, gaps);
    const cues = [...placed, ...dropped].sort((a, b) => a.start - b.start);
    for (const cue of cues) {
      latest(cue).model = options.writerModel;
      await emit({ type: "cue_written", cue });
      if (cue.status === "dropped")
        await emit({ type: "cue_dropped", cueId: cue.id, reason: cue.droppedReason! });
    }
    const active = () => cues.filter((c) => c.status !== "dropped");

    // New lines the reviewer asked for: placed in their gap, and every window in that gap recomputed.
    let cueCount = cues.length;
    const recomputeWindows = async () => {
      for (const gap of gaps) {
        const inGap = active()
          .filter((c) => c.gapId === gap.id)
          .sort((a, b) => a.start - b.start);
        for (const [i, cue] of inGap.entries()) {
          const windowEnd = inGap[i + 1]?.start ?? gap.end;
          if (windowEnd !== cue.windowEnd) {
            cue.windowEnd = windowEnd;
            await emit({ type: "cue_window", cueId: cue.id, windowEnd });
          }
        }
      }
    };
    const addCues = async (additions: DraftCue[]): Promise<Cue[]> => {
      const added: Cue[] = [];
      for (const draft of additions) {
        const gap = gaps.find(
          (g) => g.id === draft.gapId && draft.at >= g.start && draft.at < g.end,
        );
        if (!gap) {
          const cue = placeCues([draft], gaps).dropped[0];
          cue.id = `L${++cueCount}`;
          cues.push(cue);
          await emit({ type: "cue_written", cue });
          await emit({ type: "cue_dropped", cueId: cue.id, reason: "invalid_placement" });
          continue;
        }
        const cue: Cue = {
          id: `L${++cueCount}`,
          gapId: gap.id,
          start: draft.at,
          windowEnd: gap.end,
          versions: [{ text: draft.text.trim(), by: "add", model: options.writerModel }],
          status: "pending",
        };
        cues.push(cue);
        added.push(cue);
      }
      cues.sort((a, b) => a.start - b.start);
      await recomputeWindows();
      for (const cue of added) {
        await emit({ type: "cue_written", cue });
        if (cue.windowEnd - cue.start < MIN_ROOM_SECONDS) {
          cue.status = "dropped";
          cue.droppedReason = "no_room";
          await emit({ type: "cue_dropped", cueId: cue.id, reason: "no_room" });
        }
      }
      await recomputeWindows();
      return added.filter((c) => c.status !== "dropped");
    };

    // 4. Review until every line passes or runs out of rounds. The first pass over the whole script
    //    also judges coverage; missing items come back as new lines that are reviewed in turn.
    const review = async (initial: Cue[], firstRound: number, wholeScript: boolean) => {
      let pending = initial;
      let reviewRound = firstRound;
      let judgeCoverage = wholeScript;
      while (pending.length > 0) {
        const { verdicts, missing } = await reviewLines({
          context,
          model: options.reviewerModel,
          ledgerFile,
          label: `review:${reviewRound}`,
          lines: pending.map((c) => ({
            id: c.id,
            start: c.start,
            end: c.windowEnd,
            text: latest(c).text,
          })),
          approved: active()
            .filter((c) => !pending.includes(c))
            .map((c) => ({ id: c.id, start: c.start, text: latest(c).text })),
          wholeScript: judgeCoverage,
        });
        judgeCoverage = false;
        const failed: { cue: Cue; verdict: Verdict }[] = [];
        for (const [i, cue] of pending.entries()) {
          const verdict = verdicts[i];
          latest(cue).review = verdict;
          await emit({ type: "cue_reviewed", cueId: cue.id, round: reviewRound, verdict });
          if (verdict.pass) cue.status = "approved";
          else failed.push({ cue, verdict });
        }
        if (missing.length > 0) await emit({ type: "coverage", round: reviewRound, missing });
        if (failed.length === 0 && missing.length === 0) return;
        if (reviewRound >= MAX_REVIEW_ROUNDS) {
          for (const { cue } of failed) {
            cue.status = "dropped";
            cue.droppedReason = "review";
            await emit({ type: "cue_dropped", cueId: cue.id, reason: "review" });
          }
          await recomputeWindows();
          return;
        }
        const requests: RevisionRequest[] = failed.map(({ cue, verdict }) => ({
          cue,
          text: latest(cue).text,
          violations: verdict.violations,
          fix: verdict.fix,
          maxUnits: unitBudget(cue.windowEnd - cue.start, options.language),
        }));
        const { revisions, additions } = await reviseLines({
          context,
          model: options.writerModel,
          ledgerFile,
          label: `revise:${reviewRound}`,
          requests,
          otherLines: active()
            .filter((c) => !failed.some((f) => f.cue === c))
            .map((c) => ({ id: c.id, start: c.start, text: latest(c).text })),
          missing,
        });
        pending = [];
        for (const { cue } of failed) {
          const text = revisions.get(cue.id);
          if (!text) throw new Error(`revise returned nothing for ${cue.id}`);
          if (sameWords(text, latest(cue).text)) {
            cue.status = "dropped";
            cue.droppedReason = "unchanged";
            await emit({ type: "cue_dropped", cueId: cue.id, reason: "unchanged" });
            continue;
          }
          cue.versions.push({ text: text.trim(), by: "revise", model: options.writerModel });
          await emit({
            type: "cue_revised",
            cueId: cue.id,
            by: "revise",
            text,
            model: options.writerModel,
          });
          pending.push(cue);
        }
        pending.push(...(await addCues(additions)));
        reviewRound++;
      }
    };
    await stage("review", () => review(active(), 1, true));

    // 5. Voice every approved line; speed up slightly or shorten when the measured audio overruns.
    const lines = new Map<string, TrimmedLine>();
    await stage("voice", async () => {
      const voice = async (cue: Cue, rate: number) => {
        const { wav } = await synthesizeLine({
          text: latest(cue).text,
          language: options.language,
          speakingRate: rate,
          ledgerFile,
          label: "voice",
        });
        return trimSilence(wav);
      };
      let pending = active();
      for (let pass = 0; pending.length > 0; pass++) {
        const tooLong: Cue[] = [];
        await mapLimit(pending, TTS_CONCURRENCY, async (cue) => {
          const room = cue.windowEnd - cue.start;
          let rate = 1;
          let line = await voice(cue, rate);
          if (line.seconds > room && line.seconds / MAX_SPEAKING_RATE <= room) {
            rate = round2(Math.min(MAX_SPEAKING_RATE, (line.seconds / room) * 1.03));
            line = await voice(cue, rate);
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
            await emit({ type: "cue_dropped", cueId: cue.id, reason: "too_long" });
          }
          break;
        }
        const { revisions: shortened } = await reviseLines({
          context,
          model: options.writerModel,
          ledgerFile,
          label: `shorten:${pass + 1}`,
          requests: tooLong.map((cue) => {
            const room = cue.windowEnd - cue.start;
            const maxUnits = unitBudget(room * SHORTEN_TARGET, options.language);
            const spoken = latest(cue).voice?.seconds ?? 0;
            return {
              cue,
              text: latest(cue).text,
              violations: [],
              fix:
                `Spoken, this line takes ${spoken.toFixed(1)} s but has ${room.toFixed(1)} s of room ` +
                `(${spokenUnits(latest(cue).text, options.language)} → at most ${maxUnits}). ` +
                `Cut it, keeping the most important visual information.`,
              maxUnits,
            };
          }),
          otherLines: active()
            .filter((c) => !tooLong.includes(c))
            .map((c) => ({ id: c.id, start: c.start, text: latest(c).text })),
        });
        for (const cue of tooLong) {
          const text = shortened.get(cue.id);
          if (!text) throw new Error(`shorten returned nothing for ${cue.id}`);
          if (sameWords(text, latest(cue).text)) {
            cue.status = "dropped";
            cue.droppedReason = "unchanged";
            await emit({ type: "cue_dropped", cueId: cue.id, reason: "unchanged" });
            continue;
          }
          cue.versions.push({ text: text.trim(), by: "shorten", model: options.writerModel });
          cue.status = "pending";
          await emit({
            type: "cue_revised",
            cueId: cue.id,
            by: "shorten",
            text,
            model: options.writerModel,
          });
        }
        // A shortened line is a new line: it goes back through review before it is voiced.
        await review(
          tooLong.filter((c) => c.status !== "dropped"),
          MAX_REVIEW_ROUNDS,
          false,
        );
        pending = tooLong.filter((c) => c.status === "approved");
      }
    });

    // 6. Mix.
    const shipped = cues.filter((c) => c.status === "fits");
    // Audit exactly what will be heard, once. Findings remain visible; no regeneration loop.
    const finalReview = await stage("verify", () =>
      reviewLines({
        context,
        model: options.reviewerModel,
        ledgerFile,
        label: "review:final",
        wholeScript: true,
        finalOutput: true,
        approved: [],
        lines: shipped.map((c) => ({
          id: c.id,
          start: c.start,
          end: c.start + c.seconds!,
          text: latest(c).text,
        })),
      }),
    );
    const files: RunFiles = {
      described: "described.mp4",
      narration: "narration.wav",
      vtt: "descriptions.vtt",
      script: "script.json",
    };
    await stage("mix", async () => {
      for (const cue of shipped) {
        const line = lines.get(cue.id)!;
        cue.audioFile = `voice/${cue.id}.wav`;
        await writeFile(join(options.runDir, cue.audioFile), encodeWav(line.pcm, line.sampleRate));
      }
      const sampleRate = shipped.length > 0 ? lines.get(shipped[0].id)!.sampleRate : 24000;
      const rawNarration = join(options.runDir, "narration.raw.wav");
      await writeFile(
        rawNarration,
        buildNarrationTrack(
          shipped.map((c) => ({ start: c.start, line: lines.get(c.id)! })),
          options.clipSeconds,
          sampleRate,
        ),
      );
      const spans = shipped.map((c) => ({ start: c.start, end: c.start + (c.seconds ?? 0) }));
      await mixDescribedFilm({
        clipFile: options.clipFile,
        rawNarrationWav: rawNarration,
        spans,
        describedMp4: join(options.runDir, files.described),
        narrationWav: join(options.runDir, files.narration),
      });
      await writeFile(
        join(options.runDir, files.vtt),
        describedVtt(
          shipped.map((c) => ({
            start: c.start,
            end: c.start + (c.seconds ?? 0),
            text: latest(c).text,
          })),
        ),
      );
    });

    // 7. Summary from the ledger and the final cues.
    const calls = await readCallRecords(ledgerFile);
    const costByStage: Record<string, number> = {};
    for (const call of calls) {
      const key = call.label.split(":")[0];
      costByStage[key] = (costByStage[key] ?? 0) + call.costUsd;
    }
    const violationsByRule: Record<string, number> = {};
    let rejected = 0;
    for (const cue of cues) {
      const reviews = cue.versions.map((v) => v.review).filter((r): r is Verdict => Boolean(r));
      if (reviews.some((r) => !r.pass)) rejected++;
      for (const r of reviews)
        for (const v of r.violations)
          violationsByRule[v.rule] = (violationsByRule[v.rule] ?? 0) + 1;
    }
    const spans = shipped.map((c) => ({ start: c.start, end: c.start + (c.seconds ?? 0) }));
    const summary: RunSummary = {
      qualityStatus:
        finalReview.missing.length || finalReview.verdicts.some((v) => !v.pass)
          ? "review_needed"
          : "model_checked",
      finalReview,
      costStatus: summarizeCosts(calls).costStatus,
      analysisReused: { speech: !!options.cached?.speech, scene: !!options.cached?.scene },
      clipSeconds: options.clipSeconds,
      gapCount: gaps.length,
      gapSeconds: round(gaps.reduce((s, g) => s + g.end - g.start, 0)),
      cuesWritten: cues.length,
      cuesShipped: shipped.length,
      cuesDropped: cues.filter((c) => c.status === "dropped").length,
      cuesRejected: rejected,
      violationsByRule,
      cuesFitting: shipped.filter((c) => (c.seconds ?? Infinity) <= c.windowEnd - c.start).length,
      narrationSeconds: round(spans.reduce((s, x) => s + x.end - x.start, 0)),
      overlapWithSpeechSeconds: round(overlapSeconds(spans, speech)),
      costUsd: calls.reduce((s, c) => s + c.costUsd, 0),
      costByStage,
      wallSeconds: round((Date.now() - started) / 1000),
      llmCalls: calls.filter(
        (c) => !c.model.startsWith("text-to-speech") && !c.model.startsWith("speech-to-text"),
      ).length,
    };
    await writeFile(
      join(options.runDir, files.script),
      JSON.stringify({ runId: options.runId, summary, gaps, speech, scene, cues }, null, 2),
    );
    await emit({ type: "run_done", summary, files, cues });
    return { summary, cues };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await emit({
      type: "run_failed",
      error: message,
      ...(error instanceof ProviderError
        ? { retryable: error.retryable, retryAfterSeconds: error.retryAfterSeconds }
        : {}),
    });
    throw error;
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
