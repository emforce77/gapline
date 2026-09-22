import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runFfmpeg } from "../src/lib/media/ffmpeg";
import { encodeWav } from "../src/lib/media/narration-track";
import { googleAccessToken } from "../src/lib/google/auth";
import { runDescription } from "../src/lib/pipeline/run";
import { editRun } from "../src/lib/runs/edit-run";
import { analysisKey, readAnalysisParts, saveAnalysisPart } from "../src/lib/store/analysis";
import { projectDir, runDir, writeProject, type Project } from "../src/lib/store/projects";
import type { TimedRunEvent } from "../src/lib/pipeline/events";

it("reuses failed-run analysis, blocks unchanged reapproval, and edits only one WAV idempotently", async () => {
  const env = { ...process.env };
  const originalFetch = globalThis.fetch;
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-workflow-"));
  process.env.OPENROUTER_API_KEY = "fixture";
  process.env.GCP_PROJECT_ID = "fixture";
  delete process.env.DATA_BUCKET;
  process.env.DAILY_BUDGET_USD = "5";
  const scene = {
    shots: [{ start: 0, end: 5, setting: "studio", action: "a shape moves", onScreenText: "" }],
    characters: [],
    sounds: [],
  };
  const counts = { hear: 0, watch: 0, voice: 0 };
  const wav = encodeWav(
    Int16Array.from({ length: 14400 }, (_, i) => Math.round(8000 * Math.sin(i / 10))),
    24000,
  );
  let writerFails = true;
  let longVoice = false;
  globalThis.fetch = async (url, options) => {
    const address = String(url);
    if (address.includes("metadata.google")) return Response.json({ access_token: "fixture" });
    if (address.includes("us-speech.googleapis.com")) {
      counts.hear++;
      return Response.json({ results: [], metadata: { totalBilledDuration: "5s" } });
    }
    if (address.includes("texttospeech.googleapis.com")) {
      counts.voice++;
      return Response.json({
        audioContent: (longVoice
          ? encodeWav(new Int16Array(24000 * 8).fill(2000), 24000)
          : wav
        ).toString("base64"),
      });
    }
    assert.equal(address, "https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(options!.body as string);
    const name = body.response_format.json_schema.name;
    let data: unknown;
    if (name === "scene_map") {
      counts.watch++;
      data = scene;
    } else if (name === "audio_description_script") {
      if (writerFails) return new Response("fixture writer failure", { status: 400 });
      data = {
        cues: [
          { gapId: "g1", at: 0.2, text: "Invented person." },
          { gapId: "g1", at: 1.8, text: "A shape moves." },
          { gapId: "g1", at: 3.5, text: "The shape stops." },
        ],
      };
    } else if (name === "revised_lines")
      data = { revisions: [{ cueId: "L1", text: "Invented person." }], additions: [] };
    else {
      const prompt = body.messages[1].content.at(-1).text as string;
      const lines = [...prompt.matchAll(/- (L\d+) \[[^\]]+\]: ([^\n]+)/g)];
      data = {
        verdicts: lines.map((m) => ({
          cueId: m[1],
          pass: m[2] !== "Invented person.",
          violations:
            m[2] === "Invented person."
              ? [{ rule: "unseen", quote: m[2], reason: "No person is visible." }]
              : [],
          fix: m[2] === "Invented person." ? "Describe the shape." : "",
        })),
        missing: prompt.includes("FINAL OUTPUT AUDIT")
          ? [{ gapId: "g1", at: 0, what: "The title is missing." }]
          : [],
      };
    }
    return new Response(
      `data: ${JSON.stringify({ choices: [{ delta: { content: JSON.stringify(data) }, finish_reason: "stop" }], usage: { cost: 0.001 } })}\n\ndata: [DONE]\n`,
    );
  };
  try {
    process.env.K_SERVICE = "fixture";
    await googleAccessToken();
    delete process.env.K_SERVICE;
    const project: Project = {
      id: "workflow-test",
      title: "synthetic fixture",
      kind: "sample",
      clipSeconds: 5,
      filmLanguageCode: "en-US",
      attribution: "test",
      license: "CC0",
      createdAt: new Date().toISOString(),
      stripStepSeconds: 1,
    };
    await writeProject(project);
    const clipFile = join(projectDir(project.id), "clip.mp4");
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=160x90:r=10:d=5",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=48000:cl=stereo",
      "-t",
      "5",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      clipFile,
    ]);
    const key = await analysisKey(project, "fixture");
    const common = {
      clipFile,
      clipSeconds: 5,
      filmLanguageCode: "en-US",
      language: "en" as const,
      density: "standard" as const,
      writerModel: "fixture",
      reviewerModel: "fixture",
      onAnalysis: (part: Parameters<typeof saveAnalysisPart>[2]) =>
        saveAnalysisPart(project, key, part),
    };
    await assert.rejects(
      runDescription({ ...common, runId: "failed-run", runDir: runDir(project.id, "failed-run") }),
    );
    assert.deepEqual(counts, { hear: 1, watch: 1, voice: 0 });
    const cached = await readAnalysisParts(project, key);
    assert.ok(cached.speech && cached.scene);
    writerFails = false;
    const events: TimedRunEvent[] = [];
    const result = await runDescription({
      ...common,
      cached,
      runId: "base-run",
      runDir: runDir(project.id, "base-run"),
      emit: (e) => events.push(e),
    });
    assert.equal(counts.hear, 1);
    assert.equal(counts.watch, 1);
    assert.equal(result.cues.find((c) => c.id === "L1")!.droppedReason, "unchanged");
    assert.equal(events.filter((e) => e.type === "cue_reviewed" && e.cueId === "L1").length, 1);
    assert.equal(result.summary.qualityStatus, "review_needed");
    const original = await readFile(join(runDir(project.id, "base-run"), "script.json"));
    const untouched = await readFile(join(runDir(project.id, "base-run"), "voice/L3.wav"));
    const beforeVoice = counts.voice;
    const input = {
      cueId: "L2",
      text: "A blue shape moves.",
      start: 2,
      requestId: "request-12345",
    };
    const edited = await editRun(project.id, "base-run", input, "fixture-owner");
    assert.equal(counts.voice, beforeVoice + 1);
    assert.deepEqual(await readFile(join(runDir(project.id, "base-run"), "script.json")), original);
    assert.deepEqual(
      await readFile(join(runDir(project.id, edited.runId), "voice/L3.wav")),
      untouched,
    );
    assert.equal(
      JSON.parse(await readFile(join(runDir(project.id, edited.runId), "script.json"), "utf8"))
        .parentRunId,
      "base-run",
    );
    assert.deepEqual(await editRun(project.id, "base-run", input, "fixture-owner"), edited);
    assert.equal(counts.voice, beforeVoice + 1);
    await assert.rejects(
      editRun(project.id, "base-run", { ...input, text: "Different text." }, "fixture-owner"),
      /different edit/,
    );
    longVoice = true;
    await assert.rejects(
      editRun(project.id, "base-run", { ...input, requestId: "request-too-long" }, "fixture-owner"),
      /only/,
    );
    assert.deepEqual(await readFile(join(runDir(project.id, "base-run"), "script.json")), original);
    longVoice = false;
    const restored = await editRun(
      project.id,
      "base-run",
      { cueId: "L1", text: "A blue shape.", start: 0.2, requestId: "restore-line-123" },
      "fixture-owner",
    );
    const restoredScript = JSON.parse(
      await readFile(join(runDir(project.id, restored.runId), "script.json"), "utf8"),
    );
    assert.equal(restoredScript.summary.cuesShipped, 3);
    assert.equal(restoredScript.summary.cuesDropped, 0);
    assert.equal(restoredScript.cues.find((c: any) => c.id === "L1").status, "fits");
    assert.deepEqual(
      await readFile(join(runDir(project.id, restored.runId), "voice/L3.wav")),
      untouched,
    );
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  }
});
