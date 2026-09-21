/**
 * Runs one description for an existing project from the command line (same path as the web app).
 * Usage: npm run pipeline -- <projectId> <ko|en> [standard|brief]
 * Out:   <DATA_DIR>/projects/<projectId>/runs/<runId>/ and a printed summary.
 */
import { startRun } from "../src/lib/runs/start-run";
import type { Density, Language } from "../src/lib/pipeline/schemas";

async function main(): Promise<void> {
  const [projectId = "tos-opening", language = "ko", density = "standard"] = process.argv.slice(2);
  const { runId } = await startRun({
    projectId,
    language: language as Language,
    density: density as Density,
    emit: (event) => {
      if (event.type === "stage")
        console.log(`[${event.t.toFixed(1)}s] ${event.stage} ${event.state}`);
      if (event.type === "cue_reviewed" && !event.verdict.pass) {
        const found = event.verdict.violations.map((v) => `${v.rule} "${v.quote}"`).join("; ");
        console.log(`  ✗ ${event.cueId} r${event.round}: ${found}`);
      }
      if (event.type === "coverage") {
        console.log(
          `  + missing r${event.round}: ${event.missing.map((m) => `${m.gapId}@${m.at} ${m.what}`).join("; ")}`,
        );
      }
      if (event.type === "cue_voiced" && !event.fits)
        console.log(`  ⤓ ${event.cueId} ${event.seconds}s > ${event.window}s`);
      if (event.type === "cue_dropped") console.log(`  – ${event.cueId} dropped: ${event.reason}`);
      if (event.type === "run_done") {
        for (const cue of event.cues) {
          const v = cue.versions.at(-1)!;
          const voiced = cue.seconds ? ` ${cue.seconds}s@${cue.rate}` : "";
          console.log(
            `${cue.id} ${cue.start.toFixed(1)}–${cue.windowEnd.toFixed(1)} [${cue.status}${voiced}] v${cue.versions.length}: ${v.text}`,
          );
        }
        console.log(JSON.stringify(event.summary, null, 2));
      }
    },
  });
  console.log(`run: ${runId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
