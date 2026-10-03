import assert from "node:assert/strict";
import { it } from "node:test";
import { copyFile, mkdir, mkdtemp, readdir, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { readCallRecords } from "../src/lib/llm/ledger";
import { runFfmpeg } from "../src/lib/media/ffmpeg";
import { encodeWav } from "../src/lib/media/narration-track";
import { watchingCopyFile, watchingVideoFor } from "../src/lib/media/proxies";
import type { ClipContext } from "../src/lib/pipeline/context";
import type { RunEvent, TimedRunEvent } from "../src/lib/pipeline/events";
import { voiceToFit } from "../src/lib/pipeline/fit-voice";
import { runDescription } from "../src/lib/pipeline/run";
import type { Cue } from "../src/lib/pipeline/schemas";
import { withFetch } from "./with-fetch";

const RATE = 24000;

/**
 * A synthesized take as Chirp 3 HD returns it: 0.3 s of inaudible drift below 60 Hz, then `seconds`
 * of voice, then 0.2 s of drift.
 */
function take(seconds: number): Buffer {
  const drift = (s: number) =>
    Array.from({ length: Math.round(s * RATE) }, (_, i) =>
      Math.round(300 * Math.sin((2 * Math.PI * 10 * i) / RATE)),
    );
  const voice = Array.from({ length: Math.round(seconds * RATE) }, (_, i) =>
    Math.round(8000 * Math.sin(i / 10)),
  );
  return encodeWav(Int16Array.from([...drift(0.3), ...voice, ...drift(0.2)]), RATE);
}

const llm = (data: unknown) =>
  new Response(
    `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100, thoughtsTokenCount: 0, totalTokenCount: 200 } })}\n\n`,
  );

async function blueClip(file: string, seconds: number, color = "blue"): Promise<void> {
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=${color}:s=160x90:r=10:d=${seconds}`,
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-t",
    String(seconds),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    file,
  ]);
}

it("keeps a voiced line when the final check's rewrite fails, and lists only additions that still cover their moment", async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-run-loop-"));
  process.env.DAILY_BUDGET_USD = "5";
  const dir = join(process.env.DATA_DIR, "projects", "loop-test");
  await mkdir(dir, { recursive: true });
  const clipFile = join(dir, "clip.mp4");
  await blueClip(clipFile, 12);

  const SHIPPED = "A blue shape moves.";
  const REWRITE = "The square spins slowly across the whole frame.";
  const ADDED = "A red dot appears in the corner.";
  const ADDED_SHORT = "A red dot.";
  const seconds: Record<string, number> = {
    [SHIPPED]: 1.5,
    "A shape stops.": 1.0,
    [REWRITE]: 8,
    [ADDED]: 3,
    [ADDED_SHORT]: 1,
  };
  const voiced: string[] = [];
  const reviews: {
    level: string;
    final: boolean;
    lines: string[];
    prompt: string;
    system: string;
  }[] = [];
  const shortenPrompts: string[] = [];
  const handler = async (url: string, init?: RequestInit) => {
    if (url.includes("us-speech.googleapis.com"))
      return Response.json({ results: [], metadata: { totalBilledDuration: "12s" } });
    const body = JSON.parse(String(init!.body));
    if (url.includes("texttospeech.googleapis.com")) {
      voiced.push(body.input.text);
      return Response.json({ audioContent: take(seconds[body.input.text]).toString("base64") });
    }
    const properties = body.generationConfig.responseFormat.text.schema.properties;
    const prompt = body.contents[0].parts.at(-1).text as string;
    if (properties.shots)
      return llm({
        shots: [{ start: 0, end: 12, setting: "studio", action: "a shape", onScreenText: "" }],
        characters: [],
        sounds: [],
      });
    if (properties.cues)
      return llm({
        cues: [
          { gapId: "g1", at: 0.2, text: SHIPPED },
          { gapId: "g1", at: 5, text: "A shape stops." },
        ],
      });
    if (properties.revisions) {
      if (prompt.includes("Spoken, this line takes")) {
        shortenPrompts.push(prompt);
        const revisions = [...prompt.matchAll(/- (L\d+) at [^\n]+\n {2}current: ([^\n]+)/g)].map(
          // The writer goes back to the wording the final check rejected, and shortens the addition.
          (m) => ({ cueId: m[1], text: m[2] === REWRITE ? SHIPPED : ADDED_SHORT }),
        );
        return llm({ revisions, additions: [] });
      }
      return llm({
        revisions: [{ cueId: "L1", text: REWRITE }],
        additions: [{ gapId: "g1", at: 9.5, text: ADDED }],
      });
    }
    const final = prompt.includes("FINAL OUTPUT AUDIT");
    const lines = [...prompt.matchAll(/- (L\d+) \[[^\]]+\]: ([^\n]+)/g)];
    reviews.push({
      level: body.generationConfig.thinkingConfig?.thinkingLevel,
      final,
      lines: lines.map((m) => m[1]),
      prompt,
      system: body.systemInstruction.parts[0].text,
    });
    return llm({
      verdicts: lines.map((m) => {
        const fail = final && m[2] === SHIPPED;
        return {
          cueId: m[1],
          pass: !fail,
          violations: fail ? [{ rule: "unseen", quote: SHIPPED, reason: "It is a square." }] : [],
          fix: fail ? `Say "${REWRITE}"` : "",
        };
      }),
      missing: final ? [{ gapId: "g1", at: 9.5, what: "A red dot appears." }] : [],
    });
  };
  const events: TimedRunEvent[] = [];
  const runDir = join(dir, "runs", "loop-run");
  const { summary, cues } = await withFetch(handler, () =>
    runDescription({
      runId: "loop-run",
      runDir,
      clipFile,
      clipSeconds: 12,
      filmLanguageCode: "en-US",
      language: "en",
      density: "standard",
      writerModel: "gemini-3.8-flash",
      reviewerModel: "gemini-3.8-flash",
      emit: (e) => events.push(e),
    }),
  );

  // The rewrite overran even at 1.15×, and its shortening went back to the rejected words: the
  // line ships as it was voiced, with the check's failing verdict listed.
  const l1 = cues.find((c) => c.id === "L1")!;
  assert.equal(l1.status, "fits");
  assert.deepEqual(
    l1.versions.map((v) => [v.by, v.text]),
    [
      ["write", SHIPPED],
      ["revise", REWRITE],
      ["write", SHIPPED],
    ],
  );
  assert.equal(l1.versions.at(-1)!.review?.pass, false);
  assert.ok(Math.abs(l1.seconds! - 1.58) < 0.03, `L1 spoke ${l1.seconds} s`);
  assert.equal(l1.rate, 1);
  assert.equal(l1.droppedReason, undefined);
  const shippedWav = await readFile(join(runDir, "voice", "L1.wav"));
  assert.ok(Math.abs((shippedWav.length - 44) / 2 / RATE - l1.seconds!) < 1e-6);
  assert.deepEqual(
    summary.finalReview!.verdicts.filter((v) => !v.pass).map((v) => v.cueId),
    ["L1"],
  );
  // The shortening was told which wording had already failed, and why.
  assert.match(
    shortenPrompts[0],
    /already tried and failed, do not offer again: "A blue shape moves\." \(unseen: It is a square\.\)/,
  );

  // The addition was shortened before it fit: it is heard, but no longer the words written for
  // the moment, so the moment stays listed and the result reads "notes".
  const l3 = cues.find((c) => c.id === "L3")!;
  assert.equal(l3.status, "fits");
  assert.equal(l3.versions.at(-1)!.text, ADDED_SHORT);
  assert.deepEqual(summary.finalReview!.missing, [
    { gapId: "g1", at: 9.5, what: "A red dot appears." },
  ]);
  assert.deepEqual(summary.finalFix, { failing: 1, missing: 1, rewritten: 0, added: 0, kept: 1 });
  assert.equal(summary.qualityStatus, "review_needed");
  assert.equal(summary.cuesShipped, 3);

  // Thinking: the first pass over the whole script and the final check at high, every re-review
  // of a few rewritten or added lines at medium.
  assert.deepEqual(
    reviews.map((r) => [r.level, r.final, r.lines.join(",")]),
    [
      ["high", false, "L1,L2"],
      ["high", true, "L1,L2"],
      ["medium", false, "L1,L3"],
      ["medium", false, "L3"],
    ],
  );
  // A re-review's lines carry the length their fix must fit; the first pass and the final check,
  // at high, get none (the limits made the first pass think longer; docs/EVALUATION.md).
  assert.match(
    reviews[2].prompt,
    /- L1 \[[^\]]+\]: The square spins [^\n]+\n {2}length limit for a fix: at most \d+ words/,
  );
  assert.ok(reviews.slice(0, 2).every((r) => !r.prompt.includes("length limit")));
  assert.ok(reviews.slice(0, 2).every((r) => !r.system.includes("length limit")));
  assert.match(reviews[2].system, /must fit the line's length limit/);
  // The rejected wording was never reviewed or voiced again.
  assert.equal(voiced.filter((t) => t === SHIPPED).length, 1);

  // The event log holds every event the viewer was sent, ending with the result.
  const logged = (await readFile(join(runDir, "events.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as RunEvent);
  assert.deepEqual(
    logged.map((e) => e.type).sort(),
    events
      .filter((e) => e.type !== "writer_delta")
      .map((e) => e.type)
      .sort(),
  );
  assert.equal(logged.at(-1)!.type, "run_done");
  // The watching copy is kept beside the clip for the next run.
  await readFile(await watchingCopyFile(clipFile));
  assert.ok((await readCallRecords(join(runDir, "ledger.jsonl"))).length > 0);
});

it("reuses the kept watching copy instead of encoding the clip again", async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-run-proxy-"));
  process.env.DAILY_BUDGET_USD = "5";
  const dir = join(process.env.DATA_DIR, "projects", "proxy-test");
  await mkdir(dir, { recursive: true });
  // Not a video: had the run encoded clip.mp4, FFmpeg would have failed on it.
  const clipFile = join(dir, "clip.mp4");
  await writeFile(clipFile, "not a video");
  const marker = Buffer.from("kept watching copy");
  await writeFile(await watchingCopyFile(clipFile), marker);
  let sent = "";
  const handler = async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body));
    sent = body.contents[0].parts[0].inlineData.data;
    const properties = body.generationConfig.responseFormat.text.schema.properties;
    return llm(properties.cues ? { cues: [] } : { verdicts: [], missing: [] });
  };
  const speech = [{ start: 0, end: 10, speaker: "", text: "talk" }];
  const scene = { shots: [], characters: [], sounds: [] };
  // One silence (10.25–12 s) and a writer with nothing to say; the mix of an empty track then
  // fails on the fake clip, after the writer and the final check were sent the watching copy.
  await withFetch(handler, () =>
    assert.rejects(
      runDescription({
        runId: "proxy-run",
        runDir: join(dir, "runs", "proxy-run"),
        clipFile,
        clipSeconds: 12,
        filmLanguageCode: "en-US",
        language: "en",
        density: "standard",
        writerModel: "gemini-3.8-flash",
        reviewerModel: "gemini-3.8-flash",
        cached: { speech, scene },
      }),
    ),
  );
  assert.equal(Buffer.from(sent, "base64").toString(), marker.toString());
});

it("encodes the watching copy again when the clip is replaced in place", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scene-watch-copy-"));
  const clipFile = join(dir, "clip.mp4");
  const red = join(dir, "red.mp4");
  await blueClip(red, 2, "red");
  await blueClip(clipFile, 2);
  const first = await watchingVideoFor(clipFile);
  assert.deepEqual(await watchingVideoFor(clipFile), first);
  // A sample prepared again: clip.mp4 rewritten in place (ingest.ts copies the new clip over it).
  await copyFile(red, clipFile);
  const later = new Date(Date.now() + 60_000);
  await utimes(clipFile, later, later);
  const second = await watchingVideoFor(clipFile);
  assert.notDeepEqual(second, first);
  // Only the copy of the clip now on disk is kept.
  const copies = (await readdir(dir)).filter((name) => name.startsWith("watch-"));
  assert.deepEqual(copies, [basename(await watchingCopyFile(clipFile))]);
});

it("stretches a take a little too long for its room instead of voicing it again", async () => {
  const ledgerFile = join(await mkdtemp(join(tmpdir(), "scene-tempo-")), "ledger.jsonl");
  const cue: Cue = {
    id: "L1",
    gapId: "g1",
    start: 1,
    windowEnd: 5,
    versions: [{ text: "A long line.", by: "write", model: "m" }],
    status: "approved",
  };
  const events: RunEvent[] = [];
  let calls = 0;
  const lines = await withFetch(
    async (url, init) => {
      assert.ok(url.includes("texttospeech.googleapis.com"));
      calls++;
      assert.equal(JSON.parse(String(init!.body)).audioConfig.speakingRate, 1);
      // 4.4 s of voice for 4 s of room: 10% over.
      return Response.json({ audioContent: take(4.4).toString("base64") });
    },
    () =>
      voiceToFit({
        active: () => [cue],
        context: {} as ClipContext,
        language: "en",
        writerModel: "m",
        ledgerFile,
        emit: async (e) => {
          events.push(e);
        },
        reviewShortened: async () => assert.fail("no shortening"),
      }),
  );
  assert.equal(calls, 1);
  assert.equal(cue.status, "fits");
  // rate = round2(min(1.15, 4.48 / 4 × 1.03)) = 1.15
  assert.equal(cue.rate, 1.15);
  assert.ok(cue.seconds! <= 4 && cue.seconds! > 3.8, `stretched to ${cue.seconds} s`);
  assert.equal(lines.get("L1")!.seconds, cue.seconds);
  const voicedEvent = events.find((e) => e.type === "cue_voiced");
  // The take at normal speed: 4.4 s of voice, 0.04 s kept on each side (one more window at the
  // fixture's abrupt end).
  assert.ok(
    voicedEvent?.type === "cue_voiced" &&
      voicedEvent.firstSeconds! >= 4.47 &&
      voicedEvent.firstSeconds! <= 4.5,
    JSON.stringify(voicedEvent),
  );
});
