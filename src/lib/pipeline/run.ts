import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readCallRecords } from "../llm/ledger";
import type { AnalysisParts } from "../store/analysis";
import { encodeWatchingVideo } from "../media/proxies";
import { ModelOutputError } from "../errors";
import { describeFailure } from "../runs/failure";
import { analyzeClip } from "./analyze";
import type { ClipContext } from "./context";
import { latest, MIN_ROOM_SECONDS, placeCues, sameWords } from "./cues";
import type { RunEvent, RunSummary, StageId, TimedRunEvent } from "./events";
import { mixRun, RUN_FILES, summarizeRun } from "./finish-run";
import { voiceToFit } from "./fit-voice";
import { assessRoom, findGaps } from "./gaps";
import { unitBudget } from "./length";
import { reviewLines } from "./review";
import type { Cue, Density, DraftCue, Language, Verdict } from "./schemas";
import { reviseLines, writeScript, type RevisionRequest } from "./write";

/** Review rounds: one revision chance, then a line that still breaks a rule is dropped. */
const MAX_REVIEW_ROUNDS = 2;

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

function round(value: number): number {
  return Math.round(value * 100) / 100;
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
  const emitStage = (name: StageId, state: "started" | "done", seconds?: number) =>
    emit({ type: "stage", stage: name, state, seconds });
  const stage = async <T>(name: StageId, work: () => Promise<T>): Promise<T> => {
    const t0 = Date.now();
    await emitStage(name, "started");
    const result = await work();
    await emitStage(name, "done", (Date.now() - t0) / 1000);
    return result;
  };

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

    // 1. Hear (with a re-listen of each silence) and watch are independent: run them together.
    const { speech, scene } = await analyzeClip({
      clipFile: options.clipFile,
      clipSeconds: options.clipSeconds,
      filmLanguageCode: options.filmLanguageCode,
      watchModel: options.reviewerModel,
      ledgerFile,
      videoDataUrl: videoDataUrlPromise,
      cached: options.cached,
      onAnalysis: options.onAnalysis,
      stage,
      emit,
    });
    // Saved analyses are keyed by ANALYSIS_VERSION, so a reused one went through the re-listen too.
    await emit({ type: "speech", segments: speech, relistened: true });
    await emit({ type: "scene", map: scene });

    // 2. Gaps: where narration may speak.
    const gaps = await stage("gaps", async () =>
      findGaps({ speech, sounds: scene.sounds }, options.clipSeconds),
    );
    await emit({ type: "gaps", gaps });
    const room = assessRoom(gaps, options.clipSeconds);
    if (room.little)
      await emit({
        type: "little_room",
        gapSeconds: room.gapSeconds,
        thresholdSeconds: room.thresholdSeconds,
        gapCount: gaps.length,
      });

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
          if (!text) throw new ModelOutputError(`revise returned nothing for ${cue.id}`);
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
    const lines = await stage("voice", () =>
      voiceToFit({
        active,
        context,
        language: options.language,
        writerModel: options.writerModel,
        ledgerFile,
        emit,
        reviewShortened: (shortened) => review(shortened, MAX_REVIEW_ROUNDS, false),
      }),
    );

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
    await stage("mix", () =>
      mixRun({
        runDir: options.runDir,
        clipFile: options.clipFile,
        clipSeconds: options.clipSeconds,
        shipped,
        lines,
      }),
    );

    // 7. Summary from the ledger and the final cues.
    const summary = summarizeRun({
      calls: await readCallRecords(ledgerFile),
      cues,
      shipped,
      finalReview,
      analysisReused: { speech: !!options.cached?.speech, scene: !!options.cached?.scene },
      clipSeconds: options.clipSeconds,
      gaps,
      room,
      speech,
      wallSeconds: round((Date.now() - started) / 1000),
    });
    await writeFile(
      join(options.runDir, RUN_FILES.script),
      JSON.stringify({ runId: options.runId, summary, gaps, speech, scene, cues }, null, 2),
    );
    await emit({ type: "run_done", summary, files: RUN_FILES, cues });
    return { summary, cues };
  } catch (error) {
    // The viewer gets a stable code; the details stay in the server log, keyed by the run id.
    const failure = describeFailure(error);
    console.error(`run failed: run=${options.runId} code=${failure.code}`, error);
    await emit({ type: "run_failed", error: failure.code, ...failure });
    throw error;
  }
}
