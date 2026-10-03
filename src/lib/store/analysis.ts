import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SceneMapSchema,
  SpeechSegmentSchema,
  type SceneMap,
  type SpeechSegment,
} from "../pipeline/schemas";
import { projectDir, type Project } from "./projects";

/** 3: speech includes the per-gap re-listen (relisten.ts). Part of both parts' keys. */
export const ANALYSIS_VERSION = "3";
/**
 * Versions the speech part alone, so a change to hearing leaves saved scene maps reused (partKey).
 * 4: recognizer annotations such as "[ BACKGROUND]" are not speech, long unplaced spans are heard
 * again in halves, speech is trimmed to audible audio, and segments carry the recognized language
 * (hear.ts, audible.ts). Older saved speech of uploads is heard again; a sample's is kept
 * (readAnalysisParts).
 */
const SPEECH_VERSION = "4";
export interface AnalysisParts {
  speech?: SpeechSegment[];
  scene?: SceneMap;
}

export async function analysisKey(project: Project, model: string): Promise<string> {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify([ANALYSIS_VERSION, project.filmLanguageCode, project.clipSeconds, model]),
  );
  for await (const part of createReadStream(join(projectDir(project.id), "clip.mp4")))
    hash.update(part);
  return hash.digest("hex");
}

/** The key a part is saved under: the analysis key, and for speech its own version too. */
function partKey(kind: keyof AnalysisParts, key: string): string {
  return kind === "speech" ? `${key}:speech-${SPEECH_VERSION}` : key;
}

/**
 * Model and recognizer times may overshoot the clip end by up to this much (the watch prompt asks for
 * one-decimal times); such times are clamped to the end before validation. Beyond it, the watch
 * result is rejected.
 */
export const CLIP_END_TOLERANCE_SECONDS = 0.5;
/** Stored analysis is already clamped; this only absorbs float noise in older cached results. */
const STORED_END_SLACK_SECONDS = 0.05;

/** Spans ending past the clip are cut at its end; spans starting at or after the end are dropped. */
export function clampToClip<T extends { start: number; end: number }>(
  spans: T[],
  clipSeconds: number,
): T[] {
  return spans
    .filter((s) => s.start < clipSeconds)
    .map((s) => (s.end > clipSeconds ? { ...s, end: clipSeconds } : s));
}

export function validateAnalysis(part: AnalysisParts, duration: number): AnalysisParts {
  const speech =
    part.speech === undefined ? undefined : SpeechSegmentSchema.array().parse(part.speech);
  const scene = part.scene === undefined ? undefined : SceneMapSchema.parse(part.scene);
  const spans = [...(speech ?? []), ...(scene?.shots ?? []), ...(scene?.sounds ?? [])];
  if (
    spans.some((s) => s.end > duration + STORED_END_SLACK_SECONDS) ||
    scene?.characters.some((c) => c.nameFirstSpokenAt !== null && c.nameFirstSpokenAt > duration)
  )
    throw new Error("Analysis timestamp exceeds the clip");
  return { speech, scene };
}

/**
 * The saved analysis parts that match `key`. A sample's parts are curated, shared by every visitor
 * and already paid for: they are reused whatever their key, so a new ANALYSIS_VERSION or
 * SPEECH_VERSION never makes a visitor's run hear or watch a sample again.
 */
export async function readAnalysisParts(project: Project, key: string): Promise<AnalysisParts> {
  const parts: AnalysisParts = {};
  for (const kind of ["speech", "scene"] as const) {
    try {
      const cached = JSON.parse(
        await readFile(join(projectDir(project.id), `analysis-${kind}.json`), "utf8"),
      );
      if (cached.key === partKey(kind, key) || project.kind === "sample")
        Object.assign(parts, {
          [kind]: validateAnalysis({ [kind]: cached.data }, project.clipSeconds)[kind],
        });
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" &&
        !(error instanceof SyntaxError) &&
        !(error instanceof Error && /Analysis|Zod/.test(error.name + error.message))
      )
        throw error;
    }
  }
  // Validation returns optional keys; avoid one component erasing the other.
  return Object.fromEntries(Object.entries(parts).filter(([, v]) => v !== undefined));
}

/** Saves each given part under `key`. A sample's stored part is never replaced (readAnalysisParts). */
export async function saveAnalysisPart(
  project: Project,
  key: string,
  part: AnalysisParts,
): Promise<void> {
  const valid = validateAnalysis(part, project.clipSeconds);
  for (const kind of ["speech", "scene"] as const) {
    if (valid[kind] === undefined) continue;
    const file = join(projectDir(project.id), `analysis-${kind}.json`);
    if (project.kind === "sample" && (await stored(file))) continue;
    await writeFile(file, JSON.stringify({ key: partKey(kind, key), data: valid[kind] }));
  }
}

async function stored(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
