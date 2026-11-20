import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { CallRecord } from "../src/lib/llm/ledger";
import { extractLineStills } from "../src/lib/pipeline/line-stills";
import type { EditBase } from "../src/lib/runs/edit-track";
import { dataDir, projectDir, runDir } from "../src/lib/store/projects";

export const opening = "20260928t064307205-en-standard-221ceb";
export const team = "20260922t054724430-en-standard-1c9aa1";
export const edit = "edit-4dc2dfa9d338d9ffd6bafe0d2a8b445e4879b96f";
export const fixtures = [
  { project: "tos-opening", run: opening },
  { project: "eval-tos-team", run: team },
  { project: "tos-opening", run: edit },
];
export const dir = join(dataDir(), "measure", "picture-check");
export const ledger = join(dir, "ledger.jsonl");
export const callCap = 0.29;

/** Early calls predate the per-call bound; their full reservation was $0.29. */
export function measurementSpend(calls: CallRecord[]) {
  return calls.reduce(
    (sum, c) => sum + (c.costKnown === false ? (c.boundUsd ?? callCap) : c.costUsd),
    0,
  );
}
export const labelsSchema = z.array(
  z.object({
    key: z.string(),
    evidence: z.string(),
    label: z.enum(["accept", "reject"]),
    reason: z.string().trim().min(1),
  }),
);
function digest(data: string | Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

export async function prepare({ project, run }: { project: string; run: string }, save: boolean) {
  const clip = join(projectDir(project), "clip.mp4");
  const script: EditBase = JSON.parse(
    await readFile(join(runDir(project, run), "script.json"), "utf8"),
  );
  if (script.runId !== run) throw new Error("Unexpected script id");
  const cues = script.cues.filter((cue) => cue.status === "fits");
  const frames = await extractLineStills(clip, cues);
  const rows = [];
  for (const cue of cues) {
    const pictures = frames.get(cue.id)!;
    const text = cue.versions.at(-1)!.text;
    const files = pictures.map((frame) => join(dir, `${run}-${cue.id}-${frame.moment}.jpg`));
    if (save) await Promise.all(files.map((file, i) => writeFile(file, pictures[i].jpeg)));
    const evidence = digest(
      JSON.stringify([text, pictures.map((f) => [f.moment, f.at, digest(f.jpeg)])]),
    );
    rows.push({
      key: run + "/" + cue.id,
      evidence,
      cueId: cue.id,
      text,
      start: cue.start,
      end: cue.start + cue.seconds!,
      frames: pictures.map((f, i) => ({ file: files[i], at: f.at, moment: f.moment })),
    });
  }
  return { rows, frames, script, clip };
}
