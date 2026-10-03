import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { runDownloadName } from "@/lib/runs/download-name";
import { projectDir } from "@/lib/store/projects";
import { accessibleProject, accessibleRun } from "@/lib/store/access";

export const runtime = "nodejs";

const SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i;
const TYPES: Record<string, string> = {
  mp4: "video/mp4",
  jpg: "image/jpeg",
  wav: "audio/wav",
  vtt: "text/vtt; charset=utf-8",
  json: "application/json; charset=utf-8",
};

/**
 * Serves a project's media with HTTP Range support (video seeking needs it). A run's files are
 * served only to viewers who may see that run (another viewer's run on the sample is not found).
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
  try {
    size = (await stat(path)).size;
  } catch {
    return new Response("Not found", { status: 404 });
  }
  const headers: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
  };
  const download = new URL(request.url).searchParams.get("download");
  if (download) {
    const name = runId ? await runDownloadName(id, runId, file.at(-1)!) : file.at(-1);
    headers["Content-Disposition"] = `attachment; filename="${name}"`;
  }

  const range = request.headers.get("range");
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
