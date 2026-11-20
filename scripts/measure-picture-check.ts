/** Compare the finalist fixtures once each. First run --frames-only and review labels.json. */
import { createHash } from "node:crypto";
import { mkdir, open, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { readCallRecords } from "../src/lib/llm/ledger";
import { MODELS } from "../src/lib/models";
import { watchingVideoFor } from "../src/lib/media/proxies";
import { extractLineStills } from "../src/lib/pipeline/line-stills";
import type { Verdict } from "../src/lib/pipeline/schemas";
import { reviewLines } from "../src/lib/pipeline/review";
import type { EditBase } from "../src/lib/runs/edit-track";
import { newRunBudget, withRunBudget, type Reservation } from "../src/lib/runs/budget";
import { dataDir, projectDir, runDir } from "../src/lib/store/projects";

const opening = "20260928t064307205-en-standard-221ceb";
const team = "20260922t054724430-en-standard-1c9aa1";
const edit = "edit-4dc2dfa9d338d9ffd6bafe0d2a8b445e4879b96f";
const fixtures = [
  { project: "tos-opening", run: opening },
  { project: "eval-tos-team", run: team },
  { project: "tos-opening", run: edit },
];
const cases = [
  { run: opening, photos: true },
  { run: opening, photos: false },
  { run: team, photos: true },
  { run: edit, photos: true },
];
const dir = join(dataDir(), "measure", "picture-check");
const ledger = join(dir, "ledger.jsonl");
const labelsFile = join(dir, "labels.json");
const callCap = 0.29;
const labelsSchema = z.array(
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

/** A repeated preparation never overwrites labels or the frozen pre-measurement answers. */
async function writeOnce(file: string, contents: string) {
  try {
    await writeFile(file, contents, { flag: "wx" });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    return false;
  }
}

/** Summarize only the measured comparisons; a partial set cannot clear an untested case. */
async function report() {
  const results = [];
  for (const test of cases) {
    const label = test.run + (test.photos ? "-photos" : "-video");
    const file = join(dir, label + ".json");
    let body: string;
    try {
      body = await readFile(file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    const result: {
      comparison: { cueId: string; expected: { label: string }; measured: Verdict }[];
    } = JSON.parse(body);
    const falsePositives = test.photos
      ? result.comparison
          .filter(
            (row) =>
              row.expected.label === "accept" &&
              row.measured.violations.some((v) => v.rule === "spoiler" || v.rule === "unseen"),
          )
          .map((row) => row.cueId)
      : [];
    const l6 = result.comparison.find((row) => row.cueId === "L6")?.measured;
    results.push({ label, file, ...test, falsePositives, l6 });
  }
  const first = results.find((r) => r.run === opening && r.photos);
  const caught = first?.l6?.violations.some((v) => v.rule === "spoiler");
  const verdict =
    (first && !caught) || results.some((r) => r.falsePositives.length)
      ? "no-go"
      : results.length === cases.length
        ? "go"
        : "incomplete";
  const calls = await readCallRecords(ledger);
  const summary = {
    at: new Date().toISOString(),
    verdict,
    completed: results.length,
    planned: cases.length,
    chargedOrBoundUsd: calls.reduce(
      (sum, c) => sum + (c.costKnown === false ? callCap : c.costUsd),
      0,
    ),
    results,
  };
  const file = join(dir, summary.at.replaceAll(":", "-") + ".json");
  await writeFile(file, JSON.stringify(summary, null, 2));
  console.log(verdict, `${results.length}/${cases.length}`, file);
}

async function main() {
  const { values } = parseArgs({
    options: {
      "frames-only": { type: "boolean" },
      "cap-usd": { type: "string" },
    },
  });
  const framesOnly = !!values["frames-only"];
  const limit = Number(values["cap-usd"]);
  if (!framesOnly && (!(limit > 0) || limit > 0.6))
    throw new Error("Specify --cap-usd in (0, 0.60]");
  await mkdir(dir, { recursive: true });
  const prepared = new Map<string, Awaited<ReturnType<typeof prepare>>>();
  for (const fixture of fixtures) prepared.set(fixture.run, await prepare(fixture, framesOnly));
  const rows = Array.from(prepared.values()).flatMap((item) => item.rows);
  if (framesOnly) {
    await writeOnce(
      labelsFile,
      JSON.stringify(
        rows.map((row) => ({ ...row, label: null, reason: "" })),
        null,
        2,
      ),
    );
    console.log(labelsFile);
    return;
  }
  const labels = labelsSchema.parse(JSON.parse(await readFile(labelsFile, "utf8")));
  if (
    labels.length !== rows.length ||
    rows.some(
      (row) => !labels.some((item) => item.key === row.key && item.evidence === row.evidence),
    )
  )
    throw new Error("Labels must cover these exact lines and source frames");
  const fixed = JSON.stringify(labels, null, 2);
  const frozen = join(dir, "labels.frozen.json");
  if (!(await writeOnce(frozen, fixed)) && (await readFile(frozen, "utf8")) !== fixed)
    throw new Error("Pre-measurement labels have changed");

  const lockFile = join(dir, "measure.lock");
  const lock = await open(lockFile, "wx");
  try {
    // An interrupted measurement keeps its case marker: inspect the ledger before a second charge.
    await writeFile(ledger, "", { flag: "a" });
    for (const test of cases) {
      const label = test.run + (test.photos ? "-photos" : "-video");
      const resultFile = join(dir, label + ".json");
      try {
        await readFile(resultFile);
        continue;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      const prior = await readCallRecords(ledger);
      if (prior.some((c) => c.promptTokens > 60_000))
        throw new Error("Prompt exceeded 60,000 tokens");
      const spent = prior.reduce(
        (sum, c) => sum + (c.costKnown === false ? callCap : c.costUsd),
        0,
      );
      if (spent + callCap > limit + 1e-9) {
        console.log(
          `Stopped before ${label}: $${spent} spent, $${callCap} required, $${limit} limit`,
        );
        break;
      }
      const { script, rows: caseRows, clip, frames } = prepared.get(test.run)!;
      const video = await watchingVideoFor(clip);
      const reservation: Reservation = {
        id: label,
        amount: limit,
        scope: "experiment",
        date: new Date().toISOString().slice(0, 10),
      };
      const budget = newRunBudget(reservation, callCap);
      budget.spent = spent;
      if (!(await writeOnce(join(dir, label + ".started"), new Date().toISOString())))
        throw new Error(
          `Interrupted measurement for ${label}; reconcile with ledger before retrying`,
        );
      const result = await withRunBudget(
        reservation,
        () =>
          reviewLines({
            model: MODELS.flash,
            ledgerFile: ledger,
            label,
            wholeScript: true,
            finalOutput: true,
            approved: [],
            context: {
              language: "en",
              density: "standard",
              clipSeconds: script.summary.clipSeconds,
              speech: script.speech,
              scene: script.scene,
              gaps: script.gaps,
              videoDataUrl: "data:video/mp4;base64," + video.toString("base64"),
            },
            lines: caseRows.map((r) => ({ id: r.cueId, start: r.start, end: r.end, text: r.text })),
            frames: test.photos ? frames : undefined,
          }),
        budget,
      );
      const calls = (await readCallRecords(ledger)).slice(prior.length);
      const comparison = caseRows.map((row) => ({
        ...row,
        expected: labels.find((item) => item.key === row.key)!,
        stored: script.summary.finalReview?.verdicts.find((v) => v.cueId === row.cueId),
        measured: result.verdicts.find((v) => v.cueId === row.cueId)!,
      }));
      await writeFile(
        resultFile,
        JSON.stringify(
          { at: new Date().toISOString(), label, calls, comparison, missing: result.missing },
          null,
          2,
        ),
      );
      console.table(
        comparison.map((c) => ({
          line: c.cueId,
          stored: c.stored?.pass,
          label: c.expected.label,
          pass: c.measured.pass,
          violations: c.measured.violations.map((v) => v.rule).join(", "),
        })),
      );
      console.log(
        resultFile,
        calls.map((c) => ({
          cost: c.costUsd,
          known: c.costKnown,
          latencyMs: c.latencyMs,
          tokens: c.promptTokensDetails,
        })),
      );
      if (calls.some((c) => c.promptTokens > 60_000))
        throw new Error("Prompt exceeded 60,000 tokens");
    }
    await report();
  } finally {
    await lock.close();
    await unlink(lockFile);
  }
}

async function prepare({ project, run }: { project: string; run: string }, save: boolean) {
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
