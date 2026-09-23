/**
 * Film stills from the Blender 1080p master (1920x800, 24 fps), not the repo's 1280 px clips, so they
 * stay sharp on a projector. The master is fetched once into runtime/deck/cache and checked by SHA-256.
 * Before any still is cut, the repo clips are matched against the master to prove the film offsets
 * (clip.mp4 = film 0–65 s, eval-tos-city.mp4 = film 65–110 s). Anything that does not match stops the
 * build; there is no quiet switch to the smaller clips.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { runFfmpeg } from "../../src/lib/media/ffmpeg";
import { CITY_FILM_OFFSET_S } from "./data/city";
import { CACHE, CITY_CLIP, OPENING_CLIP, STILLS } from "./paths";

const MASTER_ZIP_URL = "https://download.blender.org/demo/movies/ToS/tears_of_steel_1080p.mov.zip";
const ZIP_SHA256 = "d87a41de040d3814dbde143e9ab85ef122caf22265f660b0bebf476cd8b357a5";
const MOV_SHA256 = "99486359be7e3681168a0fe94e1cbb0284c48b57b2a3ce7df4fa75e185987a15";
const MASTER = join(CACHE, "tears_of_steel_1080p.mov");
const MANIFEST = join(STILLS, "manifest.json");

/** Mean absolute difference (0–255) of 64x27 grey frames; a true match measured 0.4–0.8. */
const MAX_MATCH_MAD = 2;
const PROBE = { w: 64, h: 27 };
const NEIGHBOUR_S = 0.5;

export interface StillSpec {
  name: string;
  /** Seconds into the film (the master's own timeline). */
  filmTime: number;
  width: number;
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  await pipeline(createReadStream(path), hash);
  return hash.digest("hex");
}

async function fetchMaster(): Promise<void> {
  mkdirSync(CACHE, { recursive: true });
  const zip = join(CACHE, "tears_of_steel_1080p.mov.zip");
  console.log(`fetching the 1080p master (584 MB) from ${MASTER_ZIP_URL}`);
  const res = await fetch(MASTER_ZIP_URL);
  if (!res.ok || !res.body) throw new Error(`master download failed: HTTP ${res.status}`);
  await pipeline(
    Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
    createWriteStream(`${zip}.part`),
  );
  renameSync(`${zip}.part`, zip);
  const zipHash = await sha256(zip);
  if (zipHash !== ZIP_SHA256)
    throw new Error(`master zip checksum ${zipHash} is not ${ZIP_SHA256}`);
  const unzip = spawnSync("unzip", ["-o", "-q", zip, "-d", CACHE], { encoding: "utf8" });
  if (unzip.status !== 0) throw new Error(`unzip failed: ${unzip.stderr}`);
  rmSync(zip);
}

async function ensureMaster(): Promise<void> {
  if (!existsSync(MASTER)) await fetchMaster();
  const movHash = await sha256(MASTER);
  if (movHash !== MOV_SHA256)
    throw new Error(`${MASTER} checksum ${movHash} is not ${MOV_SHA256}; delete it to re-fetch`);
}

async function greyFrame(path: string, t: number): Promise<Buffer> {
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

const mad = (a: Buffer, b: Buffer): number =>
  a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;

/** Proves each repo clip is the master shifted by its offset, and that the check can tell a half second. */
async function checkOffsets(): Promise<string[]> {
  const probes = [
    { clip: OPENING_CLIP, offset: 0, times: [12, 28, 55] },
    { clip: CITY_CLIP, offset: CITY_FILM_OFFSET_S, times: [7.5, 15, 24] },
  ];
  const lines: string[] = [];
  for (const p of probes) {
    for (const t of p.times) {
      const clipFrame = await greyFrame(p.clip, t);
      const match = mad(clipFrame, await greyFrame(MASTER, t + p.offset));
      const off = mad(clipFrame, await greyFrame(MASTER, t + p.offset + NEIGHBOUR_S));
      if (match > MAX_MATCH_MAD || off <= match)
        throw new Error(
          `film offset check failed for ${p.clip} at ${t}s: match ${match.toFixed(2)}, +${NEIGHBOUR_S}s ${off.toFixed(2)}`,
        );
      lines.push(
        `${p.clip.split("/").pop()} ${t}s = film ${t + p.offset}s (difference ${match.toFixed(2)}, half a second off ${off.toFixed(2)})`,
      );
    }
  }
  return lines;
}

async function cut(spec: StillSpec): Promise<void> {
  await runFfmpeg([
    "-v",
    "error",
    "-ss",
    spec.filmTime.toFixed(3),
    "-i",
    MASTER,
    "-frames:v",
    "1",
    "-q:v",
    "2",
    ...(spec.width < 1920 ? ["-vf", `scale=${spec.width}:-2:flags=lanczos`] : []),
    "-y",
    join(STILLS, `${spec.name}.jpg`),
  ]);
}

/**
 * Cuts the stills unless the ones on disk were cut from the same master at the same times.
 * Returns the offset-check lines when it had to cut, or a note that the cache was current.
 */
export async function ensureStills(specs: StillSpec[], force: boolean): Promise<string[]> {
  const wanted = JSON.stringify({ master: MOV_SHA256, specs }, null, 1);
  const current = existsSync(MANIFEST) && readFileSync(MANIFEST, "utf8") === wanted;
  const allThere = specs.every((s) => existsSync(join(STILLS, `${s.name}.jpg`)));
  if (current && allThere && !force)
    return ["stills: cached, cut earlier from the checked master at the same times"];
  await ensureMaster();
  const lines = await checkOffsets();
  mkdirSync(STILLS, { recursive: true });
  for (const spec of specs) await cut(spec);
  writeFileSync(MANIFEST, wanted);
  return [`stills: cut ${specs.length} frames from the master (SHA-256 checked)`, ...lines];
}
