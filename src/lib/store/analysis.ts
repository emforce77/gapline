import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SceneMapSchema,
  SpeechSegmentSchema,
  type SceneMap,
  type SpeechSegment,
} from "../pipeline/schemas";
import { projectDir, type Project } from "./projects";

/** 3: speech includes the per-gap re-listen (relisten.ts); older saved analyses are heard again. */
export const ANALYSIS_VERSION = "3";
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

export async function readAnalysisParts(project: Project, key: string): Promise<AnalysisParts> {
  const parts: AnalysisParts = {};
  for (const kind of ["speech", "scene"] as const) {
    try {
      const cached = JSON.parse(
        await readFile(join(projectDir(project.id), `analysis-${kind}.json`), "utf8"),
      );
      if (cached.key === key)
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

export async function saveAnalysisPart(
  project: Project,
  key: string,
  part: AnalysisParts,
): Promise<void> {
  const valid = validateAnalysis(part, project.clipSeconds);
  for (const kind of ["speech", "scene"] as const)
    if (valid[kind] !== undefined)
      await writeFile(
        join(projectDir(project.id), `analysis-${kind}.json`),
        JSON.stringify({ key, data: valid[kind] }),
      );
}
