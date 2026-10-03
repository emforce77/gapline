import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  audibleSpans,
  LOUDNESS_FRAME_SECONDS,
  SILENT_FRAME_DBFS,
  trimToAudible,
} from "../src/lib/pipeline/audible";
import { foldRun } from "../src/lib/pipeline/reduce";
import { findGaps } from "../src/lib/pipeline/gaps";
import { groupSegments, timeChunkWords, type RecognizeResponse } from "../src/lib/pipeline/hear";
import {
  analysisKey,
  readAnalysisParts,
  saveAnalysisPart,
  validateAnalysis,
} from "../src/lib/store/analysis";
import { projectDir, writeProject, type Project } from "../src/lib/store/projects";

const tokens = (
  words: { word: string; startOffset?: string; endOffset?: string }[],
  languageCode?: string,
): RecognizeResponse => ({
  results: [{ alternatives: [{ words }], ...(languageCode ? { languageCode } : {}) }],
});

describe("recognizer annotations", () => {
  // Chirp 3 responses measured 2026-10-03 on the QA corpus (languageCodes ["auto"]).
  it("takes '[ BACKGROUND]' out, timed or not, so a music-only chunk keeps all its room", () => {
    const untimed = timeChunkWords(tokens([{ word: "[" }, { word: "BACKGROUND]" }]), 0, 45.01);
    assert.deepEqual(untimed, { words: [], untimed: 0, annotations: ["[ BACKGROUND]"] });
    const timed = timeChunkWords(
      tokens([
        { word: "[", startOffset: "0s", endOffset: "0.600s" },
        { word: "BACKGROUND]", startOffset: "1.560s", endOffset: "1.720s" },
      ]),
      0,
      23.005,
    );
    assert.deepEqual(timed.words, []);
    // Reversed offsets inside an annotation do not matter either.
    const reversed = timeChunkWords(
      tokens([
        { word: "[", startOffset: "25.040s", endOffset: "2.040s" },
        { word: "BACKGROUND]", startOffset: "2.080s", endOffset: "2.120s" },
      ]),
      22.005,
      45.01,
    );
    assert.deepEqual(reversed.words, []);
    assert.deepEqual(findGaps({ speech: groupSegments(untimed.words), sounds: [] }, 45.01), [
      { id: "g1", start: 0, end: 45.01 },
    ]);
  });

  it("keeps the words around annotations, and drops tokens with no letter or digit", () => {
    const { words, untimed, annotations } = timeChunkWords(
      tokens([
        { word: "A" },
        { word: "day" },
        { word: "[" },
        { word: "SCREAM]" },
        { word: "A", startOffset: "1s", endOffset: "1.2s" },
        { word: "[[x]]", startOffset: "2s", endOffset: "2.2s" },
        // en-US on the same music (2026-10-03): a "[" never closed, before tokens kept as words.
        { word: "[", startOffset: "3s", endOffset: "3.1s" },
        { word: "1.7", startOffset: "3.1s", endOffset: "3.5s" },
        { word: "♪", startOffset: "4s", endOffset: "5s" },
        { word: "말", startOffset: "5s", endOffset: "5.3s" },
      ]),
      10,
      20,
    );
    assert.deepEqual(annotations, ["[ SCREAM]", "[[x]]", "[", "♪"]);
    assert.equal(untimed, 2);
    assert.deepEqual(
      words.map((w) => [w.start, w.end, w.word]),
      [
        [10, 11, "A day"],
        [11, 11.2, "A"],
        [13.1, 13.5, "1.7"],
        [15, 15.3, "말"],
      ],
    );
  });

  it("closes an annotation only inside its own result and within a few tokens", () => {
    // Chirp 3 left "prison. I'm [" unclosed (2026-10-03); the speech after it must stay speech.
    const { words, annotations } = timeChunkWords(
      {
        results: [
          {
            alternatives: [
              {
                words: [
                  { word: "prison.", startOffset: "0s", endOffset: "0.160s" },
                  { word: "I'm", startOffset: "4.480s", endOffset: "4.640s" },
                  { word: "[", startOffset: "4.680s", endOffset: "4.720s" },
                ],
              },
            ],
          },
          {
            alternatives: [
              {
                words: [
                  { word: "What", startOffset: "12.1s", endOffset: "12.4s" },
                  { word: "brings", startOffset: "12.4s", endOffset: "12.8s" },
                  { word: "you", startOffset: "12.8s", endOffset: "13.0s" },
                  { word: "here?", startOffset: "13.0s", endOffset: "14.3s" },
                ],
              },
            ],
          },
          { alternatives: [{ words: [{ word: "[" }, { word: "SCREAM]" }] }] },
        ],
      },
      0,
      30,
    );
    assert.deepEqual(annotations, ["[", "[ SCREAM]"]);
    assert.deepEqual(
      words.map((w) => w.word),
      ["prison.", "I'm", "What", "brings", "you", "here?"],
    );
    const far = timeChunkWords(
      tokens(["[", "we", "will", "go", "now]"].map((word) => ({ word }))),
      0,
      3,
    );
    assert.deepEqual(far.annotations, ["["]);
    assert.equal(far.words[0].word, "we will go now]");
  });

  it("leaves the real Korean untimed-word response as it was", async () => {
    const body = JSON.parse(
      await readFile(join(process.cwd(), "tests/fixtures/chirp3-untimed-words.json"), "utf8"),
    ) as RecognizeResponse;
    const { words, annotations } = timeChunkWords(body, 0, 40);
    assert.deepEqual(annotations, []);
    assert.deepEqual(words[0], { start: 0, end: 1.24, word: "어쩔 수 없고요.", untimed: true });
  });
});

describe("recognized language", () => {
  it("carries each result's language onto its words and segments, split where it changes", () => {
    const body: RecognizeResponse = {
      results: [
        {
          languageCode: "ko-kr",
          alternatives: [{ words: [{ word: "안녕", startOffset: "0s", endOffset: "0.5s" }] }],
        },
        {
          languageCode: "en-us",
          alternatives: [
            {
              words: [{ word: "hello", startOffset: "0.6s", endOffset: "1s" }, { word: "there" }],
            },
          ],
        },
      ],
    };
    const { words } = timeChunkWords(body, 0, 2);
    assert.deepEqual(
      words.map((w) => w.lang),
      ["ko-kr", "en-us", "en-us"],
    );
    const speech = groupSegments(words);
    assert.deepEqual(
      speech.map((s) => [s.text, s.lang]),
      [
        ["안녕", "ko-kr"],
        ["hello there", "en-us"],
      ],
    );
    assert.deepEqual(validateAnalysis({ speech }, 2).speech, speech, "stored with the analysis");
    assert.equal(
      groupSegments(timeChunkWords(tokens([{ word: "a" }]), 0, 1).words)[0].lang,
      undefined,
    );
  });
});

describe("audible audio", () => {
  const RATE = 16000;
  const frame = RATE * LOUDNESS_FRAME_SECONDS;
  /** One sample value per 50 ms frame. */
  const pcm = (levels: number[]) => {
    const out = new Float32Array(levels.length * frame);
    levels.forEach((level, i) => out.fill(level, i * frame, (i + 1) * frame));
    return out;
  };
  const quiet = 10 ** ((SILENT_FRAME_DBFS - 1) / 20);
  const audible = 10 ** ((SILENT_FRAME_DBFS + 1) / 20);

  it("finds where the soundtrack can be heard, and nothing in a silent one", () => {
    assert.deepEqual(audibleSpans(pcm([0, 0, quiet, 0]), RATE), []);
    assert.deepEqual(audibleSpans(new Float32Array(0), RATE), []);
    const spans = audibleSpans(pcm([0, audible, 0.5, 0, quiet, 0.1]), RATE);
    assert.deepEqual(
      spans.map((s) => [s.start, s.end]),
      [
        [0.05, 0.15],
        [0.25, 0.3],
      ],
    );
  });

  it("drops speech placed in digital silence and trims speech to its audible frames", () => {
    // en-tos-89s (QA 2026-10-03): the first pass put "What?" at 0–1.64 s, where every sample is
    // zero; the re-listen heard it at 1.39–2.67 s, and the sound starts at 2.2 s.
    const sound = [{ start: 2.2, end: 9 }];
    const { speech, dropped, shortened } = trimToAudible(
      [
        { start: 0, end: 1.64, speaker: "", text: "What?" },
        { start: 1.39, end: 2.67, speaker: "", text: "What?", heard: "relisten" },
        { start: 3, end: 4, speaker: "", text: "Kept as heard." },
      ],
      sound,
    );
    assert.equal(dropped, 1);
    assert.equal(shortened, 1);
    assert.deepEqual(speech, [
      { start: 2.2, end: 2.67, speaker: "", text: "What?", heard: "relisten" },
      { start: 3, end: 4, speaker: "", text: "Kept as heard." },
    ]);
    assert.deepEqual(findGaps({ speech, sounds: [] }, 9)[0], { id: "g1", start: 0, end: 1.95 });
  });

  it("never lengthens speech or removes audible speech", () => {
    const speech = [{ start: 1, end: 5, speaker: "", text: "a pause in the middle" }];
    const { speech: kept } = trimToAudible(speech, [
      { start: 0, end: 2 },
      { start: 4, end: 6 },
    ]);
    assert.deepEqual(kept, speech);
  });

  it("shows a silent soundtrack in the re-listen step", () => {
    const view = foldRun(
      [
        {
          type: "run_started",
          runId: "r",
          language: "en",
          density: "standard",
          writerModel: "m",
          reviewerModel: "m",
          clipSeconds: 20,
          t: 0,
        },
        {
          type: "relisten",
          gapsChecked: 0,
          wordsFound: 0,
          blockedSeconds: 0,
          soundless: true,
          t: 1,
        },
      ],
      20,
    );
    assert.deepEqual(view.relisten, {
      gapsChecked: 0,
      wordsFound: 0,
      blockedSeconds: 0,
      soundless: true,
    });
  });
});

describe("saved analysis of a sample", () => {
  it("is reused whatever its key and never replaced by a visitor's run", async () => {
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-sample-analysis-"));
    try {
      const sample: Project = {
        id: "sample-test",
        title: "fixture",
        kind: "sample",
        clipSeconds: 5,
        filmLanguageCode: "en-US",
        attribution: "",
        license: "",
        createdAt: new Date().toISOString(),
        stripStepSeconds: 1,
      };
      await writeProject(sample);
      await writeFile(join(projectDir(sample.id), "clip.mp4"), "source");
      const curated = [{ start: 1, end: 2, text: "curated", speaker: "" }];
      const speechFile = join(projectDir(sample.id), "analysis-speech.json");
      const saved = JSON.stringify({ key: "an-older-version", data: curated });
      await writeFile(speechFile, saved);
      const key = await analysisKey(sample, "fixture");
      assert.deepEqual(await readAnalysisParts(sample, key), { speech: curated });
      await saveAnalysisPart(sample, key, {
        speech: [{ start: 3, end: 4, text: "a visitor's run", speaker: "" }],
      });
      assert.equal(await readFile(speechFile, "utf8"), saved);
      // Seeding: a sample without a saved part gets one from its first run.
      const scene = {
        shots: [{ start: 0, end: 5, setting: "room", action: "waits", onScreenText: "" }],
        characters: [],
        sounds: [],
      };
      await saveAnalysisPart(sample, key, { scene });
      assert.deepEqual(await readAnalysisParts(sample, "any-key"), { speech: curated, scene });
      // An upload with the same files is heard again under a new key.
      const upload = { ...sample, kind: "upload" as const };
      assert.deepEqual(await readAnalysisParts(upload, "an-older-version"), {});
    } finally {
      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
    }
  });
});

describe("saved analysis of an upload after a change to hearing", () => {
  it("hears it again but keeps its scene map", async () => {
    const previous = process.env.DATA_DIR;
    process.env.DATA_DIR = await mkdtemp(join(tmpdir(), "scene-upload-analysis-"));
    try {
      const upload: Project = {
        id: "upload-test",
        title: "fixture",
        kind: "upload",
        clipSeconds: 5,
        filmLanguageCode: "en-US",
        attribution: "",
        license: "",
        createdAt: new Date().toISOString(),
        stripStepSeconds: 1,
      };
      await writeProject(upload);
      await writeFile(join(projectDir(upload.id), "clip.mp4"), "source");
      const key = await analysisKey(upload, "fixture");
      // Both parts as the previous version saved them: under the analysis key alone.
      const oldSpeech = [{ start: 1, end: 2, text: "[ BACKGROUND]", speaker: "" }];
      const scene = {
        shots: [{ start: 0, end: 5, setting: "room", action: "waits", onScreenText: "" }],
        characters: [],
        sounds: [],
      };
      for (const [kind, data] of [
        ["speech", oldSpeech],
        ["scene", scene],
      ] as const)
        await writeFile(
          join(projectDir(upload.id), `analysis-${kind}.json`),
          JSON.stringify({ key, data }),
        );
      assert.deepEqual(await readAnalysisParts(upload, key), { scene });
      const speech = [{ start: 1, end: 2, text: "hello", speaker: "" }];
      await saveAnalysisPart(upload, key, { speech });
      assert.deepEqual(await readAnalysisParts(upload, key), { speech, scene });
    } finally {
      if (previous === undefined) delete process.env.DATA_DIR;
      else process.env.DATA_DIR = previous;
    }
  });
});
