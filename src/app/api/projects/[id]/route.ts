import { Storage } from "@google-cloud/storage";
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { mapLimit } from "@/lib/pipeline/map-limit";
import { accessibleProject, sameOrigin, viewerHash } from "@/lib/store/access";
import { projectDir, READS_IN_FLIGHT, UPLOAD_ID_PREFIX } from "@/lib/store/projects";
import { listActiveWork } from "@/lib/store/run-index";
import { markDeleting, UploadBusy, UploadGone } from "@/lib/store/upload-work";

export const runtime = "nodejs";

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const fail = (status: number, error: string) => Response.json({ error }, { status });
  if (!sameOrigin(request)) return fail(403, "forbidden");
  const { id } = await params;
  const project = await accessibleProject(id);
  const owner = await viewerHash();
  if (
    !id.startsWith(UPLOAD_ID_PREFIX) ||
    project?.kind !== "upload" ||
    !owner ||
    project.ownerHash !== owner
  )
    return fail(404, "not_found");
  try {
    // Includes work begun by an earlier revision, before uploads recorded active writers.
    const { edits, active } = await listActiveWork(id, owner);
    if (edits.length || active.length) throw new UploadBusy();
    await markDeleting(id, owner);
    // Retain the ownership record until all media and results are gone so a partial failure can retry.
    if (process.env.DATA_BUCKET) {
      const bucket = new Storage().bucket(process.env.DATA_BUCKET);
      const prefix = `projects/${id}/`;
      const metadata = prefix + "project.json";
      const [files] = await bucket.getFiles({ prefix });
      await mapLimit(
        files.filter((file) => file.name !== metadata),
        READS_IN_FLIGHT,
        async (file) => {
          await file.delete({ ignoreNotFound: true });
        },
      );
      await bucket.file(metadata).delete({ ignoreNotFound: true });
    } else {
      const dir = projectDir(id);
      const names = await readdir(dir);
      await mapLimit(
        names.filter((name) => name !== "project.json" && name !== "project.json.lock"),
        READS_IN_FLIGHT,
        (name) => rm(join(dir, name), { recursive: true, force: true }),
      );
      await rm(dir, { recursive: true, force: true });
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof UploadBusy) return fail(409, "active_work");
    if (error instanceof UploadGone) return fail(404, "not_found");
    console.error(`upload delete failed: project=${id}`, error);
    return fail(500, "internal");
  }
}
