import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readCallRecords } from "../llm/ledger";
import type { TrimmedLine } from "../media/narration-track";
import type { AnalysisParts } from "../store/analysis";
import { BufferedAppend } from "../store/buffered-append";
import { watchingVideoFor } from "../media/proxies";
import { describeFailure } from "../runs/failure";
import { analyzeClip } from "./analyze";
import type { ClipContext } from "./context";
import {
  latest,
  MIN_ROOM_SECONDS,
  placeCues,
  roomEndBefore,
  roomForMoment,
  triedBefore,
  withFailedWordings,
} from "./cues";
import type { RunEvent, RunSummary, StageId, TimedRunEvent } from "./events";
import { mixRun, RUN_FILES, summarizeRun } from "./finish-run";
import { voiceToFit } from "./fit-voice";
import { assessRoom, findGaps } from "./gaps";
import { unitBudget } from "./length";
import { reviewLines } from "./review";
import type { Cue, CueVersion, Density, DraftCue, Language, MissingItem, Verdict } from "./schemas";
import { reviseLines, writeScript, type RevisionRequest } from "./write";

/**
 * Review rounds: two rewrites, each from the reviewer's own fix, then a line that still breaks a rule
 * is dropped.
 */
const MAX_REVIEW_ROUNDS = 3;

/**
 * Events written to the log before the run goes on (the rest are written in batches, at most a
 * second later): a reader polling the log sees each stage start and the end of the run at once. A
 * stage's end is not among them: the next stage's start or the run's end follows it at once and
 * writes it too, so awaiting both wrote twice within a second (review, 2026-10-03).
 */
function durable(event: RunEvent): boolean {
  return (
    event.type === "run_started" ||
    event.type === "run_done" ||
    event.type === "run_failed" ||
    (event.type === "stage" && event.state === "started")
  );
}

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

  const log = new BufferedAppend(eventsFile);
  const emit = async (event: RunEvent) => {
    const timed = { ...event, t: round((Date.now() - started) / 1000) } as TimedRunEvent;
    if (event.type !== "writer_delta") log.add(`${JSON.stringify(timed)}\n`);
    if (durable(event)) await log.flush();
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
    // The small watching copy is needed by watch, write and review: kept beside the clip, encoded
    // in the background when this is the clip's first run.
    const videoDataUrlPromise = watchingVideoFor(options.clipFile).then(
      (video) => `data:video/mp4;base64,${video.toString("base64")}`,
    );
    // Its failure is raised where it is awaited; this only keeps it from counting as unhandled
    // while hearing runs, or in a run with no silence, which never needs it.
    videoDataUrlPromise.catch(() => {});

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

    // 7–8, also for a run that stops before writing: mix, summary, script.json, the final event.
    const finish = async (
      cues: Cue[],
      lines: Map<string, TrimmedLine>,
      finalReview?: NonNullable<RunSummary["finalReview"]>,
      finalFix?: RunSummary["finalFix"],
    ) => {
      // 7. Mix.
      const shipped = cues.filter((c) => c.status === "fits");
      await stage("mix", () =>
        mixRun({
          runDir: options.runDir,
          clipFile: options.clipFile,
          clipSeconds: options.clipSeconds,
          shipped,
          lines,
          language: options.language,
        }),
      );

      // 8. Summary from the ledger and the final cues.
      const summary = summarizeRun({
        calls: await readCallRecords(ledgerFile),
        cues,
        shipped,
        finalReview,
        finalFix,
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
    };

    // No silence anywhere: no line can be placed, so nothing is written, reviewed or checked. The
    // mix still runs, so the film, an empty narration track and captions can be downloaded; the
    // little-room notice says why there are no lines, and the result carries no final-check badge.
    if (gaps.length === 0) return await finish([], new Map());

    // 3. Write. On a clip's first run the watching copy may still be encoding: that wait is part of
    //    writing, so the stage list shows it.
    let context!: ClipContext;
    const drafts = await stage("write", async () => {
      context = {
        language: options.language,
        density: options.density,
        clipSeconds: options.clipSeconds,
        speech,
        scene,
        gaps,
        videoDataUrl: await videoDataUrlPromise,
      };
      return writeScript({
        context,
        model: options.writerModel,
        ledgerFile,
        onDelta: (text) =>
          options.emit?.({ type: "writer_delta", text, t: round((Date.now() - started) / 1000) }),
      });
    });
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
    // A voiced line the fix stage is rewriting keeps its room even while its rewrite is dropped,
    // since it goes back to its voiced words then (see the fix stage).
    let cueCount = cues.length;
    const holdingRoom = new Set<Cue>();
    const recomputeWindows = async () => {
      for (const gap of gaps) {
        const inGap = cues
          .filter((c) => c.status !== "dropped" || holdingRoom.has(c))
          .filter((c) => c.gapId === gap.id)
          .sort((a, b) => a.start - b.start);
        for (const [i, cue] of inGap.entries()) {
          // The same room placeCues gives: up to LINE_SPACING_SECONDS before the next line.
          const windowEnd = roomEndBefore(cue.start, inGap[i + 1]?.start, gap.end);
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

    // A rewrite request names the wordings this line already failed with, so the writer does not
    // offer one of them again (rewrites kept returning to them; see triedBefore).
    const rewriteRequest = (cue: Cue, verdict: Verdict): RevisionRequest => ({
      cue,
      text: latest(cue).text,
      violations: verdict.violations,
      fix: withFailedWordings(cue, verdict.fix),
      maxUnits: unitBudget(cue.windowEnd - cue.start, options.language),
    });

    // 4. Review until every line passes or runs out of rounds. The first pass over the whole script
    //    also judges coverage; missing items come back as new lines that are reviewed in turn. Later
    //    rounds look again at a few rewritten, added or shortened lines, at a lower thinking level;
    //    the final check below sees every voiced line at the full level.
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
            // A re-review's fix names a wording that fits. The first pass, at the higher thinking
            // level, gets no limits: in a replay they made it think about 13% longer (see reviewLines).
            ...(judgeCoverage
              ? {}
              : { maxUnits: unitBudget(c.windowEnd - c.start, options.language) }),
          })),
          approved: active()
            .filter((c) => !pending.includes(c))
            .map((c) => ({ id: c.id, start: c.start, text: latest(c).text })),
          wholeScript: judgeCoverage,
          stage: judgeCoverage ? "review" : "rereview",
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
        const requests = failed.map(({ cue, verdict }) => rewriteRequest(cue, verdict));
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
          // A rewrite the writer left out, or one this line already had, counts as no rewrite: the
          // line goes, the run carries on.
          if (!text) console.warn(`revise returned nothing for ${cue.id}; dropping it`);
          if (!text || triedBefore(cue, text)) {
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
        reviewShortened: (shortened) => review(shortened, MAX_REVIEW_ROUNDS - 1, false),
      }),
    );

    // 6. Audit exactly what will be heard, once. What the audit finds is fixed without asking anyone:
    //    a failing line is rewritten from its fix, and a missing moment gets a new line where its gap
    //    still has free room. Both are reviewed and voiced like any other line. The track is not
    //    audited a second time: on the sample that took over three minutes and only listed new items it
    //    could no longer act on. The audit's findings are brought up to date with the fixes instead, so
    //    what still stands (a fix that failed, a moment with no free room) stays in the summary.
    let finalReview = await stage("verify", () =>
      reviewLines({
        context,
        model: options.reviewerModel,
        ledgerFile,
        label: "review:final",
        wholeScript: true,
        finalOutput: true,
        approved: [],
        lines: cues
          .filter((c) => c.status === "fits")
          .map((c) => ({
            id: c.id,
            start: c.start,
            end: c.start + c.seconds!,
            text: latest(c).text,
          })),
      }),
    );
    const failing = finalReview.verdicts
      .filter((v) => !v.pass)
      .map((verdict) => ({ cue: cues.find((c) => c.id === verdict.cueId)!, verdict }));
    // A failing line keeps its whole window: its rewrite may speak longer than it does now.
    const taken = cues
      .filter((c) => c.status === "fits")
      .map((c) => ({
        start: c.start,
        end: failing.some((f) => f.cue === c) ? c.windowEnd : c.start + c.seconds!,
      }));
    const addable: (MissingItem & { end: number })[] = [];
    for (const item of finalReview.missing) {
      const free = roomForMoment(item, gaps, taken);
      // One new line per stretch of free room: the first item found there claims it.
      if (free && !addable.some((a) => a.gapId === item.gapId && a.end === free.end))
        addable.push({ ...item, at: free.start, end: free.end });
    }
    let finalFix: RunSummary["finalFix"];
    if (failing.length > 0 || addable.length > 0) {
      finalReview = await stage("fix", async () => {
        const { revisions, additions } = await reviseLines({
          context,
          model: options.writerModel,
          ledgerFile,
          label: "revise:final",
          requests: failing.map(({ cue, verdict }) => rewriteRequest(cue, verdict)),
          otherLines: active()
            .filter((c) => !failing.some((f) => f.cue === c))
            .map((c) => ({ id: c.id, start: c.start, text: latest(c).text })),
          missing: addable.map((a) => ({ gapId: a.gapId, at: a.at, what: a.what })),
        });
        // What each rewritten line was when it was voiced and checked, to go back to.
        const voicedAs = new Map<
          string,
          { version: CueVersion; line: TrimmedLine; seconds: number; rate: number }
        >();
        const changed: Cue[] = [];
        for (const { cue, verdict } of failing) {
          const text = revisions.get(cue.id);
          // The check's verdict becomes the voiced version's review, so its history shows why.
          latest(cue).review = verdict;
          await emit({ type: "cue_reviewed", cueId: cue.id, round: 0, verdict });
          // Left out by the writer, or a wording the line already had: it stays as voiced, and its
          // failing verdict stays listed.
          if (!text) console.warn(`final fix returned nothing for ${cue.id}; keeping it as it was`);
          if (!text || triedBefore(cue, text)) continue;
          voicedAs.set(cue.id, {
            version: structuredClone(latest(cue)),
            line: lines.get(cue.id)!,
            seconds: cue.seconds!,
            rate: cue.rate!,
          });
          cue.versions.push({ text: text.trim(), by: "revise", model: options.writerModel });
          cue.status = "pending";
          await emit({
            type: "cue_revised",
            cueId: cue.id,
            by: "revise",
            text,
            model: options.writerModel,
          });
          changed.push(cue);
          holdingRoom.add(cue);
        }
        // Each new line goes into the free room of its item, nearest first, and stays inside it.
        const used = new Set<(typeof addable)[number]>();
        const placed: DraftCue[] = [];
        for (const draft of additions) {
          const open = addable.filter((a) => a.gapId === draft.gapId && !used.has(a));
          const room =
            open.find((a) => draft.at >= a.at && draft.at < a.end) ??
            open.sort((a, b) => Math.abs(a.at - draft.at) - Math.abs(b.at - draft.at))[0];
          if (!room) continue;
          used.add(room);
          placed.push({
            ...draft,
            at: Math.min(Math.max(draft.at, room.at), room.end - MIN_ROOM_SECONDS),
          });
        }
        const added = await addCues(placed);
        const fixes = [...changed, ...added];
        await review(fixes, MAX_REVIEW_ROUNDS - 1, false);
        const voiced = await voiceToFit({
          active,
          pending: fixes.filter((c) => c.status === "approved"),
          context,
          language: options.language,
          writerModel: options.writerModel,
          ledgerFile,
          emit,
          reviewShortened: (shortened) => review(shortened, MAX_REVIEW_ROUNDS - 1, false),
        });
        for (const [id, line] of voiced) lines.set(id, line);
        // A rewrite that did not make it (rejected, too long, or back to an earlier wording) never
        // costs the line: it goes back to the words that were voiced and fit, with the check's
        // verdict, which stays listed. Its free room was reserved above, so nothing overlaps it.
        const kept = new Set<string>();
        for (const cue of changed) {
          if (cue.status === "fits") continue;
          const before = voicedAs.get(cue.id)!;
          cue.versions.push(structuredClone(before.version));
          cue.status = "fits";
          cue.seconds = before.seconds;
          cue.rate = before.rate;
          delete cue.droppedReason;
          lines.set(cue.id, before.line);
          kept.add(cue.id);
          await emit({
            type: "cue_revised",
            cueId: cue.id,
            by: before.version.by,
            text: before.version.text,
            model: before.version.model,
          });
          await emit({
            type: "cue_reviewed",
            cueId: cue.id,
            round: 0,
            verdict: before.version.review!,
          });
          await emit({
            type: "cue_voiced",
            cueId: cue.id,
            seconds: round(before.seconds),
            rate: before.rate,
            window: round(cue.windowEnd - cue.start),
            fits: true,
          });
        }
        holdingRoom.clear();
        // A missing moment counts as covered only by a line that still has the words written for
        // it: a shortened or rewritten addition may no longer say what the check asked for.
        const covering = added.filter((c) => c.status === "fits" && latest(c).by === "add");
        const filled = (item: MissingItem) =>
          addable.some(
            (a) =>
              a.gapId === item.gapId &&
              a.what === item.what &&
              covering.some((c) => c.start >= a.at && c.start < a.end),
          );
        const rewritten = changed.filter((c) => c.status === "fits" && !kept.has(c.id));
        finalFix = {
          failing: failing.length,
          missing: finalReview.missing.length,
          rewritten: rewritten.length,
          added: covering.length,
          kept: failing.length - rewritten.length,
        };
        return {
          verdicts: [
            ...finalReview.verdicts.map((v) => {
              const cue = rewritten.find((c) => c.id === v.cueId);
              return cue ? { ...latest(cue).review!, cueId: cue.id } : v;
            }),
            ...added
              .filter((c) => c.status === "fits")
              .map((c) => ({ ...latest(c).review!, cueId: c.id })),
          ],
          missing: finalReview.missing.filter((m) => !filled(m)),
        };
      });
    }

    return await finish(cues, lines, finalReview, finalFix);
  } catch (error) {
    // The viewer gets a stable code; the details stay in the server log, keyed by the run id.
    const failure = describeFailure(error);
    console.error(`run failed: run=${options.runId} code=${failure.code}`, error);
    // Lines a refused write left queued go out with this one, in order. If storage refuses this
    // write too, the run's own error is the one raised (the stream route then sends run_failed).
    await emit({ type: "run_failed", error: failure.code, ...failure }).catch((logError: unknown) =>
      console.error(`run_failed not logged: run=${options.runId}`, logError),
    );
    throw error;
  }
}
