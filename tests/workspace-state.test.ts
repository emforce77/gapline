import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { fill } from "../src/i18n";
import { en, type Dictionary } from "../src/i18n/en";
import { ko } from "../src/i18n/ko";
import type { ActiveRun } from "../src/lib/api-contract";
import { refusedStartMessage, runErrorMessage } from "../src/lib/client/api-errors";
import {
  fetchFinishedRun,
  fetchRunList,
  findStartedRun,
  retryTransient,
  RunRequestError,
} from "../src/lib/client/run-stream";
import type { RunSummary, TimedRunEvent } from "../src/lib/pipeline/events";
import { emptyRun } from "../src/lib/pipeline/reduce";
import type { Cue } from "../src/lib/pipeline/schemas";
import type { RunListing } from "../src/lib/store/projects";
import { noteFromScript, orderRuns, runLabel } from "../src/components/workspace/labels";
import {
  isOlderSnapshot,
  listingFromView,
  runClockSeconds,
  shownRun,
} from "../src/components/workspace/run-choice";

const summary = (parentRunId?: string) => ({ parentRunId }) as RunSummary;
/** A run listing; every listing on the live bucket can carry the same file time after a copy. */
const run = (runId: string, language = "en", parentRunId?: string): RunListing => ({
  runId,
  language,
  density: "standard",
  summary: summary(parentRunId),
  createdAt: "2026-10-03T04:40:18.000Z",
});
const noWait = async () => {};

const original = global.fetch;
afterEach(() => {
  global.fetch = original;
});
/** Answers each fetch with the next of `answers`, recording the URLs asked for. */
function stubFetch(answers: (() => Response)[]): string[] {
  const asked: string[] = [];
  global.fetch = (async (url: string | URL | Request) => {
    asked.push(String(url));
    const next = answers.shift();
    if (!next) throw new Error(`unexpected fetch ${String(url)}`);
    return next();
  }) as typeof fetch;
  return asked;
}
const rateExceeded = () =>
  new Response("Rate exceeded.", { status: 429, headers: { "content-type": "text/plain" } });

describe("which result a narration language opens on", () => {
  const runs = [
    run("20260921t082401167-en-standard"),
    run("20260928t064307205-en-standard-221ceb"),
    run("edit-6c4d", "ko", "20260923t065852164-ko-standard-350b05"),
    run("20260922t051536291-ko-standard-d88b71", "ko"),
    run("20260923t065852164-ko-standard-350b05", "ko"),
    run("20260923t070742966-ko-standard-bca29a", "ko"),
  ];
  const pins = {
    en: "20260928t064307205-en-standard-221ceb",
    ko: "20260923t065852164-ko-standard-350b05",
  };

  it("opens the pinned run, not the first one listed, when the toggle reaches a language", () => {
    const korean = shownRun(runs, { language: "ko", density: "standard" }, {}, pins);
    assert.equal(korean?.runId, pins.ko);
  });

  it("keeps the version chosen for a language when the viewer comes back to it", () => {
    const chosen = { "ko/standard": "20260922t051536291-ko-standard-d88b71" };
    assert.equal(
      shownRun(runs, { language: "ko", density: "standard" }, chosen, pins)?.runId,
      chosen["ko/standard"],
    );
    assert.equal(
      shownRun(runs, { language: "en", density: "standard" }, chosen, pins)?.runId,
      pins.en,
    );
  });

  it("falls back to the newest original by its start time when nothing is pinned", () => {
    const shown = shownRun(runs, { language: "ko", density: "standard" }, {}, {});
    assert.equal(shown?.runId, "20260923t070742966-ko-standard-bca29a");
    assert.equal(shownRun(runs, { language: "ko", density: "brief" }, {}, pins), null);
  });

  it("lists versions newest first, each original followed by its edits", () => {
    assert.deepEqual(
      orderRuns(runs.filter((r) => r.language === "ko")).map((r) => r.runId),
      [
        "20260923t070742966-ko-standard-bca29a",
        "20260923t065852164-ko-standard-350b05",
        "edit-6c4d",
        "20260922t051536291-ko-standard-d88b71",
      ],
    );
  });
});

describe("following a run by polling", () => {
  const events = (n: number) =>
    Array.from({ length: n }, (_, t) => ({ type: "stage", t }) as unknown as TimedRunEvent);

  it("ignores a lagging snapshot with fewer events, or one that is running after done", () => {
    assert.equal(
      isOlderSnapshot({ events: 12, done: false }, { events: events(9), status: "running" }),
      true,
    );
    assert.equal(
      isOlderSnapshot({ events: 12, done: false }, { events: events(12), status: "running" }),
      false,
    );
    assert.equal(
      isOlderSnapshot({ events: 12, done: false }, { events: events(14), status: "done" }),
      false,
    );
    assert.equal(
      isOlderSnapshot({ events: 14, done: true }, { events: events(14), status: "running" }),
      true,
    );
  });

  it("lists a run it watched finish, even before the run list has it", () => {
    const watched = {
      ...emptyRun(12),
      runId: "20261003t080000000-en-standard-aaaaaa",
      language: "en" as const,
      density: "standard" as const,
      summary: { cuesShipped: 3 } as RunSummary,
    };
    assert.deepEqual(listingFromView(watched, "2026-10-03T08:02:00.000Z"), {
      runId: watched.runId,
      language: "en",
      density: "standard",
      summary: watched.summary,
      createdAt: "2026-10-03T08:02:00.000Z",
    });
    assert.equal(listingFromView(emptyRun(12), "2026-10-03T08:02:00.000Z"), null);
  });

  it("counts a followed run's time from its start, not from its last event", () => {
    const started = Date.parse("2026-10-03T08:00:00.000Z");
    // Reloaded 90 s in; the last event was logged at 40 s and just arrived.
    const anchor = { wall: started + 90_000, t: 40 };
    assert.equal(runClockSeconds(anchor, started + 95_000, "2026-10-03T08:00:00.000Z"), 95);
    assert.equal(runClockSeconds(anchor, started + 95_000, null), 45);
    // A streamed run's events are current: its start time adds nothing.
    const streamed = { wall: started + 30_000, t: 30 };
    assert.equal(runClockSeconds(streamed, started + 31_000, "2026-10-03T08:00:02.000Z"), 31);
  });
});

describe("reads that meet a busy server", () => {
  it("retries Cloud Run's plain-text 429 and returns the answer that follows", async () => {
    const asked = stubFetch([
      rateExceeded,
      () => Response.json({ runs: [run("r1")], active: [], edits: [] }),
    ]);
    const list = await retryTransient(() => fetchRunList("tos-opening"), [1, 1], noWait);
    assert.deepEqual(
      list.runs.map((r) => r.runId),
      ["r1"],
    );
    assert.equal(asked.length, 2);
  });

  it("does not retry a refusal that would repeat, and keeps its status", async () => {
    stubFetch([() => Response.json({ error: "not_found" }, { status: 404 })]);
    await assert.rejects(
      retryTransient(() => fetchRunList("tos-opening"), [1, 1], noWait),
      (e: unknown) => e instanceof RunRequestError && e.status === 404 && !e.transient,
    );
  });

  it("reads a listed run again while a lagging instance still calls it running", async () => {
    const done = [{ type: "run_done", t: 9 }] as unknown as TimedRunEvent[];
    stubFetch([
      () => Response.json({ events: [], status: "running" }),
      rateExceeded,
      () => Response.json({ events: done, status: "done" }),
    ]);
    assert.deepEqual(await fetchFinishedRun("tos-opening", "r1", [0], [0], noWait), done);
  });

  it("encodes the run id into the path", async () => {
    const asked = stubFetch([() => Response.json({ events: [], status: "done" })]);
    await fetchFinishedRun("tos-opening", "../x", [], [], noWait);
    assert.equal(asked[0], "/api/projects/tos-opening/runs/..%2Fx");
  });
});

describe("a start whose answer was lost", () => {
  const active = (runId: string, language: "en" | "ko" = "en"): ActiveRun => ({
    runId,
    language,
    density: "standard",
    startedAt: "2026-10-03T08:00:00.000Z",
    lastEventAt: "2026-10-03T08:00:01.000Z",
  });
  const body = { language: "en", density: "standard" } as const;

  it("finds the run it started, not one that was already going", async () => {
    const answers = [
      () => Promise.reject(new TypeError("Failed to fetch")),
      () => Promise.resolve({ active: [active("old")] }),
      () => Promise.resolve({ active: [active("old"), active("new")] }),
    ];
    const found = await findStartedRun(
      () => answers.shift()!(),
      body,
      new Set(["old"]),
      [0, 0, 0],
      noWait,
    );
    assert.equal(found?.runId, "new");
  });

  it("says it did not start only when no new run with its settings appears", async () => {
    const found = await findStartedRun(
      async () => ({ active: [active("other-language", "ko")] }),
      body,
      new Set(),
      [0, 0],
      noWait,
    );
    assert.equal(found, null);
  });
});

describe("refused starts", () => {
  it("calls Cloud Run's own 429 busy, not a stopped run", () => {
    const busy = new RunRequestError(429, {});
    assert.equal(refusedStartMessage(busy, en, "en"), en.live.errors.server_busy);
    assert.equal(refusedStartMessage(new RunRequestError(404, {}), en, "en"), en.live.notStarted);
    assert.equal(
      refusedStartMessage(new RunRequestError(429, { error: "visitor_busy" }), ko, "ko"),
      ko.live.errors.visitor_busy,
    );
  });

  it("names when a visitor's daily share renews", () => {
    const now = Date.UTC(2026, 8, 23, 3, 0);
    const message = runErrorMessage(
      { code: "visitor_daily", resetAt: "2026-09-24T00:00:00.000Z" },
      en,
      "en",
      null,
      now,
    );
    assert.ok(message.startsWith(en.live.errors.visitor_daily), message);
    assert.match(message, /in 21 hours/);
  });
});

describe("version labels", () => {
  const cue = (id: string, start: number, versions: Cue["versions"]): Cue =>
    ({ id, start, windowEnd: start + 3, gapId: "G1", status: "fits", versions }) as Cue;
  const voiced = {
    voice: { seconds: 1, rate: 1 },
    review: { cueId: "L1", pass: true, violations: [], fix: "" },
  };

  // The shape of edit-2153556e on the live sample (qa2/verify-version-labels): same words, new start.
  it("calls an edit that kept the words and changed the start a move, with its save time", () => {
    const note = noteFromScript({
      cues: [
        cue("L1", 2.5, [
          { text: "A door opens.", by: "write", model: "m", ...voiced },
          { text: "A door opens.", by: "human", model: "human", ...voiced },
        ]),
      ],
      humanEdits: [
        {
          cueId: "L1",
          before: "A door opens.",
          after: "A door opens.",
          from: 2.1,
          to: 2.5,
          at: "2026-10-03T07:45:00.000Z",
        },
      ],
    });
    assert.deepEqual(note, { line: 1, kind: "moved", at: "2026-10-03T07:45:00.000Z" });
  });

  it("tells two edits of the same line apart by their save time, once mounted", () => {
    const base = run("20260928t064307205-en-standard-221ceb");
    const runs = [base, run("edit-a", "en", base.runId), run("edit-b", "en", base.runId)];
    const notes = {
      "edit-a": { line: 1, kind: "changed" as const, at: "2026-10-03T07:45:00.000Z" },
      "edit-b": { line: 1, kind: "changed" as const, at: "2026-10-03T07:52:00.000Z" },
    };
    const a = runLabel(runs[1], runs, notes["edit-a"], en, "en", true, notes);
    const b = runLabel(runs[2], runs, notes["edit-b"], en, "en", true, notes);
    assert.match(a, /^Edit 1 · Line 1 changed · /);
    assert.notEqual(a, b);
    const lone = { "edit-a": notes["edit-a"] };
    assert.equal(
      runLabel(runs[1], runs, notes["edit-a"], en, "en", true, lone),
      "Edit 1 · Line 1 changed",
    );
  });

  it("leaves the time of day out of what the server renders (its locale data differs)", () => {
    const runs = [
      run("20260922t051536291-ko-standard-d88b71", "ko"),
      run("20260922t052256151-ko-standard-da3a89", "ko"),
    ];
    assert.equal(runLabel(runs[0], runs, undefined, ko, "ko", false), "자동 생성 · 9월 22일");
    assert.equal(runLabel(runs[0], runs, undefined, en, "en", false), "Generated · Sep 22");
    assert.notEqual(
      runLabel(runs[0], runs, undefined, en, "en", true),
      runLabel(runs[1], runs, undefined, en, "en", true),
    );
  });
});

describe("workspace copy", () => {
  const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

  it("gives both catalogs the same placeholders in every new or changed sentence", () => {
    const pick = (t: Dictionary) => [
      t.live.active,
      t.live.littleRoom,
      t.live.confirming,
      t.live.editPending,
      t.live.editStopped,
      t.live.editUnknown,
      t.live.savedNotListed,
      t.live.errors.server_busy,
      t.live.errors.visitor_busy,
      t.live.errors.visitor_daily,
      t.live.errors.run_active,
      t.workspace.liveNote,
      t.workspace.newVersion,
      t.workspace.loadingRun,
      t.workspace.runFinished,
      t.workspace.runFinishedEmpty,
      t.workspace.replayFinished,
      t.workspace.noRunHintHere,
      t.versions.moved,
      t.versions.basedOnMoved,
    ];
    const english = pick(en);
    const korean = pick(ko);
    english.forEach((text, i) =>
      assert.deepEqual(placeholders(korean[i]), placeholders(text), text),
    );
    assert.deepEqual(placeholders(en.live.littleRoom), ["needed", "pause", "room"]);
  });

  it("quotes the measured typical time, not ten minutes, for a live run", () => {
    assert.match(en.workspace.liveNote, /usually takes 2–6 minutes/);
    assert.match(
      en.workspace.liveNote,
      /Your current result keeps playing until the new one is ready\.$/,
    );
    assert.doesNotMatch(en.landing.uploadIntro, /10 minutes|up to 10\b/);
    assert.doesNotMatch(en.live.errors.budget_busy, /one at a time/);
    for (const t of [en, ko]) assert.doesNotMatch(t.live.status.budget_daily, /sample|샘플/);
  });

  it("announces a finished run with its number of lines", () => {
    const lines = fill(en.editor.lines.other, { n: 5 });
    assert.equal(
      fill(en.workspace.runFinished, { lines }),
      "Finished: the described film has 5 lines. Press Play with description to hear it.",
    );
  });
});
