/** Runs the watching stage once on a sample clip and prints the map, tokens and cost. */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { watchClip } from "../src/lib/pipeline/watch";
import { readCallRecords } from "../src/lib/llm/ledger";
import { MODELS } from "../src/lib/models";
import { probeDurationSeconds } from "../src/lib/media/ffmpeg";
import { encodeWatchingVideo } from "../src/lib/media/proxies";

async function main(): Promise<void> {
  const clipId = process.argv[2] ?? "tos-opening";
  const model = process.argv[3] ?? MODELS.flash;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await mkdir("runtime/measure", { recursive: true });
  const ledgerFile = `runtime/measure/watch-${clipId}-${stamp}.ledger.jsonl`;
  const clipFile = join("runtime/samples", clipId, "clip.mp4");
  const video = await encodeWatchingVideo(clipFile);
  const map = await watchClip({
    videoDataUrl: `data:video/mp4;base64,${video.toString("base64")}`,
    clipSeconds: await probeDurationSeconds(clipFile),
    model,
    ledgerFile,
  });
  await writeFile(`runtime/measure/watch-${clipId}-${stamp}.json`, JSON.stringify(map, null, 2));
  for (const s of map.shots)
    console.log(
      `${s.start.toFixed(1)}-${s.end.toFixed(1)} [${s.setting}] ${s.action}${s.onScreenText ? ` TEXT="${s.onScreenText}"` : ""}`,
    );
  for (const c of map.characters)
    console.log(`char ${c.id}: ${c.look} | name=${c.name} @${c.nameFirstSpokenAt}`);
  for (const s of map.sounds) console.log(`sound ${s.start}-${s.end} ${s.kind}: ${s.label}`);
  console.log(JSON.stringify(await readCallRecords(ledgerFile)));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
