import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { listRuns } from "../src/lib/store/run-index";
import {
  listProjects,
  projectDir,
  RUN_OWNER_FILE,
  runDir,
  writeProject,
  type Project,
} from "../src/lib/store/projects";
import { loadShowcase, loadShowcases } from "../src/lib/store/showcase";

function project(id: string, kind: Project["kind"], createdAt: string): Project {
  return {
    id,
    title: id,
    kind,
    clipSeconds: 10,
    filmLanguageCode: "en-US",
    attribution: "fixture",
    license: "fixture",
    createdAt,
    stripStepSeconds: 1,
  };
}

const SAMPLE = project("sample-clip", "sample", "2026-09-21T00:00:00.000Z");
const OLDER_SAMPLE = project("older-sample", "sample", "2026-09-01T00:00:00.000Z");
const UPLOAD = project("u-visitor", "upload", "2026-10-01T00:00:00.000Z");

/** A finished run whose script was written `minute` minutes into 2026-10-03 (its listing time). */
async function finishedRun(
  projectId: string,
  runId: string,
  language: string,
  density: string,
  minute: number,
  owner?: string,
): Promise<void> {
  const dir = runDir(projectId, runId);
  await mkdir(dir, { recursive: true });
  if (owner) await writeFile(join(dir, RUN_OWNER_FILE), JSON.stringify({ ownerHash: owner }));
  const events = [
    { type: "run_started", runId, language, density, t: 0 },
    { type: "run_done", t: 1 },
  ];
  await writeFile(join(dir, "events.jsonl"), events.map((e) => JSON.stringify(e)).join("\n"));
  const fits = { id: "L1", start: 1, status: "fits", versions: [{ text: runId }] };
  const dropped = { ...fits, id: "L2", status: "dropped" };
  await writeFile(
    join(dir, "script.json"),
    JSON.stringify({ speech: [], cues: [fits, dropped], summary: { cuesShipped: 1 } }),
  );
  const at = new Date(Date.UTC(2026, 9, 3, 0, minute));
  await utimes(join(dir, "script.json"), at, at);
}

const PINNED_EN = "20261003t000100000-en-standard-aaaaaa";
const NEWER_EN = "20261003t000200000-en-standard-bbbbbb";
const KO = "20261003t000300000-ko-standard-cccccc";
const BRIEF = "20261003t000400000-ko-brief-dddddd";
const VISITOR = "20261003t000500000-ko-standard-eeeeee";

const pinTo = (projectId: string) =>
  writeFile(
    join(process.env.DATA_DIR!, "showcase.json"),
    JSON.stringify({ projectId, runs: { en: PINNED_EN } }),
  );
const unpin = () => rm(join(process.env.DATA_DIR!, "showcase.json"), { force: true });

describe("the landing page's sample", () => {
  let dir: string;
  const previous = process.env.DATA_DIR;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "scene-showcase-"));
    process.env.DATA_DIR = dir;
    for (const p of [SAMPLE, OLDER_SAMPLE, UPLOAD]) await writeProject(p);
    await finishedRun(SAMPLE.id, PINNED_EN, "en", "standard", 1);
    await finishedRun(SAMPLE.id, NEWER_EN, "en", "standard", 2);
    await finishedRun(SAMPLE.id, KO, "ko", "standard", 3);
    await finishedRun(SAMPLE.id, BRIEF, "ko", "brief", 4);
    await finishedRun(SAMPLE.id, VISITOR, "ko", "standard", 5, "f".repeat(64));
    await finishedRun(
      OLDER_SAMPLE.id,
      "20261003t000600000-en-standard-ffffff",
      "en",
      "standard",
      6,
    );
    // A folder some upload left half-written: any listing of every project trips over it.
    await mkdir(projectDir("u-half-written"), { recursive: true });
    await writeFile(join(projectDir("u-half-written"), "project.json"), "{");
  });

  after(async () => {
    if (previous === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous;
    await rm(dir, { recursive: true, force: true });
  });

  it("reads the pinned sample alone, however many projects visitors have added", async () => {
    await pinTo(SAMPLE.id);
    await assert.rejects(listProjects(), SyntaxError);
    const both = await loadShowcases(["en", "ko"]);
    assert.ok(both);
    assert.equal(both.en.project.id, SAMPLE.id);
    // The pinned run in its language; elsewhere the newest standard run in that language.
    assert.equal(both.en.preview?.runId, PINNED_EN);
    assert.equal(both.ko.preview?.runId, KO);
    assert.deepEqual(
      both.ko.preview?.cues.map((c) => c.id),
      ["L1"],
    );
    // Both languages come from one listing, which has no visitor's own run.
    assert.equal(both.en.runs, both.ko.runs);
    assert.deepEqual(
      both.en.runs.map((r) => r.runId),
      [BRIEF, KO, NEWER_EN, PINNED_EN],
    );
    assert.deepEqual(both.en.runs, await listRuns(SAMPLE, undefined));
    assert.deepEqual(await loadShowcase("ko"), both.ko);
  });

  it("never shows a visitor's upload, even when the pin names one", async () => {
    await pinTo(UPLOAD.id);
    await assert.rejects(
      loadShowcases(["en"]),
      /showcase.json pins u-visitor, which is not a sample/,
    );
  });

  it("names showcase.json when the pin is wrong, instead of skipping it", async () => {
    await pinTo("gone-sample");
    await assert.rejects(loadShowcases(["en"]), /showcase.json pins gone-sample, which is not in /);
    await writeFile(join(dir, "showcase.json"), JSON.stringify({ runs: { en: PINNED_EN } }));
    await assert.rejects(loadShowcases(["en"]), /showcase.json is malformed:[^]*projectId/);
  });

  it("falls back to the newest sample and its newest runs without a pin", async () => {
    await unpin();
    // Uploads are never read for it, so a broken one cannot fail the landing page.
    await assert.rejects(listProjects(), SyntaxError);
    const unpinned = await loadShowcases(["en"]);
    assert.equal(unpinned?.en.project.id, SAMPLE.id);
    await rm(projectDir("u-half-written"), { recursive: true });
    // A listing skips a folder without metadata and any name that is not a project id.
    await mkdir(projectDir("u-no-metadata"), { recursive: true });
    await mkdir(projectDir("no-metadata-sample"), { recursive: true });
    await writeFile(join(dir, "projects", "README.txt"), "");
    const both = await loadShowcases(["en", "ko"]);
    assert.equal(both?.en.project.id, SAMPLE.id);
    assert.equal(both?.en.preview?.runId, NEWER_EN);
    assert.equal(both?.ko.preview?.runId, KO);
    await rm(projectDir("no-metadata-sample"), { recursive: true });
    assert.deepEqual(
      (await listProjects()).map((p) => p.id),
      [SAMPLE.id, OLDER_SAMPLE.id, UPLOAD.id],
    );
  });
});
