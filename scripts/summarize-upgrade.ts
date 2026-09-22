import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { readCallRecords } from "../src/lib/llm/ledger";
async function main() {
  const dir = "runtime/evaluation";
  const rows = (await readFile(join(dir, "runs.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((s) => JSON.parse(s));
  const results = [];
  const cases = [];
  const omissions: Record<string, Record<string, number>> = {
    "tos-opening": { high: 0, medium: 1 },
    "eval-ko-intro": { high: 2, medium: 2 },
    "eval-tos-city": { high: 0, medium: 0 },
  };
  for (const id of [...new Set(rows.map((r) => r.projectId))])
    cases.push(JSON.parse(await readFile(join(dir, `${id}.reference.json`), "utf8")));
  for (const row of rows) {
    const base = join("runtime/projects", row.projectId, "runs", row.runId);
    const calls = await readCallRecords(join(base, "ledger.jsonl"));
    const cost = {
      openRouterUsd: calls
        .filter((c) => c.model.startsWith("google/"))
        .reduce((s, c) => s + c.costUsd, 0),
      googleSpeechUsd: calls
        .filter((c) => !c.model.startsWith("google/"))
        .reduce((s, c) => s + c.costUsd, 0),
      unknownCharges: calls.filter((c) => c.costKnown === false).length,
    };
    let overlaps: null | { cueId: string; seconds: number }[] = null;
    if (row.status === "done") {
      const script = JSON.parse(await readFile(join(base, "script.json"), "utf8"));
      try {
        const ref = JSON.parse(
          await readFile(join(dir, `${row.projectId}.independent-speech.json`), "utf8"),
        );
        const words = ref.segments.flatMap((s: any) => s.words);
        overlaps = script.cues
          .filter((c: any) => c.status === "fits")
          .map((c: any) => ({
            cueId: c.id,
            seconds: words.reduce(
              (t: number, w: any) =>
                t + Math.max(0, Math.min(c.start + c.seconds, w.end) - Math.max(c.start, w.start)),
              0,
            ),
          }))
          .filter((x: any) => x.seconds > 0.001);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    results.push({
      projectId: row.projectId,
      setting: row.setting,
      split: row.split,
      runId: row.runId,
      status: row.status,
      cost,
      ...(row.summary
        ? {
            wallSeconds: row.summary.wallSeconds,
            analysisReused: row.summary.analysisReused,
            shipped: row.summary.cuesShipped,
            modelQuality: row.summary.qualityStatus,
            modelMissing: row.summary.finalReview.missing.map((m: any) => m.what),
          }
        : { error: row.error }),
      observedEssentialOmissions: omissions[row.projectId]?.[row.setting] ?? null,
      referenceScope: "Fixed facts and sampled-frame comparison; unknown is not zero.",
      independentAsrOverlapCandidates: overlaps,
      certifiedDialogueIntrusions: null,
      certifiedImportantSoundIntrusions: null,
      certifiedFactualAndTimingErrors: null,
    });
  }
  const cost = results.reduce(
    (s, r) => ({
      openRouterUsd: s.openRouterUsd + r.cost.openRouterUsd,
      googleSpeechUsd: s.googleSpeechUsd + r.cost.googleSpeechUsd,
      unknownCharges: s.unknownCharges + r.cost.unknownCharges,
    }),
    { openRouterUsd: 0, googleSpeechUsd: 0, unknownCharges: 0 },
  );
  const summary = {
    at: new Date().toISOString(),
    decision: "NO-GO medium reviewer; retain high. Final listening acceptance is open.",
    screeningRuns: results.length,
    completed: results.filter((r) => r.status === "done").length,
    failed: results.filter((r) => r.status === "failed").length,
    cost,
    notes: [
      "Default high and candidate medium share all integrity fixes; this is not a pre-upgrade A/B comparison.",
      "Only the retained setting was run on held-out cases after the candidate lost essential context.",
      "Cold high versus cached medium total latency/cost are not comparable.",
      "Opening reference is not blinded to the first smoke result.",
      "Same-film clips are clustered; no population or participant-impact inference.",
      "Whisper timings are independent ASR, not ground truth. Real sound intrusions and full listening acceptance remain unknown.",
    ],
    runs: results,
  };
  await mkdir("evals", { recursive: true });
  await writeFile(join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  await writeFile("evals/results-2026-09-22.json", JSON.stringify(summary, null, 2));
  await writeFile(
    "evals/cases.json",
    JSON.stringify(
      cases.map(({ source, ...c }) => c),
      null,
      2,
    ),
  );
  const headings = [
    "projectId",
    "setting",
    "status",
    "wallSeconds",
    "modelQuality",
    "observedEssentialOmissions",
    "openRouterUsd",
    "googleSpeechUsd",
    "independentAsrOverlapCandidateCount",
  ];
  const csv =
    [
      headings.join(","),
      ...results.map((r) =>
        [
          r.projectId,
          r.setting,
          r.status,
          "wallSeconds" in r ? r.wallSeconds : "",
          "modelQuality" in r ? r.modelQuality : "",
          r.observedEssentialOmissions ?? "",
          r.cost.openRouterUsd,
          r.cost.googleSpeechUsd,
          r.independentAsrOverlapCandidates?.length ?? "",
        ].join(","),
      ),
    ].join("\n") + "\n";
  await writeFile("evals/results-2026-09-22.csv", csv);
  console.log(
    JSON.stringify({
      runs: results.length,
      completed: summary.completed,
      failed: summary.failed,
      cost,
    }),
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
