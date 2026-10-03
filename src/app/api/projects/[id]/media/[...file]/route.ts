import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { runDownloadName } from "@/lib/runs/download-name";
import { projectDir } from "@/lib/store/projects";
import { accessibleProject, accessibleRun } from "@/lib/store/access";

export const runtime = "nodejs";

const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i;
/** A year: the longest lifetime HTTP caches are asked to honour. */
const IMMUTABLE_MAX_AGE_SECONDS = 31_536_000;
const TYPES: Record<string, string> = {
  mp4: "video/mp4",
  jpg: "image/jpeg",
  wav: "audio/wav",
  vtt: "text/vtt; charset=utf-8",
  json: "application/json; charset=utf-8",
};

/** Whether an If-None-Match header names this ETag (a list, weak forms, or "*"). */
function matchesEtag(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === "*" || tag === etag);
}

/**
 * Serves a project's media with HTTP Range support (video seeking needs it). A run's files are
 * served only to viewers who may see that run (another viewer's run on the sample is not found).
 * The browser keeps what it may: a run's files and an upload's files never change under their
 * URL (a run writes its result once, a retried edit gets a run of its own, an upload gets a new
 * id), so they are cached for a year. A sample's own clip, strip and poster are rewritten in place
 * when the sample is prepared again, so the browser checks them each time (ETag, 304). Every
 * answer is `private`: access depends on the viewer's cookie, and nothing shared caches it.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; file: string[] }> },
) {
  const { id, file } = await params;
  const runId = file[0] === "runs" ? file[1] : undefined;
  const project = runId ? await accessibleRun(id, runId) : await accessibleProject(id);
  if (!project) return new Response("Not found", { status: 404 });
  const allowed =
    (file.length === 1 && ["clip.mp4", "strip.jpg", "poster.jpg"].includes(file[0])) ||
    (file.length === 3 &&
      file[0] === "runs" &&
      ["described.mp4", "narration.wav", "descriptions.vtt", "script.json"].includes(file[2])) ||
    (file.length === 4 && file[0] === "runs" && file[2] === "voice" && /^L\d+\.wav$/.test(file[3]));
  if (!allowed) return new Response("Not found", { status: 404 });
  if (file.length === 0 || !file.every((s) => SEGMENT.test(s) && s !== "..")) {
    return new Response("Not found", { status: 404 });
  }
  const root = resolve(projectDir(id));
  const path = resolve(join(root, ...file));
  if (!path.startsWith(root + sep)) return new Response("Not found", { status: 404 });
  const type = TYPES[path.split(".").pop() ?? ""];
  if (!type) return new Response("Not found", { status: 404 });

  let size: number;
  let modified: Date;
  try {
    ({ size, mtime: modified } = await stat(path));
  } catch {
    return new Response("Not found", { status: 404 });
  }
  // Without a validator, browsers neither keep nor reuse partial (Range) answers, so video would
  // be fetched again in full on every visit even with a long max-age.
  const etag = `"${size.toString(16)}-${Math.floor(modified.getTime()).toString(16)}"`;
  const lastModified = modified.toUTCString();
  const immutable = runId !== undefined || project.kind === "upload";
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": immutable
      ? `private, max-age=${IMMUTABLE_MAX_AGE_SECONDS}, immutable`
      : "private, no-cache",
    ETag: etag,
    "Last-Modified": lastModified,
  };
  const download = new URL(request.url).searchParams.get("download");
  if (download) {
    const name = runId ? await runDownloadName(project, runId, file.at(-1)!) : file.at(-1);
    headers["Content-Disposition"] = `attachment; filename="${name}"`;
  }
  if (matchesEtag(request.headers.get("if-none-match"), etag))
    return new Response(null, { status: 304, headers });

  // A Range is honoured only for the version the browser already holds part of (If-Range).
  const ifRange = request.headers.get("if-range");
  const range =
    !ifRange || ifRange === etag || ifRange === lastModified ? request.headers.get("range") : null;
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (match && (match[1] || match[2])) {
    const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
    return new Response(stream, {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }
  const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
  return new Response(stream, { headers: { ...headers, "Content-Length": String(size) } });
}
