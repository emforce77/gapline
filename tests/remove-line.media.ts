import assert from "node:assert/strict";
import { it } from "node:test";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { noteFromScript } from "../src/components/workspace/labels";
import { googleAccessToken } from "../src/lib/google/auth";
import { runFfmpeg } from "../src/lib/media/ffmpeg";
import { encodeWav } from "../src/lib/media/narration-track";
import { parseWav } from "../src/lib/media/wav";
import type { RunSummary, TimedRunEvent } from "../src/lib/pipeline/events";
import type { Cue } from "../src/lib/pipeline/schemas";
import { editRun } from "../src/lib/runs/edit-run";
import { projectDir, runDir, writeProject, type Project } from "../src/lib/store/projects";

const RATE = 24000;
const CLIP_SECONDS = 5;
const OWNER = "fixture-owner";
const TITLE = "A title card reads Mango.";
const MISSING_TITLE = "The title card is not described.";

/** A mono 16-bit tone: each line gets its own pitch, so their WAV bytes differ. */
function tone(seconds: number, period: number): Buffer {
  const pcm = Int16Array.from({ length: Math.round(seconds * RATE) }, (_, i) =>
    Math.round(8000 * Math.sin(i / period)),
  );
  return encodeWav(pcm, RATE);
}

function cue(id: string, gapId: string, start: number, seconds: number, text: string): Cue {
  return {
    id,
    gapId,
    start,
    windowEnd: 0,
    status: "fits",
    audioFile: `voice/${id}.wav`,
    seconds,
    rate: 1,
    versions: [
      {
        text,
        by: "write",
        model: "fixture",
        review: { cueId: id, pass: true, violations: [], fix: "" },
        voice: { seconds, rate: 1 },
      },
    ],
  };
}

async function exists(file: string): Promise<boolean> {
  return access(file).then(
    () => true,
    () => false,
  );
}

it("removes one line: other WAVs reused byte-for-byte, track and audit rebuilt, restorable", async () => {
  const env = { ...process.env };
  const originalFetch = globalThis.fetch;
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-remove-"));
  process.env.OPENROUTER_API_KEY = "fixture";
  process.env.GCP_PROJECT_ID = "fixture";
  delete process.env.DATA_BUCKET;
  process.env.DAILY_BUDGET_USD = "5";
  const counts = { review: 0, tts: 0 };
  const audits: string[] = [];
  globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address.includes("metadata.google")) return Response.json({ access_token: "fixture" });
    if (address.includes("texttospeech.googleapis.com")) {
      counts.tts++;
      return Response.json({ audioContent: tone(0.7, 7).toString("base64") });
    }
    assert.equal(address, "https://openrouter.ai/api/v1/chat/completions");
    counts.review++;
    const body = JSON.parse(options!.body as string);
    const prompt = body.messages[1].content.at(-1).text as string;
    audits.push(prompt);
    const lines = [...prompt.matchAll(/- (L\d+) \[[^\]]+\]: ([^\n]+)/g)];
    const data = {
      verdicts: lines.map((m) => ({ cueId: m[1], pass: true, violations: [], fix: "" })),
      // The fixture reviewer misses the title exactly when no line in the audited track reads it.
      missing: prompt.includes(TITLE) ? [] : [{ gapId: "g1", at: 1.8, what: MISSING_TITLE }],
    };
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(data) }, finish_reason: "stop" }], usage: { cost: 0.002 } })}\n\ndata: [DONE]\n`,
    );
  };
  try {
    process.env.K_SERVICE = "fixture";
    await googleAccessToken();
    delete process.env.K_SERVICE;
    const project: Project = {
      id: "remove-test",
      title: "synthetic fixture",
      kind: "sample",
      clipSeconds: CLIP_SECONDS,
      filmLanguageCode: "en-US",
      attribution: "test",
      license: "CC0",
      createdAt: new Date().toISOString(),
      stripStepSeconds: 1,
    };
    await writeProject(project);
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      `color=c=blue:s=160x90:r=10:d=${CLIP_SECONDS}`,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-t",
      String(CLIP_SECONDS),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      join(projectDir(project.id), "clip.mp4"),
    ]);

    // A finished base result: L1 and L2 share g1, L3 is alone in g2.
    const gaps = [
      { id: "g1", start: 0, end: 3 },
      { id: "g2", start: 3.2, end: 5 },
    ];
    const cues = [
      cue("L1", "g1", 0.2, 0.6, "A blue screen."),
      cue("L2", "g1", 1.8, 0.8, TITLE),
      cue("L3", "g2", 3.5, 0.5, "The screen stays blue."),
    ];
    cues[0].windowEnd = 1.8;
    cues[1].windowEnd = 3;
    cues[2].windowEnd = 5;
    const baseDir = runDir(project.id, "base-run");
    await mkdir(join(baseDir, "voice"), { recursive: true });
    const wavs = { L1: tone(0.6, 5), L2: tone(0.8, 9), L3: tone(0.5, 13) };
    for (const [id, wav] of Object.entries(wavs))
      await writeFile(join(baseDir, `voice/${id}.wav`), wav);
    const summary = {
      clipSeconds: CLIP_SECONDS,
      gapCount: 2,
      gapSeconds: 4.8,
      cuesWritten: 3,
      cuesShipped: 3,
      cuesDropped: 0,
      cuesRejected: 0,
      violationsByRule: {},
      cuesFitting: 3,
      narrationSeconds: 1.9,
      overlapWithSpeechSeconds: 0,
      costUsd: 0.5,
      costByStage: {},
      wallSeconds: 60,
      llmCalls: 4,
    } satisfies RunSummary;
    const scene = {
      shots: [{ start: 0, end: 5, setting: "studio", action: "blue", onScreenText: "MANGO" }],
      characters: [],
      sounds: [],
    };
    const speech = [{ start: 3, end: 3.2, speaker: "man", text: "Hi." }];
    const base = { runId: "base-run", cues, gaps, scene, speech, summary };
    await writeFile(join(baseDir, "script.json"), JSON.stringify(base, null, 2));
    const started: TimedRunEvent = {
      type: "run_started",
      runId: "base-run",
      language: "en",
      density: "standard",
      writerModel: "fixture",
      reviewerModel: "fixture",
      clipSeconds: CLIP_SECONDS,
      t: 0,
    };
    await writeFile(join(baseDir, "events.jsonl"), JSON.stringify(started) + "\n");
    const parentScript = await readFile(join(baseDir, "script.json"));

    // Remove L2.
    const removal = { cueId: "L2", action: "remove" as const, requestId: "remove-l2-0001" };
    const removed = await editRun(project.id, "base-run", removal, OWNER);
    assert.deepEqual(counts, { review: 1, tts: 0 }, "a removal re-audits once and voices nothing");
    const dir = runDir(project.id, removed.runId);
    for (const id of ["L1", "L3"] as const)
      assert.deepEqual(await readFile(join(dir, `voice/${id}.wav`)), wavs[id], `${id}.wav reused`);
    assert.equal(await exists(join(dir, "voice/L2.wav")), false);
    assert.deepEqual(
      await readFile(join(baseDir, "script.json")),
      parentScript,
      "parent untouched",
    );

    const script = JSON.parse(await readFile(join(dir, "script.json"), "utf8"));
    const gone = script.cues.find((c: Cue) => c.id === "L2") as Cue;
    assert.equal(gone.status, "removed");
    assert.deepEqual(
      gone.versions.map((v) => [v.by, v.text]),
      [
        ["write", TITLE],
        ["remove", TITLE],
      ],
    );
    assert.equal(gone.audioFile, undefined);
    assert.equal(gone.seconds, undefined);
    assert.equal(script.cues.find((c: Cue) => c.id === "L1").windowEnd, 3, "L1 gets L2's room");
    assert.equal(script.parentRunId, "base-run");
    assert.deepEqual(
      script.humanEdits.map(({ at, ...rest }: { at: string }) => (assert.ok(at), rest)),
      [{ cueId: "L2", action: "remove", before: TITLE, from: 1.8 }],
    );
    const s: RunSummary = script.summary;
    assert.equal(s.cuesShipped, 2);
    assert.equal(s.cuesRemoved, 1);
    assert.equal(s.cuesDropped, 0);
    assert.equal(s.cuesFitting, 2);
    assert.equal(s.cuesWritten, s.cuesShipped + s.cuesDropped + s.cuesRemoved!);
    assert.ok(Math.abs(s.narrationSeconds - 1.1) < 1e-9);
    assert.equal(s.costUsd, 0.002);
    assert.deepEqual(s.costByStage, { voice: 0, review: 0.002 });
    // The audit saw only the remaining track, and the removed information is now reported missing.
    assert.ok(audits[0].includes("FINAL OUTPUT AUDIT"));
    assert.ok(!audits[0].includes("- L2 ") && !audits[0].includes(TITLE));
    assert.deepEqual(s.finalReview?.missing, [{ gapId: "g1", at: 1.8, what: MISSING_TITLE }]);
    assert.equal(s.qualityStatus, "review_needed");
    const events = (await readFile(join(dir, "events.jsonl"), "utf8")).trim().split("\n");
    const done = JSON.parse(events.at(-1)!);
    assert.equal(done.type, "run_done");
    assert.equal(done.cues.find((c: Cue) => c.id === "L2").status, "removed");

    // The track is rebuilt without the line: no text cue for it, and silence where it spoke.
    const vtt = await readFile(join(dir, "descriptions.vtt"), "utf8");
    assert.ok(vtt.includes("A blue screen.") && !vtt.includes(TITLE));
    const raw = await readFile(join(dir, "narration.raw.wav"));
    const info = parseWav(raw);
    const sampleAt = (second: number) =>
      raw.readInt16LE(info.dataOffset + 2 * Math.round(second * info.sampleRate));
    const peak = (from: number, to: number) => {
      let max = 0;
      for (let t = from; t < to; t += 1 / info.sampleRate)
        max = Math.max(max, Math.abs(sampleAt(t)));
      return max;
    };
    assert.ok(peak(0.3, 0.7) > 1000, "L1 still speaks");
    assert.equal(peak(1.8, 2.6), 0, "L2's span is silent");
    assert.ok(await exists(join(dir, "described.mp4")));
    assert.deepEqual(noteFromScript(script), { line: 2, kind: "removed" });

    // Idempotent: the same request returns the same result without another model call.
    assert.deepEqual(await editRun(project.id, "base-run", removal, OWNER), removed);
    assert.equal(counts.review, 1);
    await assert.rejects(
      editRun(
        project.id,
        "base-run",
        { cueId: "L2", text: "Other words.", start: 1.8, requestId: removal.requestId },
        OWNER,
      ),
      /different edit/,
    );
    await assert.rejects(
      editRun(project.id, removed.runId, { ...removal, requestId: "remove-again-01" }, OWNER),
      /Only a line in the track can be removed/,
    );

    // Restore with its own words: a normal text edit, re-voiced and re-reviewed.
    const restored = await editRun(
      project.id,
      removed.runId,
      { cueId: "L2", text: TITLE, start: 1.8, requestId: "restore-l2-0001" },
      OWNER,
    );
    assert.deepEqual(counts, { review: 2, tts: 1 });
    const back = JSON.parse(
      await readFile(join(runDir(project.id, restored.runId), "script.json"), "utf8"),
    );
    const line = back.cues.find((c: Cue) => c.id === "L2") as Cue;
    assert.equal(line.status, "fits");
    assert.deepEqual(
      line.versions.map((v) => v.by),
      ["write", "remove", "human"],
    );
    assert.equal(back.summary.cuesShipped, 3);
    assert.equal(back.summary.cuesRemoved, 0);
    assert.deepEqual(back.summary.finalReview.missing, []);
    for (const id of ["L1", "L3"] as const)
      assert.deepEqual(
        await readFile(join(runDir(project.id, restored.runId), `voice/${id}.wav`)),
        wavs[id],
      );
    assert.deepEqual(noteFromScript(back), { line: 2, kind: "restored" });
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});
