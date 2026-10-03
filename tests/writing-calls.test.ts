import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, mock } from "node:test";
import type { ClipContext } from "../src/lib/pipeline/context";
import { watchClip } from "../src/lib/pipeline/watch";
import { reviseLines } from "../src/lib/pipeline/write";

/**
 * Runs `fn` against a stubbed Gemini API that answers every call with `answer`, and returns the
 * request bodies it was sent. No network, no cost: the stages' own code runs on a known answer.
 */
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

interface RequestBody {
  contents: { parts: { text?: string }[] }[];
}
const promptText = (body: RequestBody) =>
  body.contents[0].parts
    .map((p) => p.text ?? "")
    .join("\n")
    .replace(/\s+/g, " ");

const ledgerFile = async () =>
  join(await mkdtemp(join(tmpdir(), "scene-writing-calls-")), "l.jsonl");
const VIDEO = "data:video/mp4;base64,";

describe("watching a clip", () => {
  const answer = (sounds: unknown[]) => ({
    shots: [
      { start: 0, end: 60, setting: "a meadow", action: "a rabbit stands", onScreenText: "" },
    ],
    characters: [],
    sounds,
  });

  // QA 2026-10-03: over the silent Big Buck Bunny cut, Watch listed an "ominous orchestral chord"
  // marked protect, which took 3.25 s of narration room.
  it("drops a sound the model lists over a silent soundtrack, and says where it is silent", async () => {
    const warn = mock.method(console, "warn", () => {});
    let scene: Awaited<ReturnType<typeof watchClip>> | undefined;
    try {
      const bodies = await withGemini(
        answer([{ start: 57, end: 60, label: "ominous orchestral chord", kind: "protect" }]),
        async () => {
          scene = await watchClip({
            videoDataUrl: VIDEO,
            clipSeconds: 60,
            audible: [],
            model: "fixture",
            ledgerFile: await ledgerFile(),
          });
        },
      );
      assert.deepEqual(scene!.sounds, []);
      assert.match(
        promptText(bodies[0]),
        /measured silent at 0\.0–60\.0 s: there is no sound there/,
      );
      assert.match(
        String(warn.mock.calls[0]?.arguments[0]),
        /dropped 1 sound\(s\) over measured silence/,
      );
    } finally {
      warn.mock.restore();
    }
  });

  it("keeps a sound the soundtrack has, and tells no silence when there is none", async () => {
    let scene: Awaited<ReturnType<typeof watchClip>> | undefined;
    const bodies = await withGemini(
      answer([{ start: 20, end: 20.5, label: "door slam", kind: "protect" }]),
      async () => {
        scene = await watchClip({
          videoDataUrl: VIDEO,
          clipSeconds: 60,
          audible: [{ start: 0, end: 60 }],
          model: "fixture",
          ledgerFile: await ledgerFile(),
        });
      },
    );
    assert.deepEqual(
      scene!.sounds.map((s) => s.label),
      ["door slam"],
    );
    assert.doesNotMatch(promptText(bodies[0]), /measured silent/);
  });
});

describe("revising lines", () => {
  const context: ClipContext = {
    language: "ko",
    density: "standard",
    clipSeconds: 65,
    speech: [],
    scene: { shots: [], characters: [], sounds: [] },
    gaps: [{ id: "g2", start: 11, end: 23 }],
    videoDataUrl: VIDEO,
  };

  // Run 790315 (Korean): shortening gave "로켓 발사." and "솟구친다.", both rejected as incomplete,
  // and the line was dropped after its last round.
  it("ask that a shorter line stay a complete sentence", async () => {
    let revisions: Map<string, string> | undefined;
    const bodies = await withGemini(
      { revisions: [{ cueId: "L6", text: "로켓이 솟는다." }], additions: [] },
      async () => {
        ({ revisions } = await reviseLines({
          context,
          model: "fixture",
          ledgerFile: await ledgerFile(),
          label: "shorten",
          requests: [
            {
              cue: {
                id: "L6",
                gapId: "g2",
                start: 17.6,
                windowEnd: 19,
                versions: [],
                status: "pending",
              },
              text: "공장 타워들이 늘어선 미래 도시 위로 로켓이 날아오른다.",
              violations: [],
              fix: "",
              maxUnits: 9,
            },
          ],
          otherLines: [],
        }));
      },
    );
    assert.equal(revisions!.get("L6"), "로켓이 솟는다.");
    const text = promptText(bodies[0]);
    assert.match(text, /A shorter line is still a complete sentence that names its subject/);
    assert.match(text, /only on-screen text may be read as a fragment/);
  });
});
