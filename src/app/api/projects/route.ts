import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject, MAX_UPLOAD_SECONDS } from "@/lib/store/ingest";
import { listProjects } from "@/lib/store/projects";
import { canAccess, ownerHash, publicProject, sameOrigin, sessionToken } from "@/lib/store/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

export async function GET() {
  const token = await sessionToken();
  return Response.json(
    { projects: (await listProjects()).filter((p) => canAccess(p, token)).map(publicProject) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

/** Accepts one short video, normalises it into a new project and returns the project id. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const file = form.get("video");
  if (!(file instanceof File))
    return Response.json({ error: "video file is required" }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return Response.json({ error: "too_large" }, { status: 413 });
  if (!file.type.startsWith("video/"))
    return Response.json({ error: "not_video" }, { status: 415 });

  const dir = await mkdtemp(join(tmpdir(), "scene-upload-"));
  try {
    const source = join(dir, "upload");
    await writeFile(source, Buffer.from(await file.arrayBuffer()));
    const title = file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Untitled clip";
    const project = await createProject({
      id: `u-${randomBytes(5).toString("hex")}`,
      title,
      kind: "upload",
      sourceFile: source,
      alreadyNormalised: false,
      // Chirp 3 detects the spoken language itself (checked on the sample: same word timings as en-US).
      filmLanguageCode: "auto",
      attribution: "",
      license: "",
      ownerHash: ownerHash((await sessionToken(true))!),
    });
    return Response.json({ id: project.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("upload failed", error);
    const tooLong = message.includes(`limit is ${MAX_UPLOAD_SECONDS}`);
    return Response.json({ error: tooLong ? "too_long" : "unreadable" }, { status: 422 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
