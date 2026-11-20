/** Build-time only. Render the recorded screening's download with the workspace's report writer. */
import { lineReviewReport } from "../../src/lib/runs/review-report";
import { readProject, readRunSnapshot } from "../../src/lib/store/projects";

async function main() {
  const [language, runId] = process.argv.slice(2);
  if (language !== "en" && language !== "ko") throw new Error("Expected en or ko");
  const project = await readProject("tos-opening");
  const { status, events } = await readRunSnapshot(project.id, runId);
  const start = events.find((event) => event.type === "run_started");
  const done = events.find((event) => event.type === "run_done");
  if (status !== "done" || !start || !done || start.language !== language) {
    throw new Error(`Incomplete public ${language} run: ${runId}`);
  }
  process.stdout.write(lineReviewReport(project.title, start, done, language));
}
void main();
