import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { RUN_TIME_LIMIT_SECONDS } from "../src/lib/api-contract";
import { reserveRun } from "../src/lib/runs/budget";
import { executeRun, prepareRun } from "../src/lib/runs/start-run";
import {
  projectDir,
  RUN_EDITOR_FILE,
  RUN_OWNER_FILE,
  runDir,
  writeProject,
  type Project,
} from "../src/lib/store/projects";
import {
  indexRunEnded,
  indexRunStarted,
  listActiveWork,
  listRuns,
  listRunsAndWork,
  readRunIndex,
  runIndexKey,
} from "../src/lib/store/run-index";

const A = "a".repeat(64);
const B = "b".repeat(64);

function project(id: string, kind: Project["kind"]): Project {
  return {
    id,
    title: id,
    kind,
    clipSeconds: 10,
    filmLanguageCode: "en-US",
    attribution: "fixture",
    license: "fixture",
    createdAt: "2026-10-03T00:00:00.000Z",
    stripStepSeconds: 1,
  };
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
const ids = (runs: { runId: string }[]) => runs.map((r) => r.runId).sort();

/**
 * A run's files as the web writes them: owner.json (a generate run) or editor.json (an edit) when
 * someone made it, its events, and for a finished run its script, dated `minute` minutes into
 * 2026-10-03 (the listing's createdAt).
 */
async function writeRunFiles(
  projectId: string,
  runId: string,
  options: {
    owner?: string;
    edit?: boolean;
    startedAt?: string;
    end: "done" | "failed" | "none";
    minute?: number;
  },
): Promise<void> {
  const dir = runDir(projectId, runId);
  await mkdir(dir, { recursive: true });
  const startedAt = options.startedAt ?? minutesAgo(1);
  if (options.owner && options.edit)
    await writeFile(
      join(dir, RUN_EDITOR_FILE),
      JSON.stringify({
        ownerHash: options.owner,
        startedAt,
        baseRunId: "base-run",
        cueId: "L1",
        action: "remove",
        language: "en",
        density: "standard",
      }),
    );
  else if (options.owner)
    await writeFile(
      join(dir, RUN_OWNER_FILE),
      JSON.stringify({ ownerHash: options.owner, startedAt, language: "ko", density: "brief" }),
    );
  const events: object[] = [
    { type: "run_started", runId, language: options.edit ? "en" : "ko", density: "brief", t: 0 },
  ];
  if (options.end === "failed") events.push({ type: "run_failed", error: "internal", t: 2 });
  if (options.end === "done") {
    const script = {
      runId,
      cues: [],
      summary: { cuesShipped: 3 },
      ...(options.edit ? { humanEdits: [{ cueId: "L1", action: "remove" }] } : {}),
    };
    await writeFile(join(dir, "script.json"), JSON.stringify(script));
    const at = new Date(Date.UTC(2026, 9, 3, 0, options.minute ?? 0));
    await utimes(join(dir, "script.json"), at, at);
    events.push({ type: "run_done", t: 3 });
  }
  await writeFile(join(dir, "events.jsonl"), events.map((e) => `${JSON.stringify(e)}\n`).join(""));
}

describe("the run index", () => {
  let dir: string;
  const previous = { data: process.env.DATA_DIR, ffmpeg: process.env.FFMPEG_PATH };
  const SAMPLE = project("index-sample", "sample");
  const UPLOAD = project("u-index-upload", "upload");

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "scene-run-index-"));
    process.env.DATA_DIR = dir;
    for (const p of [SAMPLE, UPLOAD, project("index-rebuild", "sample")]) await writeProject(p);
  });

  after(async () => {
    for (const [name, value] of [
      ["DATA_DIR", previous.data],
      ["FFMPEG_PATH", previous.ffmpeg],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it("records a generate run and an edit when they finish, with the listing a read of their files gives", async () => {
    const run = "20261003t000100000-ko-brief-aaaaaa";
    const edit = `edit-${"1".repeat(40)}`;
    const startedAt = minutesAgo(2);
    await indexRunStarted(SAMPLE.id, run, {
      owner: A,
      startedAt,
      work: { kind: "run", language: "ko", density: "brief" },
    });
    await indexRunStarted(SAMPLE.id, edit, {
      owner: A,
      startedAt,
      work: {
        kind: "edit",
        baseRunId: "base-run",
        cueId: "L1",
        action: "remove",
        language: "en",
        density: "standard",
      },
    });
    assert.deepEqual(
      Object.keys((await readRunIndex(SAMPLE.id)).active).sort(),
      [run, edit].sort(),
    );
    await writeRunFiles(SAMPLE.id, run, { owner: A, startedAt, end: "done", minute: 1 });
    await writeRunFiles(SAMPLE.id, edit, {
      owner: A,
      edit: true,
      startedAt,
      end: "done",
      minute: 2,
    });
    await indexRunEnded(SAMPLE.id, run, false);
    await indexRunEnded(SAMPLE.id, edit, false);

    const index = await readRunIndex(SAMPLE.id);
    assert.deepEqual(index.active, {});
    assert.deepEqual(index.ended, []);
    assert.deepEqual(index.finished[run], {
      runId: run,
      language: "ko",
      density: "brief",
      summary: { cuesShipped: 3 },
      createdAt: "2026-10-03T00:01:00.000Z",
      owner: A,
    });
    assert.deepEqual(index.finished[edit], {
      runId: edit,
      language: "en",
      density: "brief",
      summary: { cuesShipped: 3 },
      createdAt: "2026-10-03T00:02:00.000Z",
      lastEdit: { cueId: "L1", action: "remove" },
      owner: A,
    });
    // The maker sees both, newest first; on the shared sample nobody else does.
    assert.deepEqual(
      (await listRuns(SAMPLE, A)).map((r) => r.runId),
      [edit, run],
    );
    assert.deepEqual(await listRuns(SAMPLE, B), []);
    assert.deepEqual(await listRuns(SAMPLE, undefined), []);
    // The index file sits beside the runs, never inside them, and is never a run itself.
    await stat(join(projectDir(SAMPLE.id), "runs-index.json"));
    assert.equal(runIndexKey(SAMPLE.id), `projects/${SAMPLE.id}/runs-index.json`);
  });

  it("keeps every entry when runs start and finish at the same time", async () => {
    const runs = Array.from(
      { length: 12 },
      (_, i) => `20261003t0002${String(i).padStart(2, "0")}000-ko-brief-bbbbbb`,
    );
    await Promise.all(
      runs.map((runId) => writeRunFiles(UPLOAD.id, runId, { owner: A, end: "done", minute: 3 })),
    );
    const starting = Array.from({ length: 6 }, (_, i) => `edit-${String(i).repeat(40)}`);
    await Promise.all([
      ...runs.map((runId) => indexRunEnded(UPLOAD.id, runId, false)),
      ...starting.map((runId) =>
        indexRunStarted(UPLOAD.id, runId, {
          owner: B,
          startedAt: minutesAgo(1),
          work: { kind: "run", language: "en", density: "standard" },
        }),
      ),
    ]);
    const index = await readRunIndex(UPLOAD.id);
    assert.deepEqual(Object.keys(index.finished).sort(), [...runs].sort());
    assert.deepEqual(Object.keys(index.active).sort(), [...starting].sort());
    // On an upload, its owner sees every run.
    assert.deepEqual(ids(await listRuns(UPLOAD, A)), [...runs].sort());
  });

  it("builds a missing index from the runs folder once; listings then read the index, not the runs", async () => {
    const REBUILD = project("index-rebuild", "sample");
    const curated = [
      "20260921t000000000-en-standard-cccccc",
      "20260921t000100000-ko-standard-cccccc",
    ];
    const mine = "20261003t000300000-ko-brief-dddddd";
    const failed = "20261003t000400000-ko-brief-eeeeee";
    const interrupted = "20261003t000500000-ko-brief-ffffff";
    const oldEdit = `edit-${"2".repeat(40)}`;
    for (const [i, runId] of curated.entries())
      await writeRunFiles(REBUILD.id, runId, { end: "done", minute: 10 + i });
    await writeRunFiles(REBUILD.id, mine, { owner: A, end: "done", minute: 12 });
    await writeRunFiles(REBUILD.id, failed, { owner: B, end: "failed" });
    await writeRunFiles(REBUILD.id, interrupted, {
      owner: B,
      startedAt: minutesAgo(RUN_TIME_LIMIT_SECONDS / 60 + 5),
      end: "none",
    });
    // An edit from before 2026-10-03 that stopped early: only its maker, no start time, no event.
    await mkdir(runDir(REBUILD.id, oldEdit), { recursive: true });
    const marker = join(runDir(REBUILD.id, oldEdit), RUN_EDITOR_FILE);
    await writeFile(marker, JSON.stringify({ ownerHash: B }));
    const longAgo = new Date(Date.now() - (RUN_TIME_LIMIT_SECONDS + 60) * 1000);
    await utimes(marker, longAgo, longAgo);
    // Not runs: other names in the folder.
    await writeFile(join(projectDir(REBUILD.id), "runs", "notes.txt"), "");

    assert.deepEqual(ids(await listRuns(REBUILD, undefined)), [...curated].sort());
    const built = await readRunIndex(REBUILD.id);
    assert.deepEqual(Object.keys(built.finished).sort(), [...curated, mine].sort());
    assert.deepEqual([...built.ended].sort(), [failed, interrupted].sort());
    // Without any event it may be a copy still under way: ended only if it stays so (see below).
    assert.deepEqual(Object.keys(built.stalled), [oldEdit]);
    assert.equal(built.finished[mine].owner, A);
    assert.equal(built.finished[curated[0]].owner, null);

    // Every run's events are now unreadable; a listing that read any of them would fail.
    for (const runId of [...curated, mine, failed, interrupted])
      await writeFile(join(runDir(REBUILD.id, runId), "events.jsonl"), "{broken\n{broken\n");
    const listed = await listRuns(REBUILD, A);
    assert.deepEqual(
      listed.map((r) => r.runId),
      [mine, curated[1], curated[0]],
    );
    assert.deepEqual(ids(await listRuns(REBUILD, B)), [...curated].sort());
    assert.deepEqual(await listActiveWork(REBUILD.id, B), { active: [], edits: [] });

    // A run on disk the index lacks (its end never recorded) is read once and added.
    const late = `edit-${"3".repeat(40)}`;
    await writeRunFiles(REBUILD.id, late, { owner: B, edit: true, end: "done", minute: 13 });
    assert.deepEqual(
      (await listRuns(REBUILD, B)).map((r) => r.runId),
      [late, curated[1], curated[0]],
    );
    assert.equal((await readRunIndex(REBUILD.id)).finished[late].owner, B);
    assert.ok(!ids(await listRuns(REBUILD, A)).includes(late));
    assert.ok(!ids(await listRuns(REBUILD, undefined)).includes(late));

    // An index from another version is built again rather than trusted.
    await writeFile(join(dir, runIndexKey(REBUILD.id)), JSON.stringify({ version: 0, runs: [] }));
    await writeFile(
      join(runDir(REBUILD.id, mine), "events.jsonl"),
      `${JSON.stringify({ type: "run_started", runId: mine, language: "ko", density: "brief", t: 0 })}\n{"type":"run_done","t":3}\n`,
    );
    for (const runId of [...curated, late])
      await writeFile(
        join(runDir(REBUILD.id, runId), "events.jsonl"),
        `${JSON.stringify({ type: "run_started", runId, language: "en", density: "standard", t: 0 })}\n{"type":"run_done","t":3}\n`,
      );
    await writeFile(
      join(runDir(REBUILD.id, failed), "events.jsonl"),
      '{"type":"run_failed","error":"internal","t":2}\n',
    );
    await writeFile(join(runDir(REBUILD.id, interrupted), "events.jsonl"), "");
    assert.deepEqual(ids(await listRuns(REBUILD, A)), [...curated, mine].sort());
    const rebuilt = JSON.parse(await readFile(join(dir, runIndexKey(REBUILD.id)), "utf8"));
    assert.equal(rebuilt.version, 1);
    assert.deepEqual(Object.keys(rebuilt.finished).sort(), [...curated, mine, late].sort());
  });

  it("lists a run copied in once its files are all there, however much of it a listing caught", async () => {
    // `gcloud storage cp -r` (DEPLOY.md §7, or a restore) writes a run's files one by one, with or
    // without their old dates. Whatever a listing sees halfway must not hide the run for good.
    const COPY = project("index-copy", "sample");
    await writeProject(COPY);
    const old = new Date("2026-09-28T07:00:00Z");
    const copied = {
      voiceOnly: "20260928t064307205-en-standard-aaaaaa",
      scriptOnly: "20260928t064307205-en-standard-bbbbbb",
      doneNoScript: "20260928t064307205-en-standard-cccccc",
      scriptOnlyEdit: `edit-${"5".repeat(40)}`,
    };
    const restored = "20260929t000000000-en-standard-dddddd";
    const restoredStart = "2026-09-29T00:00:00.000Z";
    const ledgerOnly = `edit-${"6".repeat(40)}`;
    const died = `edit-${"7".repeat(40)}`;
    const settingUp = `edit-${"8".repeat(40)}`;
    const dirOf = (runId: string) => runDir(COPY.id, runId);
    for (const runId of [...Object.values(copied), restored, ledgerOnly, died, settingUp])
      await mkdir(join(dirOf(runId), "voice"), { recursive: true });
    await writeFile(join(dirOf(copied.voiceOnly), "voice", "L1.wav"), "");
    for (const runId of [copied.scriptOnly, copied.scriptOnlyEdit])
      await writeFile(join(dirOf(runId), "script.json"), JSON.stringify({ summary: null }));
    await writeFile(
      join(dirOf(copied.doneNoScript), "events.jsonl"),
      `${JSON.stringify({ type: "run_started", language: "en", density: "standard", t: 0 })}\n{"type":"run_done","t":3}\n`,
    );
    await utimes(join(dirOf(copied.doneNoScript), "events.jsonl"), old, old);
    // A restored visitor run: its owner file has landed, nothing else yet.
    await writeFile(
      join(dirOf(restored), RUN_OWNER_FILE),
      JSON.stringify({
        ownerHash: B,
        startedAt: restoredStart,
        language: "ko",
        density: "brief",
      }),
    );
    // Never to finish: an older edit with only its ledger, and an edit that died before its events.
    await writeFile(join(dirOf(ledgerOnly), "ledger.jsonl"), "");
    await writeFile(
      join(dirOf(died), RUN_EDITOR_FILE),
      JSON.stringify({
        ownerHash: A,
        startedAt: minutesAgo(RUN_TIME_LIMIT_SECONDS / 60 + 5),
        baseRunId: "base-run",
        cueId: "L1",
        action: "remove",
        language: "en",
        density: "standard",
      }),
    );

    assert.deepEqual(await listRuns(COPY, undefined), []);
    assert.deepEqual(await listRunsAndWork(COPY, B), { runs: [], active: [], edits: [] });
    let index = await readRunIndex(COPY.id);
    assert.deepEqual(index.ended, []);
    const stalledAll = [...Object.values(copied), restored, ledgerOnly, died, settingUp];
    assert.deepEqual(Object.keys(index.stalled).sort(), [...stalledAll].sort());

    // The copy completes; an edit starts in the folder a listing caught before its marker.
    for (const runId of Object.values(copied))
      await writeRunFiles(COPY.id, runId, { end: "done", minute: 30 });
    await writeRunFiles(COPY.id, restored, { owner: B, startedAt: restoredStart, end: "done" });
    const startedAt = minutesAgo(1);
    await writeRunFiles(COPY.id, settingUp, { owner: A, edit: true, startedAt, end: "none" });

    const curated = Object.values(copied).sort();
    assert.deepEqual(ids(await listRuns(COPY, undefined)), curated);
    assert.deepEqual(ids(await listRuns(COPY, B)), [...curated, restored].sort());
    assert.deepEqual(
      (await listActiveWork(COPY.id, A)).edits.map((e) => e.runId),
      [settingUp],
    );
    index = await readRunIndex(COPY.id);
    assert.deepEqual(Object.keys(index.stalled).sort(), [ledgerOnly, died].sort());
    assert.deepEqual(index.ended, []);

    // What still lacks its files a whole run time limit after it was first seen so has ended.
    await writeRunFiles(COPY.id, settingUp, { owner: A, edit: true, startedAt, end: "done" });
    const limit = RUN_TIME_LIMIT_SECONDS * 1000;
    const since = Date.parse(index.stalled[ledgerOnly]);
    await listRunsAndWork(COPY, A, since + limit - 60_000);
    assert.deepEqual((await readRunIndex(COPY.id)).ended, []);
    const late = await listRunsAndWork(COPY, A, since + limit + 60_000);
    assert.deepEqual(ids(late.runs), [...curated, settingUp].sort());
    assert.deepEqual(late.edits, []);
    index = await readRunIndex(COPY.id);
    assert.deepEqual([...index.ended].sort(), [ledgerOnly, died].sort());
    assert.deepEqual(index.stalled, {});
    // From then on no listing reads them: one that did would fail on this log.
    await writeFile(join(dirOf(ledgerOnly), "events.jsonl"), "{broken\n{broken\n");
    assert.deepEqual(ids(await listRuns(COPY, undefined)), curated);
  });

  it("lists a run whose result was written before the index heard of it", async () => {
    // The instance stopped between writing the result and recording it: the index still says the
    // run is going. Its maker's listing reads it at once, everyone's once its time is up.
    const fresh = "20261003t000600000-ko-brief-111111";
    const stale = "20261003t000700000-ko-brief-222222";
    for (const [runId, startedAt] of [
      [fresh, minutesAgo(1)],
      [stale, minutesAgo(RUN_TIME_LIMIT_SECONDS / 60 + 1)],
    ]) {
      await indexRunStarted(SAMPLE.id, runId, {
        owner: B,
        startedAt,
        work: { kind: "run", language: "ko", density: "brief" },
      });
      await writeRunFiles(SAMPLE.id, runId, { owner: B, startedAt, end: "done", minute: 20 });
    }
    assert.deepEqual(await listRuns(SAMPLE, undefined), []);
    let index = await readRunIndex(SAMPLE.id);
    assert.equal(index.finished[stale].owner, B, "a run past the time limit is settled by anyone");
    assert.ok(index.active[fresh], "another viewer's run still going is not read");
    assert.ok(!ids(await listRuns(SAMPLE, A)).includes(fresh));
    assert.ok(ids(await listRuns(SAMPLE, B)).includes(fresh));
    index = await readRunIndex(SAMPLE.id);
    assert.equal(index.active[fresh], undefined);
    assert.equal(index.finished[fresh].owner, B);
  });

  it("resumes runs and edits in progress from the index as before", async () => {
    const live = "20261003t000800000-ko-brief-333333";
    const editing = `edit-${"4".repeat(40)}`;
    const stale = "20261003t000900000-ko-brief-444444";
    const startedAt = minutesAgo(1);
    await indexRunStarted(SAMPLE.id, live, {
      owner: A,
      startedAt,
      work: { kind: "run", language: "ko", density: "brief" },
    });
    await writeRunFiles(SAMPLE.id, live, { owner: A, startedAt, end: "none" });
    const lastEventAt = (await stat(join(runDir(SAMPLE.id, live), "events.jsonl"))).mtime;
    const editWork = {
      kind: "edit" as const,
      baseRunId: "base-run",
      cueId: "L1",
      action: "remove" as const,
      language: "en" as const,
      density: "standard" as const,
    };
    await indexRunStarted(SAMPLE.id, editing, { owner: A, startedAt, work: editWork });
    // An edit writes its events only when it ends.
    await mkdir(runDir(SAMPLE.id, editing), { recursive: true });
    const oldStart = minutesAgo(RUN_TIME_LIMIT_SECONDS / 60 + 2);
    await indexRunStarted(SAMPLE.id, stale, {
      owner: A,
      startedAt: oldStart,
      work: { kind: "run", language: "ko", density: "brief" },
    });
    await writeRunFiles(SAMPLE.id, stale, { owner: A, startedAt: oldStart, end: "none" });

    const { kind: _kind, ...edit } = editWork;
    const expected = {
      active: [
        {
          runId: live,
          language: "ko",
          density: "brief",
          startedAt,
          lastEventAt: lastEventAt.toISOString(),
        },
      ],
      edits: [{ runId: editing, ...edit, startedAt }],
    };
    assert.deepEqual(await listActiveWork(SAMPLE.id, A), expected);
    assert.deepEqual(await listActiveWork(SAMPLE.id, B), { active: [], edits: [] });
    assert.deepEqual(await listActiveWork(SAMPLE.id, undefined), { active: [], edits: [] });
    assert.ok((await readRunIndex(SAMPLE.id)).ended.includes(stale), "past the limit: ended");
    const both = await listRunsAndWork(SAMPLE, A);
    assert.deepEqual(both, { runs: await listRuns(SAMPLE, A), ...expected });

    // Once the run fails it is no longer offered to resume, and it is never listed.
    await writeRunFiles(SAMPLE.id, live, { owner: A, startedAt, end: "failed" });
    await indexRunEnded(SAMPLE.id, live, true);
    assert.deepEqual((await listActiveWork(SAMPLE.id, A)).active, []);
    assert.ok(!ids(await listRuns(SAMPLE, A)).includes(live));
    assert.ok((await readRunIndex(SAMPLE.id)).ended.includes(live));
  });

  it("records the end of a generate run that stops, from executeRun itself", async () => {
    process.env.FFMPEG_PATH = join(dir, "no-ffmpeg");
    const cap = process.env.DAILY_BUDGET_USD;
    process.env.DAILY_BUDGET_USD = "5";
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("no network in this test");
    }) as typeof fetch;
    try {
      await writeFile(join(projectDir(UPLOAD.id), "clip.mp4"), "not a video");
      const run = await prepareRun({
        projectId: UPLOAD.id,
        language: "en",
        density: "standard",
        owner: A,
      });
      await assert.rejects(executeRun(run, await reserveRun()));
      const index = await readRunIndex(UPLOAD.id);
      assert.ok(index.ended.includes(run.runId));
      assert.equal(index.active[run.runId], undefined);
      assert.ok(!ids(await listRuns(UPLOAD, A)).includes(run.runId));
      assert.deepEqual((await listActiveWork(UPLOAD.id, A)).active, []);
    } finally {
      globalThis.fetch = original;
      if (cap === undefined) delete process.env.DAILY_BUDGET_USD;
      else process.env.DAILY_BUDGET_USD = cap;
    }
  });
});
