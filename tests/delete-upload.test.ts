import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import nextHeaders from "next/headers";
import { DELETE } from "../src/app/api/projects/[id]/route";
import { ownerHash, OWNER_COOKIE } from "../src/lib/store/access";
import {
  projectDir,
  RUN_EDITOR_FILE,
  RUN_OWNER_FILE,
  runDir,
  writeProject,
  type Project,
} from "../src/lib/store/projects";
import {
  beginUploadWork,
  markDeleting,
  UploadBusy,
  UploadGone,
} from "../src/lib/store/upload-work";

const token = "a".repeat(64);
const owner = ownerHash(token);
const upload: Project = {
  id: "u-to-delete",
  title: "Private video",
  kind: "upload",
  clipSeconds: 12,
  filmLanguageCode: "en",
  createdAt: new Date().toISOString(),
  ownerHash: owner,
  attribution: "",
  license: "",
  stripStepSeconds: 1,
};

it("deletes only the owner's idle upload and leaves accounting and similarly named projects intact", async (t) => {
  const prev = process.env.DATA_DIR;
  const data = await mkdtemp(join(tmpdir(), "gapline-delete-"));
  process.env.DATA_DIR = data;
  t.after(async () => {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    await rm(data, { recursive: true, force: true });
  });
  let visitor = token;
  t.mock.method(nextHeaders, "cookies", async () => ({
    get: (key: string) => (key === OWNER_COOKIE ? { value: visitor } : undefined),
  }));
  const remove = (id: string, origin = "http://localhost") =>
    DELETE(
      new Request("http://localhost", {
        method: "DELETE",
        headers: { host: "localhost", origin },
      }),
      { params: Promise.resolve({ id }) },
    );
  await writeProject(upload);
  const sibling = { ...upload, id: upload.id + "-copy" };
  await writeProject(sibling);
  await writeProject({ ...upload, id: "sample-film", kind: "sample" });
  await writeProject({ ...upload, id: "eval-film" });
  await writeFile(join(projectDir(upload.id), "clip.mp4"), "clip");
  await mkdir(join(data, "budget"));
  const ledger = join(data, "budget", "demo-v2.json");
  await writeFile(ledger, '{"entries":[]}');

  assert.equal((await remove(upload.id, "https://elsewhere.test")).status, 403);
  visitor = "b".repeat(64);
  assert.equal((await remove(upload.id)).status, 404);
  visitor = token;
  for (const id of ["eval-film", "sample-film", "u-absent", "../sample-film"])
    assert.equal((await remove(id)).status, 404);

  const workDir = runDir(upload.id, "a-pending-run");
  for (const file of [RUN_OWNER_FILE, RUN_EDITOR_FILE]) {
    await mkdir(workDir, { recursive: true });
    await writeFile(
      join(workDir, file),
      JSON.stringify({
        ownerHash: owner,
        startedAt: new Date().toISOString(),
        language: "en",
        density: "brief",
        baseRunId: "parent-run",
        cueId: "L1",
        action: "rewrite",
      }),
    );
    assert.equal((await remove(upload.id)).status, 409);
    await rm(workDir, { recursive: true });
  }
  const release = await beginUploadWork(upload.id);
  assert.equal((await remove(upload.id)).status, 409);
  await release();
  // Conditional writes protect the gap before a worker has written any run directory.
  const [writer, deletion] = await Promise.allSettled([
    beginUploadWork(upload.id),
    markDeleting(upload.id, owner),
  ]);
  assert.ok(writer.status !== deletion.status);
  if (writer.status === "fulfilled") {
    assert.ok(deletion.status === "rejected" && deletion.reason instanceof UploadBusy);
    await writer.value();
    await markDeleting(upload.id, owner);
  } else assert.ok(writer.reason instanceof UploadGone);
  await assert.rejects(beginUploadWork(upload.id), UploadGone);
  assert.equal((await remove(upload.id)).status, 204);
  await assert.rejects(access(projectDir(upload.id)), { code: "ENOENT" });
  await access(join(projectDir(sibling.id), "project.json"));
  assert.equal(await readFile(ledger, "utf8"), '{"entries":[]}');
  assert.equal((await remove(upload.id)).status, 404);
});
