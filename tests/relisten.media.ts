import assert from "node:assert/strict";
import { it } from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCallRecords } from "../src/lib/llm/ledger";
import { runFfmpeg } from "../src/lib/media/ffmpeg";
import { analyzeClip, type StageRunner } from "../src/lib/pipeline/analyze";
import type { RunEvent } from "../src/lib/pipeline/events";
import { findGaps } from "../src/lib/pipeline/gaps";
import { RELISTEN_LEDGER_LABEL } from "../src/lib/pipeline/relisten";
import type { AnalysisParts } from "../src/lib/store/analysis";
import { withFetch } from "./with-fetch";

const CLIP_SECONDS = 20;
/** The recognizer's audio: mono 16 kHz, 16-bit once decoded. */
const STT_SAMPLE_RATE = 16000;

/** Seconds of audio in a FLAC request body, by decoding it (a piped FLAC declares no duration). */
async function flacSeconds(dir: string, base64: string, n: number): Promise<number> {
  const file = join(dir, `request-${n}.flac`);
  await writeFile(file, Buffer.from(base64, "base64"));
  const { stdout } = await runFfmpeg(["-i", file, "-f", "s16le", "-ac", "1", "pipe:1"]);
  return stdout.length / 2 / STT_SAMPLE_RATE;
}

const words = (list: [string, number, number][], billed: number) =>
  Response.json({
    results: [
      {
        alternatives: [
          {
            words: list.map(([word, start, end]) => ({
              word,
              startOffset: `${start}s`,
              endOffset: `${end}s`,
            })),
          },
        ],
      },
    ],
    metadata: { totalBilledDuration: `${billed}s` },
  });

it("hears the clip, then each silence again as its own slice with the same request", async () => {
  const dir = await mkdtemp(join(tmpdir(), "scene-relisten-media-"));
  const clipFile = join(dir, "clip.mp4");
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=64x36:r=5:d=${CLIP_SECONDS}`,
    "-f",
    "lavfi",
    "-i",
    `sine=frequency=220:sample_rate=48000:duration=${CLIP_SECONDS}`,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-t",
    String(CLIP_SECONDS),
    clipFile,
  ]);
  const requests: { url: string; config: unknown; seconds: number }[] = [];
  let sent = 0;
  // Silences from speech alone: 0–2.07, 4.21–6.59 and 9.17–20, each padded by 0.5 s.
  const handler = async (url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body));
    // Slices arrive concurrently: each request gets its own file name before any await.
    const seconds = await flacSeconds(dir, body.content, sent++);
    requests.push({ url, config: body.config, seconds });
    if (Math.abs(seconds - CLIP_SECONDS) < 0.05)
      // First pass: the launch call attached about 2 s early, as Chirp 3 did on Tears of Steel.
      return words(
        [
          ["We", 2.32, 2.6],
          ["have", 2.6, 2.84],
          ["main", 2.84, 3.2],
          ["engine", 3.2, 3.6],
          ["start.", 3.6, 3.96],
          ["4", 6.84, 7.2],
          ["3", 7.6, 8],
          ["2", 8.4, 8.92],
        ],
        CLIP_SECONDS,
      );
    if (Math.abs(seconds - (7.09 - 3.71)) < 0.05)
      return words(
        [
          ["We", 0.69, 0.93],
          ["have", 0.93, 1.13],
          ["main", 1.13, 1.49],
          ["engine", 1.49, 1.93],
          ["start.", 1.93, 2.45],
          ["4", 3.13, 3.38],
        ],
        4,
      );
    return words([], Math.ceil(seconds));
  };

  const stages: string[] = [];
  const stage: StageRunner = async (name, work) => {
    stages.push(`${name} started`);
    const result = await work();
    stages.push(`${name} done`);
    return result;
  };
  const events: RunEvent[] = [];
  const saved: AnalysisParts[] = [];
  const scene = { shots: [], characters: [], sounds: [] };
  const ledgerFile = join(dir, "ledger.jsonl");
  const { speech } = await withFetch(handler, () =>
    analyzeClip({
      clipFile,
      clipSeconds: CLIP_SECONDS,
      filmLanguageCode: "en-US",
      watchModel: "fixture",
      ledgerFile,
      videoDataUrl: Promise.resolve("data:video/mp4;base64,"),
      cached: { scene },
      onAnalysis: async (part) => {
        saved.push(part);
      },
      stage,
      emit: async (event) => {
        events.push(event);
      },
    }),
  );

  assert.deepEqual(stages, ["hear started", "hear done", "relisten started", "relisten done"]);
  assert.equal(requests.length, 4, "one whole-clip request, then one per silence");
  assert.ok(requests.every((r) => r.url === requests[0].url));
  assert.ok(requests.every((r) => JSON.stringify(r.config) === JSON.stringify(requests[0].config)));
  assert.deepEqual(requests[0].config, {
    autoDecodingConfig: {},
    model: "chirp_3",
    languageCodes: ["en-US"],
    features: { enableWordTimeOffsets: true },
  });
  const sliceSeconds = requests
    .slice(1)
    .map((r) => r.seconds)
    .sort((a, b) => a - b);
  for (const [actual, expected] of sliceSeconds.map((s, i) => [s, [2.57, 3.38, 11.33][i]]))
    assert.ok(Math.abs(actual - expected) < 0.05, `slice of ${actual} s, expected ${expected} s`);

  const found = speech.filter((s) => s.heard === "relisten");
  assert.equal(found.length, 1);
  assert.equal(found[0].text, "We have main engine start.");
  assert.ok(Math.abs(found[0].start - 4.4) < 1e-6 && Math.abs(found[0].end - 6.16) < 1e-6);
  assert.deepEqual(saved, [{ speech }], "the saved analysis includes the re-listen");
  assert.ok(
    findGaps({ speech, sounds: [] }, CLIP_SECONDS).every((g) => g.end <= 4.21 || g.start >= 6.59),
  );
  assert.deepEqual(
    events.find((e) => e.type === "relisten"),
    { type: "relisten", gapsChecked: 3, wordsFound: 5, blockedSeconds: 2.38 },
  );
  const calls = await readCallRecords(ledgerFile);
  assert.deepEqual(
    calls.map((c) => [c.label, c.billedSeconds]),
    [
      ["hear", CLIP_SECONDS],
      [RELISTEN_LEDGER_LABEL, 3 + 4 + 12],
    ],
  );
});
