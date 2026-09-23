/**
 * The hook's picture from Blender's 1080p master (1920×800) instead of the repo's 1280 px clip, so the
 * reveal is sharp. The master is fetched once (the same zip and SHA-256 the deck checks in
 * scripts/deck/film.ts), the hook's seconds are cut from it, the cut is proven to be the same frames
 * as the clip at the same time, and the 584 MB master is deleted again. Only the cut is kept.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { runFfmpeg } from "../../src/lib/media/ffmpeg";
import { CACHE_DIR, CLIP_FILE } from "./config";

const MASTER_ZIP_URL = "https://download.blender.org/demo/movies/ToS/tears_of_steel_1080p.mov.zip";
const ZIP_SHA256 = "d87a41de040d3814dbde143e9ab85ef122caf22265f660b0bebf476cd8b357a5";
const MOV_SHA256 = "99486359be7e3681168a0fe94e1cbb0284c48b57b2a3ce7df4fa75e185987a15";
const MASTER = join(CACHE_DIR, "tears_of_steel_1080p.mov");
/** Mean absolute difference (0–255) of small grey frames; the deck measured 0.4–0.8 for a match. */
const MAX_MATCH_MAD = 2;
const PROBE = { w: 64, h: 27 };
const CUT_CRF = 14;

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function fetchMaster(): Promise<void> {
  const zip = join(CACHE_DIR, "tears_of_steel_1080p.mov.zip");
  console.log(`fetching the 1080p master (584 MB) from ${MASTER_ZIP_URL}`);
  const res = await fetch(MASTER_ZIP_URL);
  if (!res.ok || !res.body) throw new Error(`master download failed: HTTP ${res.status}`);
  await pipeline(
    Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
    createWriteStream(`${zip}.part`),
  );
  await rename(`${zip}.part`, zip);
  if ((await sha256(zip)) !== ZIP_SHA256) throw new Error("master zip checksum mismatch");
  const unzip = spawnSync("unzip", ["-o", "-q", zip, "-d", CACHE_DIR], { encoding: "utf8" });
  if (unzip.status !== 0) throw new Error(`unzip failed: ${unzip.stderr}`);
  await rm(zip);
  if ((await sha256(MASTER)) !== MOV_SHA256) throw new Error("master checksum mismatch");
}

async function grey(path: string, t: number): Promise<Buffer> {
  const { stdout } = await runFfmpeg([
    "-v",
    "error",
    "-ss",
    t.toFixed(3),
    "-i",
    path,
    "-frames:v",
    "1",
    "-vf",
    `scale=${PROBE.w}:${PROBE.h},format=gray`,
    "-f",
    "rawvideo",
    "-",
  ]);
  if (stdout.length !== PROBE.w * PROBE.h) throw new Error(`no frame at ${t}s in ${path}`);
  return stdout;
}

const mad = (a: Buffer, b: Buffer) =>
  a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;

/** The hook's film seconds from the master, cut once; throws unless they match the clip's frames. */
export async function masterCut(from: number, to: number): Promise<string> {
  const cut = join(CACHE_DIR, `master-${from.toFixed(2)}-${to.toFixed(2)}.mp4`);
  if (existsSync(cut)) return cut;
  await mkdir(CACHE_DIR, { recursive: true });
  if (!existsSync(MASTER)) await fetchMaster();
  await runFfmpeg([
    "-y",
    "-ss",
    from.toFixed(3),
    "-t",
    (to - from).toFixed(3),
    "-i",
    MASTER,
    "-an",
    "-c:v",
    "libx264",
    "-crf",
    String(CUT_CRF),
    "-pix_fmt",
    "yuv420p",
    `${cut}.part.mp4`,
  ]);
  for (const f of [0.5, (to - from) / 2, to - from - 0.5]) {
    const d = mad(await grey(`${cut}.part.mp4`, f), await grey(CLIP_FILE, from + f));
    if (d > MAX_MATCH_MAD)
      throw new Error(`master cut differs from the clip at film ${from + f}s (${d.toFixed(2)})`);
  }
  await rename(`${cut}.part.mp4`, cut);
  await rm(MASTER);
  return cut;
}
