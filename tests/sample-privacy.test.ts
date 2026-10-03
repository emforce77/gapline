import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { encodeWav } from "../src/lib/media/narration-track";
import type { Cue } from "../src/lib/pipeline/schemas";
import { downloadName, runDownloadName } from "../src/lib/runs/download-name";
import { editRun, EditError } from "../src/lib/runs/edit-run";
import { canAccess, ownerHash } from "../src/lib/store/access";
import {
  canSeeRun,
  listActiveRuns,
  listRuns,
  readRunSnapshot,
  RUN_EDITOR_FILE,
  RUN_OWNER_FILE,
  runDir,
  runVisibleTo,
  writeProject,
  type Project,
} from "../src/lib/store/projects";

const TOKEN_A = "a".repeat(64);
const TOKEN_B = "b".repeat(64);
const A = ownerHash(TOKEN_A);
const B = ownerHash(TOKEN_B);

function project(id: string, kind: Project["kind"], owner?: string): Project {
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
    ...(owner ? { ownerHash: owner } : {}),
  };
}

const SAMPLE = project("sample-clip", "sample");
const UPLOAD = project("u-fixture", "upload", A);

const cue = {
  id: "L1",
  gapId: "g1",
  start: 1,
  seconds: 1,
  windowEnd: 5,
  status: "fits",
  audioFile: "voice/L1.wav",
  versions: [{ text: "A woman waits on the bridge.", start: 1, by: "write", model: "fixture" }],
} as Cue;

/**
 * A finished run on disk, with the files the web writes for its maker: owner.json for a generate
 * run, editor.json for an edit; none for a run made by a script.
 */
async function finishedRun(
  projectId: string,
  runId: string,
  marker?: { file: string; owner: string },
  language = "en",
): Promise<void> {
  const dir = runDir(projectId, runId);
  await mkdir(join(dir, "voice"), { recursive: true });
  if (marker)
    await writeFile(
      join(dir, marker.file),
      JSON.stringify({
        ownerHash: marker.owner,
        startedAt: new Date().toISOString(),
        language,
        density: "standard",
      }),
    );
  const events = [
    { type: "run_started", runId, language, density: "standard", t: 0 },
    { type: "run_done", t: 1 },
  ];
  await writeFile(
    join(dir, "events.jsonl"),
    events.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
  await writeFile(
    join(dir, "script.json"),
    JSON.stringify({ runId, cues: [cue], gaps: [{ id: "g1", start: 0, end: 5 }], speech: [] }),
  );
  await writeFile(join(dir, "voice", "L1.wav"), encodeWav(new Int16Array(16000), 16000));
}

const ids = (runs: { runId: string }[]) => runs.map((r) => r.runId).sort();

describe("versions made on the shared sample", () => {
  let dir: string;
  const previous = { data: process.env.DATA_DIR, ffmpeg: process.env.FFMPEG_PATH };

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), "scene-sample-privacy-"));
    process.env.DATA_DIR = dir;
    await writeProject(SAMPLE);
    await writeProject(UPLOAD);
    await finishedRun(SAMPLE.id, "20260928t064307205-en-standard-221ceb");
    await finishedRun(SAMPLE.id, "20261003t101010101-en-standard-aaaaaa", {
      file: RUN_OWNER_FILE,
      owner: A,
    });
    await finishedRun(SAMPLE.id, `edit-${"a".repeat(40)}`, { file: RUN_EDITOR_FILE, owner: A });
    await finishedRun(SAMPLE.id, "20261003t111111111-en-standard-bbbbbb", {
      file: RUN_OWNER_FILE,
      owner: B,
    });
    await finishedRun(UPLOAD.id, "20261003t121212121-ko-standard-cccccc", {
      file: RUN_OWNER_FILE,
      owner: A,
    });
    await finishedRun(UPLOAD.id, "20261003t131313131-ko-standard-dddddd");
  });

  after(async () => {
    if (previous.data === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = previous.data;
    if (previous.ffmpeg === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previous.ffmpeg;
    await rm(dir, { recursive: true, force: true });
  });

  it("decides visibility from the run's maker on a sample only", () => {
    assert.equal(runVisibleTo(SAMPLE, null, undefined), true);
    assert.equal(runVisibleTo(SAMPLE, null, A), true);
    assert.equal(runVisibleTo(SAMPLE, A, A), true);
    assert.equal(runVisibleTo(SAMPLE, A, B), false);
    assert.equal(runVisibleTo(SAMPLE, A, undefined), false);
    // An upload's runs are all its owner's; who may open it at all is canAccess's decision.
    assert.equal(runVisibleTo(UPLOAD, B, A), true);
  });

  it("lists the curated results to everyone and each visitor's own versions only to them", async () => {
    const curated = "20260928t064307205-en-standard-221ceb";
    assert.deepEqual(ids(await listRuns(SAMPLE, undefined)), [curated]);
    assert.deepEqual(ids(await listRuns(SAMPLE, A)), [
      "20260928t064307205-en-standard-221ceb",
      "20261003t101010101-en-standard-aaaaaa",
      `edit-${"a".repeat(40)}`,
    ]);
    assert.deepEqual(ids(await listRuns(SAMPLE, B)), [
      curated,
      "20261003t111111111-en-standard-bbbbbb",
    ]);
  });

  it("answers another visitor's run like a run that does not exist", async () => {
    const foreign = "20261003t111111111-en-standard-bbbbbb";
    // The media route and the run route serve a run only when canSeeRun says so.
    assert.equal(await canSeeRun(SAMPLE, foreign, A), false);
    assert.equal(await canSeeRun(SAMPLE, foreign, undefined), false);
    assert.equal(await canSeeRun(SAMPLE, foreign, B), true);
    assert.equal(await canSeeRun(SAMPLE, `edit-${"a".repeat(40)}`, B), false);
    assert.equal(await canSeeRun(SAMPLE, "20260928t064307205-en-standard-221ceb", B), true);
    // A missing run passes this check and then fails to read, as not found.
    assert.equal(await canSeeRun(SAMPLE, "no-such-run", A), true);
    await assert.rejects(readRunSnapshot(SAMPLE.id, "no-such-run"), { code: "ENOENT" });
  });

  it("leaves upload projects as they were: the owner sees every run, nobody else opens it", async () => {
    const all = ["20261003t121212121-ko-standard-cccccc", "20261003t131313131-ko-standard-dddddd"];
    assert.deepEqual(ids(await listRuns(UPLOAD, A)), all);
    assert.equal(await canSeeRun(UPLOAD, "20261003t131313131-ko-standard-dddddd", A), true);
    assert.equal(canAccess(UPLOAD, TOKEN_A), true);
    assert.equal(canAccess(UPLOAD, TOKEN_B), false);
    assert.equal(canAccess(SAMPLE, undefined), true);
  });

  it("refuses to edit another visitor's run with the same error as a missing run", async () => {
    const removal = { cueId: "L1", action: "remove" as const, requestId: "privacy-test-0001" };
    const missing = await editRun(SAMPLE.id, "no-such-run", removal, A).catch((e: unknown) => e);
    const foreign = await editRun(
      SAMPLE.id,
      "20261003t111111111-en-standard-bbbbbb",
      removal,
      A,
    ).catch((e: unknown) => e);
    assert.ok(foreign instanceof EditError && missing instanceof EditError);
    assert.deepEqual(
      [foreign.code, foreign.status, foreign.message],
      [missing.code, missing.status, missing.message],
    );
    assert.equal(foreign.code, "not_found");
    assert.equal(foreign.status, 404);
  });

  it("makes an edit of a public sample run private to its editor before writing any result", async () => {
    // The edit stops at its first media step (no ffmpeg here), before any paid call.
    const ffmpeg = join(dir, "no-ffmpeg");
    process.env.FFMPEG_PATH = ffmpeg;
    const original = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = (async () => {
      requests++;
      throw new Error("no network in this test");
    }) as typeof fetch;
    const base = "20260928t064307205-en-standard-221ceb";
    const removal = { cueId: "L1", action: "remove" as const, requestId: "privacy-test-0002" };
    try {
      await assert.rejects(editRun(SAMPLE.id, base, removal, B), {
        code: "ENOENT",
        syscall: `spawn ${ffmpeg}`,
      });
    } finally {
      globalThis.fetch = original;
    }
    assert.equal(requests, 0);
    const listed = await listRuns(SAMPLE, B);
    assert.ok(
      listed.every((r) => !r.runId.startsWith("edit-")),
      "a failed edit is never listed",
    );

    // The marker the edit wrote decides who sees it once its result exists.
    const runsDir = join(dir, "projects", SAMPLE.id, "runs");
    const editId = (await readdir(runsDir)).find(
      (id) => id.startsWith("edit-") && id !== `edit-${"a".repeat(40)}`,
    )!;
    const marker = JSON.parse(await readFile(join(runsDir, editId, RUN_EDITOR_FILE), "utf8"));
    assert.deepEqual(marker, { ownerHash: B });
    // It never shows up as a generate run its editor could resume.
    assert.deepEqual(await listActiveRuns(SAMPLE.id, B), []);
    await finishedRun(SAMPLE.id, editId, { file: RUN_EDITOR_FILE, owner: B });
    assert.ok(ids(await listRuns(SAMPLE, B)).includes(editId));
    assert.ok(!ids(await listRuns(SAMPLE, A)).includes(editId));
    assert.ok(!ids(await listRuns(SAMPLE, undefined)).includes(editId));
  });

  it("names downloads by project, language, density and version", async () => {
    const started = { language: "ko", density: "standard" } as const;
    assert.equal(
      downloadName(
        "tos-opening",
        "20260923t065852164-ko-standard-350b05",
        started,
        "described.mp4",
      ),
      "gapline-tos-opening-ko-standard-20260923-065852-described.mp4",
    );
    assert.equal(
      downloadName(
        "tos-opening",
        "edit-6c4ddb3c5a06c7901a834befe1bb25ba04a7ebde",
        { language: "en", density: "brief" },
        "narration.wav",
      ),
      "gapline-tos-opening-en-brief-edit-6c4ddb-narration.wav",
    );
    // An English and a Korean run, and an original and its edit, never share a name.
    const names = new Set(
      [
        ["20260928t064307205-en-standard-221ceb", "en"],
        ["20260923t065852164-ko-standard-350b05", "ko"],
        ["20260922t051536291-ko-standard-d88b71", "ko"],
        ["edit-b81cc95c158ee4acf857a44a2f7cf609e1df851c", "ko"],
      ].map(([runId, language]) =>
        downloadName(
          "tos-opening",
          runId,
          { language: language as "en" | "ko", density: "standard" },
          "described.mp4",
        ),
      ),
    );
    assert.equal(names.size, 4);
    // A run's per-line voice file (voice/L<n>.wav) can be downloaded too.
    assert.equal(
      downloadName("tos-opening", "20260923t065852164-ko-standard-350b05", started, "L1.wav"),
      "gapline-tos-opening-ko-standard-20260923-065852-L1.wav",
    );
    assert.throws(() => downloadName("tos-opening", "x", started, 'a".mp4'), /Unsafe/);
    assert.equal(
      await runDownloadName(SAMPLE.id, `edit-${"a".repeat(40)}`, "descriptions.vtt"),
      "gapline-sample-clip-en-standard-edit-aaaaaa-descriptions.vtt",
    );
  });
});
