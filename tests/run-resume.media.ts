import assert from "node:assert/strict";
import { appendFile, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, it } from "node:test";
import { readCallRecords } from "../src/lib/llm/ledger";
import { runFfmpeg } from "../src/lib/media/ffmpeg";
import { encodeWav } from "../src/lib/media/narration-track";
import type { RunSummary, TimedRunEvent } from "../src/lib/pipeline/events";
import { foldRun } from "../src/lib/pipeline/reduce";
import { beginRun, executeAttempt } from "../src/lib/runs/attempt";
import { reserveRun, type BudgetEntry } from "../src/lib/runs/budget";
import { prepareRun } from "../src/lib/runs/start-run";
import { analysisKey, saveAnalysisPart } from "../src/lib/store/analysis";
import { MODELS } from "../src/lib/models";
import { projectDir, writeProject, type Project } from "../src/lib/store/projects";
import { readRunIndex } from "../src/lib/store/run-index";
import { withFetch } from "./with-fetch";

const clipSeconds = 6;
const project: Project = {
  id: "resume-fixture",
  title: "Blue screen",
  kind: "sample",
  clipSeconds,
  filmLanguageCode: "en-US",
  attribution: "",
  license: "",
  createdAt: "2026-11-20T00:00:00Z",
  stripStepSeconds: 1,
};
const savedEnv = new Map<string, string | undefined>();
let dataDir: string;

beforeEach(async () => {
  for (const name of ["DATA_DIR", "DATA_BUCKET", "GAPLINE_FAULT", "DAILY_BUDGET_USD"]) {
    savedEnv.set(name, process.env[name]);
    delete process.env[name];
  }
  dataDir = process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-resume-"));
  process.env.DAILY_BUDGET_USD = "5";
  await writeProject(project);
  await runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=blue:s=160x90:r=10:d=6",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=48000:cl=stereo",
    "-t",
    String(clipSeconds),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    join(projectDir(project.id), "clip.mp4"),
  ]);
  await saveAnalysisPart(project, await analysisKey(project, MODELS.flash), {
    speech: [],
    scene: {
      shots: [{ start: 0, end: 6, setting: "studio", action: "a blue square", onScreenText: "" }],
      sounds: [],
      characters: [],
    },
  });
});
afterEach(async () => {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await rm(dataDir, { recursive: true, force: true });
});

async function launch() {
  const run = await prepareRun({
    projectId: project.id,
    language: "en",
    density: "standard",
    owner: "fixture-owner",
  });
  const reservation = await reserveRun();
  await beginRun(run, reservation);
  return { ...run, reservation };
}

type Run = Awaited<ReturnType<typeof launch>>;
const options = (attempt: number) => ({ execution: "execution-a", attempt, maxRetries: 2 });
const attempt = (run: Run, n: number, emit?: (e: TimedRunEvent) => void) =>
  executeAttempt(project.id, run.runId, { ...options(n), emit });
const events = async (run: Run): Promise<TimedRunEvent[]> =>
  (await readFile(join(run.dir, "events.jsonl"), "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
async function entry(run: Run): Promise<BudgetEntry> {
  const budget = JSON.parse(await readFile(join(dataDir, "budget/demo-v2.json"), "utf8"));
  const entries = budget.entries.filter((e: BudgetEntry) => e.id === run.reservation.id);
  assert.equal(entries.length, 1);
  return entries[0];
}
async function script(run: Run) {
  return JSON.parse(await readFile(join(run.dir, "script.json"), "utf8"));
}

// The same clip, words, review and voice on all attempts; only the selected TTS replies fail.
function provider(failVoices = 0) {
  const calls: string[] = [];
  const voice = encodeWav(
    Int16Array.from({ length: 24000 }, (_, i) => 8000 * Math.sin(i / 10)),
    24000,
  );
  const fetch = async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (url.includes("texttospeech.googleapis.com")) {
      calls.push("voice");
      if (failVoices-- > 0) return new Response("temporarily busy", { status: 503 });
      return Response.json({ audioContent: voice.toString("base64") });
    }
    assert.match(url, /generativelanguage.googleapis.com/);
    const props = body.generationConfig.responseFormat.text.schema.properties;
    const data = props.cues
      ? { cues: [{ gapId: "g1", at: 0.5, text: "A blue square." }] }
      : { verdicts: [{ cueId: "L1", pass: true, fix: "", violations: [] }], missing: [] };
    assert.ok(props.cues || props.verdicts);
    calls.push(
      props.cues
        ? "write"
        : body.contents[0].parts.at(-1).text.includes("FINAL OUTPUT AUDIT")
          ? "final"
          : "review",
    );
    return new Response(
      "data: " +
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: "STOP" },
          ],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100, totalTokenCount: 200 },
        }) +
        "\n\n",
    );
  };
  return { fetch, calls };
}

it("resumes a reviewed script, retaining the baseline output and replaying from a clean view", async () => {
  const p = provider();
  await withFetch(p.fetch, async () => {
    const base = await launch();
    await attempt(base, 0);
    const wanted = await script(base);
    const run = await launch();
    process.env.GAPLINE_FAULT = "exit-after:reviewed";
    await assert.rejects(attempt(run, 0));
    assert.equal((await entry(run)).done, false);
    assert.equal(
      (await events(run)).some((e) => e.type === "run_failed"),
      false,
    );
    // The task started its next stage before disappearing; an open tab already saw this tail.
    const last = (await events(run)).at(-1)!;
    await appendFile(
      join(run.dir, "events.jsonl"),
      JSON.stringify({ type: "stage", stage: "voice", state: "started", t: last.t }) + "\n",
    );
    p.calls.length = 0;
    await attempt(run, 1);
    assert.deepEqual(p.calls, ["voice", "final"]);
    const actual = await script(run);
    assert.deepEqual(actual.cues, wanted.cues);
    const delivery = ({
      wallSeconds: _wall,
      costUsd: _cost,
      costByStage: _costs,
      ...rest
    }: RunSummary) => rest;
    assert.deepEqual(delivery(actual.summary), delivery(wanted.summary));
    const log = await events(run);
    assert.equal(log.filter((e) => e.type === "run_started").length, 2);
    assert.deepEqual(
      foldRun(log, clipSeconds),
      foldRun(log.slice(log.findLastIndex((e) => e.type === "run_started")), clipSeconds),
    );
    assert.equal(log.filter((e) => e.type === "run_done").length, 1);
    const settled = await entry(run);
    assert.equal(settled.done, true);
    assert.ok(Math.abs(settled.cost! - (1.1 + actual.summary.costUsd)) < 1e-9);
  });
});

it("retries two busy TTS responses from the reviewed boundary without rewriting a line", async () => {
  const run = await launch(),
    p = provider(2);
  await withFetch(p.fetch, async () => {
    await assert.rejects(attempt(run, 0));
    assert.deepEqual(p.calls, ["write", "review", "voice", "voice"]);
    assert.equal((await entry(run)).done, false);
    p.calls.length = 0;
    await attempt(run, 1);
    assert.deepEqual(p.calls, ["voice", "final"]);
  });
  assert.equal((await entry(run)).done, true);
  assert.equal((await events(run)).at(-1)?.type, "run_done");
});

it("recovers a failed mix from the fixed boundary without making another paid call", async () => {
  const run = await launch(),
    p = provider();
  await withFetch(p.fetch, async () => {
    await assert.rejects(
      attempt(run, 0, (e) => {
        if (e.type === "stage" && e.stage === "mix" && e.state === "started")
          throw new Error("fixture lost mixer");
      }),
    );
    const recorded = await readCallRecords(join(run.dir, "ledger.jsonl"));
    p.calls.length = 0;
    await attempt(run, 1);
    assert.deepEqual(p.calls, []);
    assert.deepEqual(await readCallRecords(join(run.dir, "ledger.jsonl")), recorded);
    assert.equal((await script(run)).summary.cuesShipped, 1);
  });
});

it("recovers a delivered result by completing its index and accounting", async () => {
  const run = await launch(),
    p = provider();
  await withFetch(p.fetch, async () => {
    // The result and its event have been persisted, but index and settlement have yet to run.
    await attempt(run, 0, (e) => {
      if (e.type === "run_done") throw new Error("fixture stopped after delivery");
    }).catch(() => {});
    const before = await readFile(join(run.dir, "script.json"));
    p.calls.length = 0;
    await attempt(run, 1);
    assert.deepEqual(p.calls, []);
    assert.deepEqual(await readFile(join(run.dir, "script.json")), before);
  });
  const log = await events(run);
  assert.equal(log.filter((e) => e.type === "run_done").length, 1);
  assert.equal(
    log.some((e) => e.type === "run_failed"),
    false,
  );
  assert.ok((await readRunIndex(project.id)).finished[run.runId]);
  assert.equal((await entry(run)).done, true);
});

it("keeps the earlier unlogged-call bound when a resumed task stops just after delivery", async () => {
  const run = await launch();
  const p = provider();
  process.env.GAPLINE_FAULT = "exit-after:reviewed";
  await withFetch(p.fetch, async () => {
    await assert.rejects(attempt(run, 0));
    await attempt(run, 1, (e) => {
      if (e.type === "run_done") throw new Error("fixture stopped after resumed delivery");
    });
  });
  const result = await script(run);
  assert.ok(Math.abs((await entry(run)).cost! - (1.1 + result.summary.costUsd)) < 1e-9);
});

it("refuses a different execution after the first acquired its lease", async () => {
  const run = await launch(),
    p = provider();
  process.env.GAPLINE_FAULT = "exit-after:reviewed";
  await withFetch(p.fetch, async () => {
    await assert.rejects(attempt(run, 0));
    const files = ["events.jsonl", "ledger.jsonl", "job.json"].map((f) => join(run.dir, f));
    const written = () =>
      Promise.all(files.map(async (f) => [(await stat(f)).mtimeMs, await readFile(f, "utf8")]));
    const before = await written();
    p.calls.length = 0;
    await executeAttempt(project.id, run.runId, { ...options(1), execution: "execution-b" }).catch(
      () => {},
    );
    assert.deepEqual(await written(), before);
    assert.deepEqual(p.calls, []);
    assert.equal((await entry(run)).done, false);
  });
});

it("records one terminal failure when no retry remains", async () => {
  const run = await launch(),
    p = provider(2);
  await withFetch(p.fetch, async () => {
    await assert.rejects(executeAttempt(project.id, run.runId, { ...options(0), maxRetries: 0 }));
  });
  assert.equal((await events(run)).filter((e) => e.type === "run_failed").length, 1);
  assert.equal((await entry(run)).done, true);
});

it("settles an expired run without writing more events", async () => {
  const run = await launch(),
    file = join(run.dir, "job.json");
  const job = JSON.parse(await readFile(file, "utf8"));
  job.startedAt = Date.now() - 901_000;
  await writeFile(file, JSON.stringify(job));
  const before = await events(run);
  const p = provider();
  await withFetch(p.fetch, () => attempt(run, 0).catch(() => {}));
  assert.deepEqual(await events(run), before);
  assert.deepEqual(p.calls, []);
  assert.equal((await entry(run)).done, true);
});
