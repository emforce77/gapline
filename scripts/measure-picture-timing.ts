/** One blind follow-up evaluation of visual timing across the frozen finalist fixtures. */
import { createHash } from "node:crypto";
import { open, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { callStructuredOnce, MAX_OUTPUT_TOKENS, type ContentPart } from "../src/lib/llm/gemini";
import { readCallRecords } from "../src/lib/llm/ledger";
import { MODELS } from "../src/lib/models";
import { watchingVideoFor } from "../src/lib/media/proxies";
import { newRunBudget, withRunBudget, type Reservation } from "../src/lib/runs/budget";
import {
  dir,
  ledger,
  fixtures,
  prepare,
  labelsSchema,
  measurementSpend,
  opening,
  edit,
  team,
} from "./picture-check-fixtures";

const label = "blind-picture-timing";
const system = `For each narration line, identify the visible subject, action or change its wording claims at the stated start. The clip letter on a line identifies its video; each clip has its own clock. Decide each line independently.
Use the labeled opening and ending pictures and the moving clip. The opening picture was sampled after the line started. If a cut or reveal occurs between the stated start and that picture, consult the moving clip. When the timing cannot be resolved, return indeterminate.
Use supported when the claim is visually supported by the time narration begins. Use later when a detail is first shown after that time. Use not_visible when the claim lacks visual support throughout the clip. When several details are claimed, quote the specific words that determine your judgment. Note what is actually visible in the opening picture and later in the clip. Do not infer exact onset times from the stills. Ignore style, script coverage and audio quality. Return one judgment for each listed line ID.`;
const timing = z.object({
  lines: z.array(
    z.object({
      id: z.string(),
      status: z.enum(["supported", "later", "not_visible", "indeterminate"]),
      quotedWords: z.string(),
      openingObservation: z.string(),
      laterObservation: z.string(),
      firstSeenIn: z.enum(["opening", "by_end", "after_end", "elsewhere", "uncertain"]),
    }),
  ),
});

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
type Prepared = Awaited<ReturnType<typeof prepare>>;
type Row = Prepared["rows"][number];

async function blindInputs(labels: z.infer<typeof labelsSchema>) {
  const seen = new Map<string, string>();
  const rows: { source: Row; id: string; expected: z.infer<typeof labelsSchema>[number] }[] = [];
  const user: ContentPart[] = [];
  const videos: { clip: string; sha256: string }[] = [];
  const groups = new Map<string, { clip: string; rows: { row: Row; source: Prepared }[] }>();
  let matches = 0;
  for (const fixture of fixtures) {
    const item = await prepare(fixture, false);
    const group = groups.get(fixture.project) ?? { clip: item.clip, rows: [] };
    groups.set(fixture.project, group);
    for (const row of item.rows) {
      const expected = labels.find((l) => l.key === row.key && l.evidence === row.evidence);
      if (!expected)
        throw new Error("Source wording or frames differ from the frozen labels: " + row.key);
      matches++;
      const key = [fixture.project, row.start, row.end, row.evidence].join("/");
      if (seen.has(key)) {
        if (seen.get(key) !== expected.label) throw new Error("Frozen duplicate labels disagree");
        continue;
      }
      seen.set(key, expected.label);
      group.rows.push({ row, source: item });
    }
  }
  if (matches !== labels.length || matches !== 15 || seen.size !== 10)
    throw new Error("Expected the original fifteen frozen rows and ten distinct candidates");
  for (const [index, group] of [...groups.values()].entries()) {
    const clip = String.fromCharCode(65 + index);
    const video = await watchingVideoFor(group.clip);
    videos.push({ clip, sha256: createHash("sha256").update(video).digest("hex") });
    user.push(
      {
        type: "text",
        text: "Clip " + clip + ". All times below are in seconds from this video's start.",
      },
      {
        type: "video_url",
        video_url: { url: "data:video/mp4;base64," + video.toString("base64") },
      },
    );
    // A deterministic opaque order, independent of the labels or the previous review results.
    group.rows.sort((a, b) => hash(a.row.key).localeCompare(hash(b.row.key)));
    for (const [i, { row, source }] of group.rows.entries()) {
      const id = clip + (i + 1),
        expected = labels.find((l) => l.key === row.key)!;
      rows.push({ source: row, id, expected });
      user.push({
        type: "text",
        text: `Clip ${clip} · ${id} · narration starts at ${row.start.toFixed(3)} s and ends at ${row.end.toFixed(3)} s. Words: ${row.text}`,
      });
      for (const frame of source.frames.get(row.cueId)!) {
        user.push(
          {
            type: "text",
            text: `Clip ${clip} · ${id} · ${frame.moment === "start" ? "opening" : "ending"} picture at ${frame.at.toFixed(3)} s`,
          },
          { type: "image", jpegBase64: frame.jpeg.toString("base64") },
        );
      }
    }
  }
  return { rows, user, videos };
}

async function main() {
  const { values } = parseArgs({ options: { "cap-usd": { type: "string" } } });
  const limit = Number(values["cap-usd"]);
  if (!(limit > 0 && limit <= 0.6)) throw new Error("Specify --cap-usd in (0, 0.60]");
  const lockFile = join(dir, "measure.lock"),
    lock = await open(lockFile, "wx");
  try {
    const previousResults = [
      opening + "-photos",
      opening + "-video",
      team + "-photos",
      edit + "-photos",
    ];
    // Earlier work may have stopped for its own budget. An unresolved started case needs reconciliation.
    for (const id of previousResults) {
      try {
        await readFile(join(dir, id + ".started"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      await readFile(join(dir, id + ".json"));
    }
    const prior = await readCallRecords(ledger);
    if (prior.some((c) => c.label === label))
      throw new Error("Timing evaluation is already in the ledger");
    if (prior.some((c) => c.promptTokens > 60_000))
      throw new Error("A prior request exceeded the measured prompt allowance");
    const spent = measurementSpend(prior);
    const cap = limit - spent;
    // Allow the full 60,000-token input at the finalist rate, then keep one output token of
    // rounding room. countTokens independently prices this particular request before generation.
    const maxInputUsd = (60_000 * 0.75) / 1_000_000;
    const outputTokenUsd = 3.75 / 1_000_000;
    const outputTokens = Math.min(
      MAX_OUTPUT_TOKENS,
      Math.floor((cap - maxInputUsd) / outputTokenUsd) - 1,
    );
    if (outputTokens < 1)
      throw new Error("Remaining measurement budget cannot cover the prompt and output");
    const labels = labelsSchema.parse(
      JSON.parse(await readFile(join(dir, "labels.frozen.json"), "utf8")),
    );
    const { rows, user, videos } = await blindInputs(labels);
    const reservation: Reservation = {
      id: label,
      date: new Date().toISOString().slice(0, 10),
      scope: "experiment",
      amount: limit,
    };
    const budget = newRunBudget(reservation, cap);
    budget.spent = spent;
    const started = new Date().toISOString();
    await writeFile(
      join(dir, label + ".started"),
      JSON.stringify({ started, limit, spent, cap, outputTokens }),
      { flag: "wx" },
    );
    const request = {
      model: MODELS.flash,
      system,
      user,
      reasoningEffort: "medium",
      maxOutputTokens: outputTokens,
      schemaName: "picture_timing",
      schema: timing,
      label,
      ledgerFile: ledger,
      temperature: 0,
    } as const;
    const { data, record } = await withRunBudget(
      reservation,
      () => callStructuredOnce(request),
      budget,
    );
    const answers = new Map(data.lines.map((line) => [line.id, line]));
    const complete =
      answers.size === rows.length &&
      data.lines.length === rows.length &&
      rows.every((r) => answers.has(r.id));
    const comparison = rows.map((r) => ({
      id: r.id,
      line: r.source,
      expected: r.expected,
      answer: answers.get(r.id) ?? null,
    }));
    const rejected = (s: string | undefined) => s === "later" || s === "not_visible";
    const falsePositives = comparison
      .filter((r) => r.expected.label === "accept" && rejected(r.answer?.status))
      .map((r) => r.id);
    const misses = comparison
      .filter((r) => r.expected.label === "reject" && !rejected(r.answer?.status))
      .map((r) => r.id);
    const indeterminate = comparison
      .filter((r) => r.answer?.status === "indeterminate")
      .map((r) => r.id);
    const resultFile = join(dir, label + ".json");
    // Persist the provider answer even when it omitted or repeated an ID. No retry uses another charge.
    await writeFile(
      resultFile,
      JSON.stringify(
        {
          started,
          model: request.model,
          reasoningEffort: request.reasoningEffort,
          temperature: request.temperature,
          system,
          outputTokens,
          schema: z.toJSONSchema(timing),
          videos,
          userText: user.filter((p) => p.type === "text").map((p) => p.text),
          limit,
          spent,
          cap,
          record,
          chargedOrBoundUsd: measurementSpend([...prior, record]),
          response: data,
          comparison,
          complete,
          falsePositives,
          misses,
          indeterminate,
          expectedRejects: comparison.filter((r) => r.expected.label === "reject").map((r) => r.id),
          allMatch: complete && !falsePositives.length && !misses.length && !indeterminate.length,
        },
        null,
        2,
      ),
      { flag: "wx" },
    );
    await readCallRecords(ledger);
    console.table(
      comparison.map((r) => ({
        id: r.id,
        source: r.line.key,
        opening: r.line.frames[0].at,
        ending: r.line.frames[1].at,
        label: r.expected.label,
        result: r.answer?.status,
      })),
    );
    console.log({
      resultFile,
      complete,
      falsePositives,
      misses,
      indeterminate,
      latencyMs: record.latencyMs,
      costUsd: record.costUsd,
      costKnown: record.costKnown,
    });
    if (!complete) throw new Error("Incomplete or duplicate timing judgments");
  } finally {
    await lock.close();
    await unlink(lockFile);
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
