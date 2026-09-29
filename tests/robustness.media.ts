import assert from "node:assert/strict";
import { it } from "node:test";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_UPLOAD_SECONDS } from "../src/lib/api-contract";
import { UploadError } from "../src/lib/errors";
import { readCallRecords } from "../src/lib/llm/ledger";
import { probeMedia, runFfmpeg } from "../src/lib/media/ffmpeg";
import type { TimedRunEvent } from "../src/lib/pipeline/events";
import { hearSpeech } from "../src/lib/pipeline/hear";
import { runDescription } from "../src/lib/pipeline/run";
import { createProject } from "../src/lib/store/ingest";
import { projectDir } from "../src/lib/store/projects";
import { withFetch } from "./with-fetch";

const SILENT_AUDIO = ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"];

async function missing(path: string): Promise<boolean> {
  return access(path).then(
    () => false,
    () => true,
  );
}

it("ingests silent, odd-sized and portrait clips; rejects long, audio-only and broken files without leftovers", async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-ingest-"));
  const src = await mkdtemp(join(tmpdir(), "scene-sources-"));
  const make = (name: string, args: string[]) => runFfmpeg(["-y", ...args, join(src, name)]);
  await make("silent.mp4", [
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=160x90:r=10:d=3",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
  ]);
  // FFV1 keeps odd sizes (853×480; 1179×2556 is an iPhone screen recording), which libx264 rejects.
  await make("odd.mkv", [
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=853x480:r=10:d=3,format=yuv444p",
    "-f",
    "lavfi",
    "-i",
    "sine=f=440:r=48000:d=3",
    "-c:v",
    "ffv1",
    "-c:a",
    "aac",
  ]);
  await make("portrait.mkv", [
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=1179x2556:r=5:d=2,format=yuv444p",
    ...SILENT_AUDIO,
    "-t",
    "2",
    "-c:v",
    "ffv1",
    "-c:a",
    "aac",
  ]);
  await make("long.mp4", [
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=64x36:r=1:d=95",
    ...SILENT_AUDIO,
    "-t",
    "95",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
  ]);
  await make("voice.m4a", ["-f", "lavfi", "-i", "sine=f=440:r=48000:d=3", "-c:a", "aac"]);
  await writeFile(join(src, "broken.mp4"), Buffer.from("this is not a video file".repeat(100)));
  // Streamed Matroska has no duration header, like a browser recording: only the transcode can tell.
  const { stdout } = await runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=gray:s=64x36:r=1:d=95",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-f",
    "matroska",
    "pipe:1",
  ]);
  await writeFile(join(src, "headerless.mkv"), stdout);
  assert.equal((await probeMedia(join(src, "headerless.mkv"))).durationSeconds, null);

  const ingest = (id: string, file: string) =>
    createProject({
      id,
      title: id,
      kind: "upload",
      sourceFile: join(src, file),
      alreadyNormalised: false,
      filmLanguageCode: "auto",
      attribution: "",
      license: "",
      ownerHash: "fixture",
    });

  const expected: Record<string, [number, number]> = {
    "silent.mp4": [160, 90],
    "odd.mkv": [852, 480],
    "portrait.mkv": [590, 1280],
  };
  for (const [file, [width, height]] of Object.entries(expected)) {
    const project = await ingest(`u-ok-${file.split(".")[0]}`, file);
    const clip = await probeMedia(join(projectDir(project.id), "clip.mp4"));
    assert.deepEqual([clip.width, clip.height], [width, height], file);
    assert.equal(clip.hasAudio, true, `${file} gets an audio track`);
    // The hear stage's extraction, which failed on clips without sound before.
    const flac = await runFfmpeg([
      "-i",
      join(projectDir(project.id), "clip.mp4"),
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-c:a",
      "flac",
      "-f",
      "flac",
      "pipe:1",
    ]);
    assert.ok(flac.stdout.length > 0);
  }

  const rejected: [string, UploadError["code"], number | undefined][] = [
    ["long.mp4", "too_long", 95],
    ["headerless.mkv", "too_long", undefined],
    ["voice.m4a", "no_video_stream", undefined],
    ["broken.mp4", "unreadable", undefined],
  ];
  for (const [file, code, seconds] of rejected) {
    const id = `u-bad-${file.split(".")[0]}`;
    await assert.rejects(ingest(id, file), (e: unknown) => {
      assert.ok(e instanceof UploadError, file);
      assert.equal(e.code, code, file);
      // A declared length is rejected by the probe, before any transcode.
      assert.equal(e.seconds === undefined ? undefined : Math.round(e.seconds), seconds, file);
      return true;
    });
    assert.ok(await missing(projectDir(id)), `${file} leaves no project folder`);
  }
  assert.equal(MAX_UPLOAD_SECONDS, 90);
});

it("hears clips whose recognizer returns untimed words, including across a chunk boundary", async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-hear-"));
  const dir = await mkdtemp(join(tmpdir(), "scene-hear-clips-"));
  const clip = async (seconds: number) => {
    const file = join(dir, `silence-${seconds}.mp4`);
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x36:r=1",
      ...SILENT_AUDIO,
      "-t",
      String(seconds),
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      file,
    ]);
    return file;
  };
  const fixture = await readFile(
    join(process.cwd(), "tests/fixtures/chirp3-untimed-words.json"),
    "utf8",
  );
  const ledgerFile = join(dir, "ledger.jsonl");
  const speech = await withFetch(
    async (url) => {
      assert.match(url, /us-speech\.googleapis\.com/);
      return new Response(fixture, { headers: { "Content-Type": "application/json" } });
    },
    async () =>
      hearSpeech({ clipFile: await clip(40), clipSeconds: 40, languageCode: "ko-KR", ledgerFile }),
  );
  assert.equal(speech[0].start, 0);
  assert.ok(speech.every((s) => s.end > s.start && s.end <= 40));
  assert.equal((await readCallRecords(ledgerFile))[0].untimedWords, 3);

  // Two chunks (0–55 s, 50–60 s). The later chunk opens with an untimed word before a word at 54 s;
  // the overlap up to 52.5 s belongs to the first chunk, so the blocked span is kept from there.
  const bodies: { size: number; resolve: (r: Response) => void }[] = [];
  const crossing = await withFetch(
    (_url, init) =>
      new Promise<Response>((resolve) => {
        bodies.push({ size: JSON.parse(String(init!.body)).content.length, resolve });
        if (bodies.length < 2) return;
        const [longer, shorter] = [...bodies].sort((a, b) => b.size - a.size);
        longer.resolve(Response.json({ results: [], metadata: { totalBilledDuration: "55s" } }));
        shorter.resolve(
          Response.json({
            results: [
              {
                alternatives: [
                  {
                    words: [
                      { word: "untimed" },
                      { word: "timed", startOffset: "4s", endOffset: "5s" },
                    ],
                  },
                ],
              },
            ],
            metadata: { totalBilledDuration: "10s" },
          }),
        );
      }),
    async () =>
      hearSpeech({
        clipFile: await clip(60),
        clipSeconds: 60,
        languageCode: "en-US",
        ledgerFile: join(dir, "ledger-2.jsonl"),
      }),
  );
  assert.deepEqual(crossing, [{ start: 52.5, end: 55, speaker: "", text: "untimed timed" }]);
});

it("reports a clip with little room, and a failed run by code only", async () => {
  process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-room-"));
  process.env.DAILY_BUDGET_USD = "5";
  const dir = join(process.env.DATA_DIR, "projects", "room-test");
  await mkdir(dir, { recursive: true });
  const clipFile = join(dir, "clip.mp4");
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=160x90:r=10:d=5",
    ...SILENT_AUDIO,
    "-t",
    "5",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    clipFile,
  ]);
  let writerStatus = 200;
  const llm = (data: unknown) =>
    new Response(
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 100, thoughtsTokenCount: 0, totalTokenCount: 200 } })}\n\n`,
    );
  const handler = async (url: string, init?: RequestInit) => {
    // Someone speaks from 0.1 s to 4.9 s: no silence long enough for a line.
    if (url.includes("us-speech.googleapis.com"))
      return Response.json({
        results: [
          {
            alternatives: [
              { words: [{ word: "talking", startOffset: "0.1s", endOffset: "4.9s" }] },
            ],
          },
        ],
        metadata: { totalBilledDuration: "5s" },
      });
    assert.equal(
      url,
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse",
    );
    const properties = JSON.parse(String(init!.body)).generationConfig.responseFormat.text.schema
      .properties;
    if (properties.shots)
      return llm({
        shots: [{ start: 0, end: 5, setting: "studio", action: "a man talks", onScreenText: "" }],
        characters: [],
        sounds: [],
      });
    if (properties.cues) {
      if (writerStatus !== 200)
        return new Response(
          JSON.stringify({ error: { message: "Insufficient credits (internal detail)" } }),
          { status: writerStatus },
        );
      return llm({ cues: [] });
    }
    return llm({ verdicts: [], missing: [] });
  };
  const common = {
    clipFile,
    clipSeconds: 5,
    filmLanguageCode: "en-US",
    language: "en" as const,
    density: "standard" as const,
    writerModel: "gemini-3.8-flash",
    reviewerModel: "gemini-3.8-flash",
  };
  const events: TimedRunEvent[] = [];
  const { summary } = await withFetch(handler, () =>
    runDescription({
      ...common,
      runId: "room-run",
      runDir: join(dir, "runs", "room-run"),
      emit: (e) => events.push(e),
    }),
  );
  const little = events.find((e) => e.type === "little_room");
  assert.deepEqual(little && { ...little, t: 0 }, {
    type: "little_room",
    gapSeconds: 0,
    thresholdSeconds: 3,
    gapCount: 0,
    t: 0,
  });
  assert.equal(summary.littleRoom, true);

  writerStatus = 402;
  const failed: TimedRunEvent[] = [];
  await withFetch(handler, () =>
    assert.rejects(
      runDescription({
        ...common,
        runId: "failed-run",
        runDir: join(dir, "runs", "failed-run"),
        emit: (e) => failed.push(e),
      }),
    ),
  );
  const last = failed.at(-1)!;
  assert.equal(last.type, "run_failed");
  assert.deepEqual(
    last.type === "run_failed" && { code: last.code, error: last.error, retryable: last.retryable },
    {
      code: "provider_failed",
      error: "provider_failed",
      retryable: false,
    },
  );
  const saved = await readFile(join(dir, "runs", "failed-run", "events.jsonl"), "utf8");
  assert.ok(!saved.includes("Insufficient credits"), "no provider text in stored events");
});
