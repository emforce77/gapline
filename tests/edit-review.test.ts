import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { encodeWav } from "../src/lib/media/narration-track";
import { watchingCopyFile } from "../src/lib/media/proxies";
import type { ClipContext } from "../src/lib/pipeline/context";
import { LINE_SPACING_SECONDS } from "../src/lib/pipeline/cues";
import type { RunSummary, TimedRunEvent } from "../src/lib/pipeline/events";
import type { Cue, Verdict } from "../src/lib/pipeline/schemas";
import {
  reviewEditorLine,
  shipLines,
  withLineVerdict,
  writeEditedRun,
  type EditedRun,
  type FinalReview,
} from "../src/lib/runs/edit-track";
import { projectDir, runDir, type Project } from "../src/lib/store/projects";

interface RequestBody {
  contents: { parts: { text?: string }[] }[];
  generationConfig: { thinkingConfig?: { thinkingLevel: string } };
}

/** A stubbed Gemini API answering every call with `answer`; returns what it was sent. No cost. */
async function withGemini(answer: unknown, fn: () => Promise<void>): Promise<RequestBody[]> {
  const original = globalThis.fetch;
  const keys = { gemini: process.env.GEMINI_API_KEY, google: process.env.GOOGLE_API_KEY };
  delete process.env.GOOGLE_API_KEY;
  process.env.GEMINI_API_KEY = "fixture";
  const bodies: RequestBody[] = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)) as RequestBody);
    const chunk = {
      candidates: [
        { content: { parts: [{ text: JSON.stringify(answer) }] }, finishReason: "STOP" },
      ],
    };
    return new Response(`data: ${JSON.stringify(chunk)}\n\n`, {
      headers: { "Content-Type": "text/event-stream" },
    });
  }) as typeof fetch;
  try {
    await fn();
    return bodies;
  } finally {
    globalThis.fetch = original;
    if (keys.gemini === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = keys.gemini;
    if (keys.google !== undefined) process.env.GOOGLE_API_KEY = keys.google;
  }
}

const line = (id: string, start: number, seconds: number, text: string, by = "write"): Cue => ({
  id,
  gapId: "g1",
  start,
  windowEnd: 0,
  status: "fits",
  seconds,
  audioFile: `voice/${id}.wav`,
  versions: [{ text, by: by as Cue["versions"][number]["by"], model: "fixture" }],
});

const CONTEXT: ClipContext = {
  language: "en",
  density: "standard",
  clipSeconds: 40,
  speech: [],
  scene: { shots: [], characters: [], sounds: [] },
  gaps: [{ id: "g1", start: 20, end: 36 }],
  videoDataUrl: "data:video/mp4;base64,",
};

describe("reviewing an editor's line", () => {
  // Sintel, QA round 3: "winged creatures" first, then the editor's "a small dragon".
  const track = () =>
    shipLines(
      [
        line("L3", 23.8, 2.6, "Winged creatures fly past ruined rooftops at sunset."),
        line("L4", 28.1, 2.2, "A small dragon lands beside her.", "human"),
        line("L5", 31.5, 2.0, "She reaches out a hand."),
      ],
      CONTEXT.gaps,
    );

  it("reviews that line alone, at re-review effort, with the rest of the track as context", async () => {
    const verdict = { cueId: "L4", pass: true, violations: [], fix: "" };
    let result: Verdict | undefined;
    const bodies = await withGemini({ verdicts: [verdict], missing: [] }, async () => {
      result = await reviewEditorLine({
        context: CONTEXT,
        ledgerFile: join(await mkdtemp(join(tmpdir(), "scene-edit-review-")), "l.jsonl"),
        shipped: track(),
        cueId: "L4",
      });
    });
    assert.deepEqual(result, verdict);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].generationConfig.thinkingConfig?.thinkingLevel, "medium");
    const prompt = bodies[0].contents[0].parts.map((p) => p.text ?? "").join("\n");
    assert.match(prompt, /Review only these lines:\n- L4 \[28\.100–30\.300 s\]: A small dragon/);
    assert.doesNotMatch(prompt, /- L[35] \[/, "the other lines are context, not under review");
    assert.match(prompt, /- L3 at 23\.800 s: Winged creatures/);
    assert.match(prompt, /- L5 at 31\.500 s: She reaches out/);
    assert.doesNotMatch(prompt, /FINAL OUTPUT AUDIT/);
    // The editor's words are judged against the picture, not against the line's old words.
    assert.match(prompt, /L4 is an editor's own wording\. Judge it against the picture/);
  });

  it("returns the line's own verdict; what the track misses is not asked of an edit", async () => {
    const failing = {
      cueId: "L4",
      pass: false,
      violations: [{ rule: "naming", quote: "dragon", reason: "x" }],
      fix: "y",
    };
    let result: Verdict | undefined;
    await withGemini(
      { verdicts: [failing], missing: [{ gapId: "g1", at: 21, what: "a sign" }] },
      async () => {
        result = await reviewEditorLine({
          context: CONTEXT,
          ledgerFile: join(await mkdtemp(join(tmpdir(), "scene-edit-review-")), "l.jsonl"),
          shipped: track(),
          cueId: "L4",
        });
      },
    );
    assert.deepEqual(result, failing);
  });

  it("brings the parent's final check up to date with the line's verdict", () => {
    const parent: FinalReview = {
      verdicts: [
        { cueId: "L3", pass: true, violations: [], fix: "" },
        {
          cueId: "L4",
          pass: false,
          violations: [{ rule: "naming", quote: "x", reason: "x" }],
          fix: "",
        },
      ],
      missing: [{ gapId: "g1", at: 34, what: "the title card" }],
    };
    const verdict = { cueId: "L4", pass: true, violations: [], fix: "" };
    assert.deepEqual(withLineVerdict(parent, verdict), {
      verdicts: [parent.verdicts[0], verdict],
      missing: parent.missing,
    });
    assert.deepEqual(withLineVerdict(undefined, verdict), { verdicts: [verdict], missing: [] });
  });
});

describe("an edited result's line windows", () => {
  it("end a moment before the next line, never before the line's own voice ends", () => {
    const shipped = shipLines(
      [
        line("L1", 20, 2, "a"),
        // An editor's line may run up to the next start (its placement bounds end there).
        line("L2", 25, 2.95, "b", "human"),
        line("L3", 28, 3, "c"),
        { ...line("L4", 32, 1, "d"), status: "removed" },
      ],
      [{ id: "g1", start: 20, end: 36 }],
    );
    assert.deepEqual(
      shipped.map((c) => [c.id, c.windowEnd]),
      [
        ["L1", 25 - LINE_SPACING_SECONDS],
        ["L2", 27.95],
        ["L3", 36],
      ],
    );
  });
});

describe("what an edit reviews before it writes its result", () => {
  // A local data folder with the clip and its watching copy already beside it, so nothing runs
  // ffmpeg before the review; ffmpeg is pointed at a missing file, so a mix fails instead of running.
  const env = { data: process.env.DATA_DIR, ffmpeg: process.env.FFMPEG_PATH };
  const PROJECT = "edit-review-fixture";
  const SAMPLE_RATE = 24000;
  let root = "";
  before(async () => {
    root = await mkdtemp(join(tmpdir(), "scene-edit-run-"));
    process.env.DATA_DIR = root;
    process.env.FFMPEG_PATH = join(root, "no-ffmpeg");
    await mkdir(projectDir(PROJECT), { recursive: true });
    const clip = join(projectDir(PROJECT), "clip.mp4");
    await writeFile(clip, "clip");
    await writeFile(await watchingCopyFile(clip), "watching copy");
  });
  after(() => {
    for (const [name, value] of [
      ["DATA_DIR", env.data],
      ["FFMPEG_PATH", env.ffmpeg],
    ] as const)
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
  });

  const silence = (seconds: number) => new Int16Array(Math.round(seconds * SAMPLE_RATE));
  const PARENT = [
    line("L3", 23.8, 2.6, "Winged creatures fly past ruined rooftops at sunset."),
    line("L4", 28.1, 2.2, "Exhaust pours from the thrusters."),
    line("L5", 31.5, 2.0, "She reaches out a hand."),
  ];

  async function edit(cues: Cue[], revoiced?: EditedRun["revoiced"]): Promise<EditedRun> {
    const runId = revoiced ? "edit-rewrite" : "edit-remove";
    const dir = runDir(PROJECT, runId);
    await mkdir(join(dir, "voice"), { recursive: true });
    return {
      projectId: PROJECT,
      project: { id: PROJECT, clipSeconds: CONTEXT.clipSeconds } as Project,
      base: {
        runId: "parent",
        cues: PARENT,
        gaps: CONTEXT.gaps,
        scene: CONTEXT.scene,
        speech: [],
        summary: { finalReview: { verdicts: [], missing: [] } } as unknown as RunSummary,
      },
      baseRunId: "parent",
      first: { type: "run_started", language: "en", density: "standard" } as Extract<
        TimedRunEvent,
        { type: "run_started" }
      >,
      runId,
      dir,
      ledgerFile: join(dir, "ledger.jsonl"),
      started: Date.now(),
      cues,
      audio: new Map(
        PARENT.map((c) => [c.id, encodeWav(silence(c.seconds!), SAMPLE_RATE)] as const),
      ),
      revoiced,
      humanEdit: { cueId: "L4", before: "", after: "", from: 28.1, to: 28.1, at: "fixture" },
    };
  }

  const prompt = (body: RequestBody) => body.contents[0].parts.map((p) => p.text ?? "").join("\n");

  it("refuses an editor's line after reviewing that line alone, before any file is written", async () => {
    const cues = structuredClone(PARENT);
    cues[1].versions.push({
      text: "A small dragon lands beside her.",
      by: "human",
      model: "human",
    });
    const run = await edit(cues, {
      cueId: "L4",
      line: { pcm: silence(2.2), sampleRate: SAMPLE_RATE, seconds: 2.2 },
    });
    const failing = {
      cueId: "L4",
      pass: false,
      violations: [{ rule: "naming", quote: "dragon", reason: "x" }],
      fix: "",
    };
    let judged: Verdict | undefined;
    const bodies = await withGemini({ verdicts: [failing], missing: [] }, async () => {
      await assert.rejects(
        writeEditedRun(run, (verdict) => {
          judged = verdict;
          throw new Error("refused");
        }),
        /refused/,
      );
    });
    assert.deepEqual(judged, failing);
    assert.equal(bodies.length, 1);
    assert.equal(bodies[0].generationConfig.thinkingConfig?.thinkingLevel, "medium");
    assert.match(prompt(bodies[0]), /Review only these lines:\n- L4 \[/);
    assert.doesNotMatch(prompt(bodies[0]), /FINAL OUTPUT AUDIT/);
    const written = await readdir(run.dir, { recursive: true });
    assert.deepEqual(
      written.filter((f) => f !== "ledger.jsonl").sort(),
      ["voice"],
      "no voice, mix, captions or script before the line is accepted",
    );
  });

  it("checks the whole remaining track after a removal, and refuses nothing", async () => {
    const cues = structuredClone(PARENT);
    Object.assign(cues[1], { status: "removed", audioFile: undefined, seconds: undefined });
    const run = await edit(cues);
    let asked = false;
    const verdicts = ["L3", "L5"].map((cueId) => ({ cueId, pass: true, violations: [], fix: "" }));
    const bodies = await withGemini({ verdicts, missing: [] }, async () => {
      // The review passes; the mix then fails here only because ffmpeg is missing on purpose.
      await assert.rejects(
        writeEditedRun(run, () => {
          asked = true;
        }),
        (error: NodeJS.ErrnoException) =>
          error.code === "ENOENT" && error.path === process.env.FFMPEG_PATH,
      );
    });
    assert.equal(asked, false);
    assert.equal(bodies.length, 1);
    assert.match(prompt(bodies[0]), /FINAL OUTPUT AUDIT/);
    assert.match(prompt(bodies[0]), /- L3 \[23\.800/);
    assert.match(prompt(bodies[0]), /- L5 \[31\.500/);
    assert.doesNotMatch(prompt(bodies[0]), /- L4 \[/);
  });
});
