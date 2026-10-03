import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { runFfmpeg } from "../src/lib/media/ffmpeg";
import { reserveRun } from "../src/lib/runs/budget";
import { executeRun, prepareRun } from "../src/lib/runs/start-run";
import { projectDir, runDir, writeProject } from "../src/lib/store/projects";
import { listActiveWork, listRuns, readRunIndex, type RunIndex } from "../src/lib/store/run-index";
import { withFetch } from "./with-fetch";

const A = "a".repeat(64);

it("records a generate run in the index when it starts and when it finishes", async () => {
  const previous = { data: process.env.DATA_DIR, cap: process.env.DAILY_BUDGET_USD };
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-run-index-media-"));
  process.env.DAILY_BUDGET_USD = "5";
  const sample = {
    id: "index-media",
    title: "fixture",
    kind: "sample" as const,
    clipSeconds: 5,
    filmLanguageCode: "en-US",
    attribution: "fixture",
    license: "fixture",
    createdAt: "2026-10-03T00:00:00.000Z",
    stripStepSeconds: 1,
  };
  try {
    await writeProject(sample);
    await mkdir(projectDir(sample.id), { recursive: true });
    await runFfmpeg([
      "-y",
      ...["-f", "lavfi", "-i", "color=c=blue:s=160x90:r=10:d=5"],
      ...["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000"],
      ...["-t", "5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"],
      join(projectDir(sample.id), "clip.mp4"),
    ]);
    const llm = (data: unknown) =>
      new Response(
        `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100, thoughtsTokenCount: 0, totalTokenCount: 200 } })}\n\n`,
      );
    // Speech fills the clip, so there is no silence to write for: hear, watch, mix, done. Every
    // request is answered here; none leaves the machine.
    const handler = async (url: string) => {
      if (url.includes("us-speech.googleapis.com"))
        return Response.json({
          results: [
            {
              alternatives: [
                { words: [{ word: "talking", startOffset: "0.1s", endOffset: "4.9s" }] },
              ],
            },
          ],
          metadata: { totalBilledDuration: "5s" },
        });
      assert.match(url, /generativelanguage\.googleapis\.com/);
      return llm({
        shots: [{ start: 0, end: 5, setting: "studio", action: "a man talks", onScreenText: "" }],
        characters: [],
        sounds: [],
      });
    };
    let whileRunning: Promise<RunIndex> | undefined;
    const prepared = await prepareRun({
      projectId: sample.id,
      language: "en",
      density: "standard",
      owner: A,
    });
    const { runId } = await withFetch(handler, async () =>
      executeRun(prepared, await reserveRun(), (event) => {
        if (event.type === "run_started") whileRunning = readRunIndex(sample.id);
      }),
    );
    const during = await whileRunning!;
    assert.equal(during.active[runId]?.owner, A, "recorded as going when it starts");
    assert.deepEqual(during.active[runId]?.work, {
      kind: "run",
      language: "en",
      density: "standard",
    });

    const index = await readRunIndex(sample.id);
    assert.equal(index.active[runId], undefined);
    const entry = index.finished[runId];
    const written = await stat(join(runDir(sample.id, runId), "script.json"));
    assert.deepEqual(
      { ...entry, summary: entry.summary && { cuesWritten: entry.summary.cuesWritten } },
      {
        runId,
        language: "en",
        density: "standard",
        summary: { cuesWritten: 0 },
        createdAt: written.mtime.toISOString(),
        owner: A,
      },
    );
    assert.deepEqual(
      (await listRuns(sample, A)).map((r) => r.runId),
      [runId],
    );
    assert.deepEqual(await listRuns(sample, undefined), []);
    assert.deepEqual(await listActiveWork(sample.id, A), { active: [], edits: [] });
  } finally {
    await rm(process.env.DATA_DIR!, { recursive: true, force: true });
    for (const [name, value] of [
      ["DATA_DIR", previous.data],
      ["DAILY_BUDGET_USD", previous.cap],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
