import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { RUN_TIME_LIMIT_SECONDS } from "../src/lib/api-contract";
import { listActiveRuns, listRuns, readRunSnapshot, runDir } from "../src/lib/store/projects";

it("polling survives startup and partial appends, and delivers the result before reporting done", async () => {
  const previous = process.env.DATA_DIR;
  const dir = await mkdtemp(join(tmpdir(), "scene-run-snapshot-"));
  process.env.DATA_DIR = dir;
  const now = Date.now();
  const project = { id: "snapshot-project", kind: "upload" } as const;
  try {
    const root = runDir("snapshot-project", "snapshot-run");
    await mkdir(root, { recursive: true });
    await writeFile(
      join(root, "owner.json"),
      JSON.stringify({
        ownerHash: "viewer",
        startedAt: new Date(now).toISOString(),
        language: "ko",
        density: "standard",
      }),
    );
    const snapshot = () => readRunSnapshot("snapshot-project", "snapshot-run", now);
    assert.deepEqual(await snapshot(), { events: [], status: "running" });
    assert.equal((await listActiveRuns("snapshot-project", "viewer", now)).length, 1);
    await assert.rejects(readRunSnapshot("snapshot-project", "missing-run", now), {
      code: "ENOENT",
    });

    const first = { type: "run_started", runId: "snapshot-run", t: 0 };
    const eventsFile = join(root, "events.jsonl");
    await writeFile(eventsFile, JSON.stringify(first) + '\n{"type":"stage"');
    assert.deepEqual(await snapshot(), { events: [first], status: "running" });
    assert.equal((await listActiveRuns("snapshot-project", "viewer", now)).length, 1);
    await appendFile(eventsFile, ',"stage":"mix","state":"done","t":1}\n');
    assert.equal((await snapshot()).events.length, 2);

    // The pipeline writes the script before the final event. Polling must keep following it.
    await writeFile(join(root, "script.json"), "{}");
    assert.equal((await snapshot()).status, "running");
    assert.equal((await listActiveRuns("snapshot-project", "viewer", now)).length, 1);
    assert.deepEqual(await listRuns(project, "viewer"), []);
    await appendFile(eventsFile, '{"type":"run_done","t":2}\n');
    const done = await snapshot();
    assert.equal(done.status, "done");
    assert.equal(done.events.at(-1)?.type, "run_done");
    assert.deepEqual(await listActiveRuns("snapshot-project", "viewer", now), []);
    assert.equal((await listRuns(project, "viewer"))[0]?.runId, "snapshot-run");

    await writeFile(eventsFile, JSON.stringify(first) + '\n{"type":"run_failed","t":2}\n');
    assert.equal((await snapshot()).status, "failed");
    await writeFile(eventsFile, JSON.stringify(first) + '\n{"type":');
    assert.equal(
      (
        await readRunSnapshot(
          "snapshot-project",
          "snapshot-run",
          now + (RUN_TIME_LIMIT_SECONDS + 1) * 1000,
        )
      ).status,
      "interrupted",
    );
    // A malformed completed record is not an in-progress append and must stay visible as an error.
    await writeFile(eventsFile, JSON.stringify(first) + '\n{"broken":}\n');
    await assert.rejects(snapshot(), SyntaxError);
  } finally {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  }
});
