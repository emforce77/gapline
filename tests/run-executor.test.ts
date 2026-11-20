import assert from "node:assert/strict";
import { appendFile, mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { runFfmpeg, FfmpegTimeoutError } from "../src/lib/media/ffmpeg";
import { executorConfig } from "../src/lib/runs/executor-config";
import { runEventStream } from "../src/lib/runs/event-stream";
import { launchJob } from "../src/lib/runs/job-launch";
import { updateJson } from "../src/lib/store/atomic";
import { dropGoogleToken, googleAccessToken } from "../src/lib/google/auth";
import { withFetch } from "./with-fetch";

it("requires the executor and both job settings", () => {
  assert.deepEqual(executorConfig({ RUN_EXECUTOR: "inline" }), { mode: "inline" });
  assert.throws(() => executorConfig({}), /RUN_EXECUTOR/);
  assert.throws(
    () => executorConfig({ RUN_EXECUTOR: "job", RUN_JOB_NAME: "worker" }),
    /RUN_JOB_REGION/,
  );
});

it("dispatches one execution with only the project and run IDs", async () => {
  const calls: string[] = [];
  await withFetch(
    async (url, init) => {
      calls.push(url);
      assert.deepEqual(JSON.parse(String(init?.body)), {
        overrides: {
          containerOverrides: [
            {
              env: [
                { name: "GAPLINE_PROJECT_ID", value: "sample" },
                { name: "GAPLINE_RUN_ID", value: "run-1" },
              ],
            },
          ],
        },
      });
      assert.ok(init?.signal);
      return new Response(null, { status: 401 });
    },
    () =>
      assert.rejects(
        launchJob({ mode: "job", region: "asia-northeast3", name: "worker" }, "sample", "run-1"),
        /401/,
      ),
  );
  assert.deepEqual(calls, [
    "https://run.googleapis.com/v2/projects/fixture/locations/asia-northeast3/jobs/worker:run",
  ]);
});

it("passes complete events in order across a split JSON line and ends at run_done", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gapline-tail-"));
  try {
    const file = join(dir, "events.jsonl");
    const first = '{"type":"run_started","t":0}';
    const last = '{"type":"run_done","t":1}';
    await writeFile(file, first + "\n" + last.slice(0, 9));
    const stream = runEventStream(file, Date.now(), new AbortController().signal).getReader();
    assert.equal(new TextDecoder().decode((await stream.read()).value), "data: " + first + "\n\n");
    await appendFile(file, last.slice(9) + "\n");
    assert.equal(new TextDecoder().decode((await stream.read()).value), "data: " + last + "\n\n");
    assert.equal((await stream.read()).done, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it("stops a stalled media process at its deadline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gapline-timeout-"));
  const saved = process.env.FFMPEG_PATH;
  try {
    const fake = join(dir, "ffmpeg");
    await writeFile(fake, "#!/bin/sh\nexec sleep 20\n");
    await chmod(fake, 0o700);
    process.env.FFMPEG_PATH = fake;
    await assert.rejects(runFfmpeg([], 30), FfmpegTimeoutError);
  } finally {
    if (saved === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = saved;
    await rm(dir, { recursive: true, force: true });
  }
});

it("uses metadata and requires a bucket when only CLOUD_RUN_JOB is present", async (t) => {
  const saved = {
    job: process.env.CLOUD_RUN_JOB,
    service: process.env.K_SERVICE,
    bucket: process.env.DATA_BUCKET,
  };
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    assert.match(url, /metadata.google.internal/);
    assert.ok(init.signal);
    return Response.json({ access_token: "job-fixture", expires_in: 3600 });
  });
  delete process.env.K_SERVICE;
  delete process.env.DATA_BUCKET;
  process.env.CLOUD_RUN_JOB = "worker";
  dropGoogleToken();
  try {
    assert.equal(await googleAccessToken(), "job-fixture");
    await assert.rejects(
      updateJson(
        "file.json",
        () => ({}),
        () => {},
      ),
      /DATA_BUCKET/,
    );
  } finally {
    for (const [name, val] of [
      ["K_SERVICE", saved.service],
      ["CLOUD_RUN_JOB", saved.job],
      ["DATA_BUCKET", saved.bucket],
    ] as const) {
      if (val === undefined) delete process.env[name];
      else process.env[name] = val;
    }
    dropGoogleToken();
  }
});
