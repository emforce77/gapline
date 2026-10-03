import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_SECONDS,
  type ApiErrorBody,
  type UploadErrorCode,
} from "@/lib/api-contract";
import { UploadError } from "@/lib/errors";
import { createProject, uploadTitle } from "@/lib/store/ingest";
import { ownerHash, sameOrigin, sessionToken } from "@/lib/store/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Multipart boundaries and part headers around the file; generous so a 30 MiB file still passes. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;
const UPLOAD_STATUS: Record<UploadError["code"], number> = {
  too_large: 413,
  too_long: 422,
  too_short: 422,
  no_video_stream: 422,
  unreadable: 422,
};

function fail(status: number, body: ApiErrorBody<UploadErrorCode>): Response {
  return Response.json(body, { status });
}

function tooLarge(): Response {
  return fail(413, { error: "too_large", maxBytes: MAX_UPLOAD_BYTES });
}

/** Accepts one short video, normalises it into a new project and returns the project id. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return fail(403, { error: "forbidden" });
  // Reject before reading the body when the declared size already says no.
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) return tooLarge();
  const form = await request.formData().catch((error: unknown) => {
    console.error("upload: unreadable multipart body", error);
    return null;
  });
  const file = form?.get("video");
  if (!(file instanceof File)) return fail(400, { error: "missing_file" });
  if (file.size > MAX_UPLOAD_BYTES) return tooLarge();
  if (!file.type.startsWith("video/")) return fail(415, { error: "not_video" });

  const dir = await mkdtemp(join(tmpdir(), "scene-upload-"));
  try {
    const source = join(dir, "upload");
    await writeFile(source, Buffer.from(await file.arrayBuffer()));
    const project = await createProject({
      id: `u-${randomBytes(5).toString("hex")}`,
      title: uploadTitle(file.name),
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
    if (error instanceof UploadError) {
      console.warn(`upload rejected: code=${error.code} size=${file.size} ${error.message}`);
      return fail(UPLOAD_STATUS[error.code], {
        error: error.code,
        ...(error.code === "too_long" ? { maxSeconds: MAX_UPLOAD_SECONDS } : {}),
        ...(error.seconds === undefined ? {} : { seconds: Math.round(error.seconds) }),
      });
    }
    console.error("upload failed", error);
    return fail(500, { error: "internal" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
