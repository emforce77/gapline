import { appendFile, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startRun } from "../src/lib/runs/start-run";
import { listRuns, runDir } from "../src/lib/store/projects";
import type { Language } from "../src/lib/pipeline/schemas";
import { readCallRecords } from "../src/lib/llm/ledger";
const root = "runtime/evaluation";
const journal = join(root, "runs.jsonl");
async function main() {
  const cases = JSON.parse(await readFile(join(root, "cases.json"), "utf8"));
  let rows: any[] = [];
  try {
    rows = (await readFile(journal, "utf8"))
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((s) => JSON.parse(s));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  // The first real upgrade run is the baseline opening case; count it against the twelve-run limit.
  if (!rows.length) {
    const run = (await listRuns("tos-opening")).find(
      (r) => r.runId === "20260922t051536291-ko-standard-d88b71",
    );
    if (!run) throw new Error("Opening smoke baseline is missing");
    const row = {
      projectId: "tos-opening",
      setting: "high",
      split: "development",
      runId: run.runId,
      summary: run.summary,
      status: "done",
      cold: true,
    };
    await appendFile(journal, JSON.stringify(row) + "\n");
    rows.push(row);
  }
  const split = process.argv[2] ?? "development";
  let failures = 0;
  const settings = process.argv[3] === "high" ? ["high"] : ["high", "medium"];
  for (const c of cases.filter((c: any) => c.split === split))
    for (const setting of settings) {
      if (rows.some((r) => r.projectId === c.id && r.setting === setting)) continue;
      if (rows.length >= 12) throw new Error("Twelve-run screening ceiling reached");
      process.env.SCENE_EFFORT_REVIEW = setting;
      let runId: string | undefined;
      const row: any = { projectId: c.id, setting, split, startedAt: new Date().toISOString() };
      try {
        await startRun({
          projectId: c.id,
          language: c.language as Language,
          density: "standard",
          budgetScope: "experiment",
          emit: (e) => {
            if (e.type === "run_started") runId = e.runId;
            if (e.type === "stage" && e.state === "done")
              console.log(c.id, setting, e.stage, e.seconds);
            if (e.type === "run_done") row.summary = e.summary;
          },
        });
        row.status = "done";
        failures = 0;
      } catch (e) {
        row.status = "failed";
        row.error = String(e);
        failures++;
      }
      row.runId = runId;
      if (runId) {
        const calls = await readCallRecords(join(runDir(c.id, runId), "ledger.jsonl")).catch(
          () => [],
        );
        row.openRouterUsd = calls
          .filter((c) => c.model.startsWith("google/"))
          .reduce((s, c) => s + c.costUsd, 0);
        row.googleSpeechUsd = calls
          .filter((c) => !c.model.startsWith("google/"))
          .reduce((s, c) => s + c.costUsd, 0);
      }
      await appendFile(journal, JSON.stringify(row) + "\n");
      rows.push(row);
      console.log(
        JSON.stringify({
          project: c.id,
          setting,
          status: row.status,
          quality: row.summary?.qualityStatus,
          error: row.error,
        }),
      );
      if (failures >= 2) throw new Error("Two consecutive failures: screening stopped");
    }
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
