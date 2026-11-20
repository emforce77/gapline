/** One attempt on the licensed English opening. Listen to the finished mix before publishing a case.
 * From repo root: node --env-file=.env.local --import tsx scripts/demo/oneshot-baseline.ts --cap-usd 0.20
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { callStructuredOnce } from "../../src/lib/llm/gemini";
import { readCallRecords } from "../../src/lib/llm/ledger";
import { mixDescribedFilm } from "../../src/lib/media/mix";
import { buildNarrationTrack, trimSilence } from "../../src/lib/media/narration-track";
import { watchingVideoFor } from "../../src/lib/media/proxies";
import { MODELS, reasoningEffort } from "../../src/lib/models";
import { renderTranscript } from "../../src/lib/pipeline/context";
import { synthesizeLine, TTS_USD_PER_CHARACTER } from "../../src/lib/pipeline/voice";
import type { EditBase } from "../../src/lib/runs/edit-track";
import { newRunBudget, withRunBudget, type Reservation } from "../../src/lib/runs/budget";
import { dataDir, projectDir, runDir } from "../../src/lib/store/projects";

async function main() {
  const { values } = parseArgs({ options: { "cap-usd": { type: "string" } } });
  const limit = Number(values["cap-usd"]);
  if (!(limit > 0 && limit <= 0.2)) throw new Error("Specify --cap-usd in (0, 0.20]");
  const project = "tos-opening";
  const sourceRun = "20260928t064307205-en-standard-221ceb";
  const clip = join(projectDir(project), "clip.mp4");
  const script: EditBase = JSON.parse(
    await readFile(join(runDir(project, sourceRun), "script.json"), "utf8"),
  );
  const duration = script.summary.clipSeconds;
  const video = await watchingVideoFor(clip);
  const parent = join(dataDir(), "measure");
  const output = join(parent, "oneshot-baseline");
  await mkdir(parent, { recursive: true });
  // Exclusive directory also prevents repeating a paid take after a partial failure.
  await mkdir(output);
  await writeFile(
    join(output, "oneshot-baseline.started"),
    JSON.stringify({ started: new Date().toISOString(), cap: limit }),
    { flag: "wx" },
  );
  const ledgerFile = join(output, "ledger.jsonl");
  const reservation: Reservation = {
    id: "oneshot-baseline",
    date: new Date().toISOString().slice(0, 10),
    scope: "experiment",
    amount: limit,
  };
  const budget = newRunBudget(reservation, limit);
  await withRunBudget(
    reservation,
    async () => {
      const { data } = await callStructuredOnce({
        model: MODELS.flash,
        temperature: 0.5,
        reasoningEffort: reasoningEffort("write"),
        label: "oneshot-baseline",
        ledgerFile,
        schemaName: "narration",
        system:
          "Write English audio descriptions that fit between the dialogue. Give each line and its start time in seconds.",
        user: [
          {
            type: "video_url",
            video_url: { url: "data:video/mp4;base64," + video.toString("base64") },
          },
          { type: "text", text: renderTranscript(script.speech) },
        ],
        schema: z.object({
          lines: z.array(
            z.object({ start: z.number().nonnegative(), text: z.string().trim().min(1) }),
          ),
        }),
        // The normal 65,536-token output alone can cost more than the entire $0.20 experiment.
        maxOutputTokens: 32_768,
      });
      await writeFile(join(output, "script.json"), JSON.stringify({ sourceRun, ...data }, null, 2));
      const voicePrice = data.lines.reduce(
        (sum, l) => sum + [...l.text].length * TTS_USD_PER_CHARACTER,
        0,
      );
      if (budget.spent + voicePrice > limit)
        throw new Error("The unedited script cannot be voiced within the remaining allowance");
      const lines = [];
      const spans = [];
      for (const [index, draft] of data.lines.entries()) {
        const take = await synthesizeLine({
          language: "en",
          text: draft.text,
          speakingRate: 1,
          label: "baseline-voice:" + (index + 1),
          ledgerFile,
        });
        await writeFile(join(output, `line-${index + 1}.wav`), take.wav);
        const line = trimSilence(take.wav);
        lines.push({ start: draft.start, line });
        if (draft.start < duration)
          spans.push({ ...draft, end: Math.min(duration, draft.start + line.seconds) });
      }
      const raw = join(output, "narration.raw.wav");
      await writeFile(raw, buildNarrationTrack(lines, duration, 24_000));
      await mixDescribedFilm({
        clipFile: clip,
        rawNarrationWav: raw,
        spans,
        language: "en",
        narrationWav: join(output, "narration.wav"),
        describedMp4: join(output, "described.mp4"),
      });
      await readCallRecords(ledgerFile);
      await writeFile(join(output, "timings.json"), JSON.stringify({ sourceRun, spans }, null, 2));
    },
    budget,
  );
  console.log(output, await readCallRecords(ledgerFile));
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
