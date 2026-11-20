import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const gcloud = `#!/bin/sh
echo "$*" >> "$CALL_LOG"
case "$1 $2 $3" in
  "config get-value account") echo "$ACCOUNT" ;;
  "projects describe "*) echo 123 ;;
  "run deploy "*) ;;
  "run services describe") echo '{"status":{"traffic":[{"revisionName":"old","percent":100},{"revisionName":"next","tag":"candidate","url":"https://tag.invalid"}]}}' ;;
  "run jobs deploy"|"run jobs add-iam-policy-binding") ;;
  "run revisions describe") case "$*" in *status.imageDigest*) echo "registry.example/gapline@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"; exit ;; esac; echo '{"spec":{"containers":[{"env":[{"name":"DATA_BUCKET","value":"serving"}]}]}}' ;;
  "storage cat gs://serving/budget/demo-v2.json") echo "$BUDGET" ;;
  "run services update-traffic") ;;
  *) exit 1 ;;
esac`;

for (const [name, mode, budget, account, expected] of [
  ["builds and warms only the tag", "0", "", "tester@example.com", "build"],
  [
    "promotes an idle tested tag without rebuilding",
    "1",
    '{"entries":[]}',
    "tester@example.com",
    "promote",
  ],
  [
    "ignores completed and stale reservations",
    "1",
    '{"entries":[{"done":true},{"done":false,"startedAt":"2000-01-01T00:00:00Z"}]}',
    "tester@example.com",
    "promote",
  ],
  [
    "waits for live work",
    "1",
    JSON.stringify({ entries: [{ id: "live", done: false, startedAt: new Date().toISOString() }] }),
    "tester@example.com",
    "stop",
  ],
  [
    "protects an undated reservation",
    "1",
    '{"entries":[{"id":"legacy","done":false}]}',
    "tester@example.com",
    "stop",
  ],
  ["stops on an unreadable ledger", "1", "", "tester@example.com", "stop"],
  ["rejects the company account", "0", "", "tester@mazigle.ai", "stop-before-build"],
] as const) {
  test("deployment " + name, () => {
    const dir = mkdtempSync(join(tmpdir(), "gapline-deploy-"));
    try {
      const log = join(dir, "calls");
      writeFileSync(join(dir, "gcloud"), gcloud, { mode: 0o700 });
      writeFileSync(join(dir, "curl"), '#!/bin/sh\necho "$*" >> "$CALL_LOG"\necho "200 0.01"\n', {
        mode: 0o700,
      });
      const result = spawnSync("bash", ["deploy/cloud-run.sh"], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: dir + ":" + process.env.PATH,
          CALL_LOG: log,
          ACCOUNT: account,
          CLOUDSDK_ACTIVE_CONFIG_NAME: "mock",
          GCP_PROJECT_ID: "example",
          DAILY_BUDGET_USD: "5",
          BUDGET: budget,
          PROMOTE: mode,
          TAG: "candidate",
          RUN_EXECUTOR: "job",
        },
      });
      const calls = readFileSync(log, "utf8");
      const allowed = expected === "build" || expected === "promote";
      assert.equal(result.status === 0, allowed, result.stderr);
      assert.equal(calls.includes("run deploy "), expected === "build");
      assert.equal(calls.includes("update-traffic "), expected === "promote");
      if (expected === "build") {
        assert.match(calls, /--no-traffic --tag candidate/);
        const worker = calls.match(/RUN_JOB_NAME=(scene-ad-run-[0-9a-f]{12}-[0-9a-f]{16})/)?.[1];
        assert.ok(worker && calls.includes("run jobs deploy " + worker));
        assert.match(calls, /run jobs deploy .+ --image registry.example\/gapline@sha256:/);
        assert.match(calls, /--command node --args job\/run-job.cjs/);
        assert.match(calls, /run jobs add-iam-policy-binding .+ --role roles\/run.jobsExecutorWithOverrides/);
      }
      if (expected === "promote") assert.match(calls, /--to-tags candidate=100/);
      if (allowed) assert.match(calls, /https:\/\/tag\.invalid\/p\/tos-opening/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
