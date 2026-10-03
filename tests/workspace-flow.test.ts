import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fill } from "../src/i18n";
import { en } from "../src/i18n/en";
import { ko } from "../src/i18n/ko";
import type { LiveStatus } from "../src/lib/api-contract";
import {
  liveStatusNotice,
  runErrorMessage,
  uploadStatusNotice,
} from "../src/lib/client/api-errors";
import { findSavedRun, RunRequestError } from "../src/lib/client/run-stream";
import { statusRecheckMs } from "../src/lib/client/use-live-run";
import { pendingEditStep } from "../src/lib/client/use-pending-edit";
import type { RunSummary, TimedRunEvent } from "../src/lib/pipeline/events";
import { emptyRun, type RunView } from "../src/lib/pipeline/reduce";
import type { RunListing } from "../src/lib/store/projects";
import {
  runFinishedAnnouncement,
  stageAnnouncement,
} from "../src/components/workspace/announcements";
import { listAfterRun } from "../src/components/workspace/run-choice";
import { createAnnouncer } from "../src/components/workspace/use-announcer";

const NOW = Date.parse("2026-10-03T12:00:00Z");
const RESET = "2026-10-04T00:00:00.000Z";
const status = (over: Partial<LiveStatus>): LiveStatus => ({
  canStart: false,
  reason: null,
  visitor: null,
  resetAt: RESET,
  ...over,
});
const listing = (runId: string): RunListing => ({
  runId,
  language: "en",
  density: "standard",
  summary: {} as RunSummary,
  createdAt: "2026-10-03T04:40:18.000Z",
});
const noWait = async () => {};

describe("asking again whether a run can start", () => {
  it("does not ask while a run can start", () => {
    assert.equal(statusRecheckMs(status({ canStart: true }), 0, false, NOW), null);
  });

  it("asks at the renewal (plus a grace) for the shared allowance or the visitor's share", () => {
    const twelveHours = 12 * 3_600_000;
    for (const over of [{ reason: "budget_daily" }, { visitor: "visitor_daily" }] as const) {
      assert.equal(statusRecheckMs(status(over), 0, false, NOW), twelveHours + 5_000);
      // Even while following a run of its own: the renewal is not something a run's end changes.
      assert.equal(statusRecheckMs(status(over), 3, true, NOW), twelveHours + 5_000);
    }
  });

  it("asks soon after a first busy answer, then less often, and not while following its own run", () => {
    // A run of this page that just ended holds its visitor busy until its charge is settled.
    const busy = status({ visitor: "visitor_busy" });
    assert.equal(statusRecheckMs(busy, 0, false, NOW), 3_000);
    assert.equal(statusRecheckMs(busy, 1, false, NOW), 15_000);
    assert.equal(statusRecheckMs(busy, 9, false, NOW), 15_000);
    assert.equal(statusRecheckMs(busy, 0, true, NOW), null);
    assert.equal(statusRecheckMs(status({ reason: "budget_busy" }), 0, false, NOW), 3_000);
  });
});

describe("what the workspace says when a run cannot start", () => {
  it("says nothing when one can", () => {
    assert.equal(liveStatusNotice(status({ canStart: true }), en, "en", NOW), null);
  });

  it("names the visitor's own limit, with the renewal for the daily share", () => {
    for (const t of [en, ko]) {
      const lang = t === en ? "en" : "ko";
      assert.equal(
        liveStatusNotice(status({ visitor: "visitor_busy" }), t, lang, NOW),
        t.live.status.visitor_busy,
      );
      const daily = liveStatusNotice(status({ visitor: "visitor_daily" }), t, lang, NOW)!;
      assert.ok(daily.startsWith(t.live.status.visitor_daily), daily);
      assert.ok(daily.length > t.live.status.visitor_daily.length, "renewal time missing");
    }
  });

  it("puts the shared allowance first when both refuse", () => {
    const both = status({ reason: "budget_busy", visitor: "visitor_busy" });
    assert.equal(liveStatusNotice(both, en, "en", NOW), en.live.status.budget_busy);
  });

  it("keeps the no-answer message neutral: an edit sent offline made no check of new runs", () => {
    // The start's own message after it looked for a new run is a separate sentence.
    assert.equal(runErrorMessage({ code: "connection" }, en, "en"), en.live.errors.connection);
    assert.notEqual(en.live.errors.connection, en.live.notStartedChecked);
    assert.notEqual(ko.live.errors.connection, ko.live.notStartedChecked);
  });
});

describe("what the upload card says when a run cannot start", () => {
  it("says nothing when one can", () => {
    assert.equal(uploadStatusNotice(status({ canStart: true }), en, "en", NOW), null);
  });

  it("names the visitor's own limit in the workspace's words, renewal included", () => {
    for (const t of [en, ko]) {
      const lang = t === en ? "en" : "ko";
      for (const visitor of ["visitor_busy", "visitor_daily"] as const) {
        const refused = status({ visitor });
        const notice = uploadStatusNotice(refused, t, lang, NOW);
        assert.ok(notice, visitor);
        assert.equal(notice, liveStatusNotice(refused, t, lang, NOW));
        assert.ok(notice.startsWith(t.live.status[visitor]), notice);
      }
    }
  });

  it("keeps its own words for the shared allowance, first when both refuse", () => {
    const both = status({ reason: "budget_busy", visitor: "visitor_daily" });
    assert.equal(uploadStatusNotice(both, en, "en", NOW), en.upload.status.budget_busy);
    const daily = uploadStatusNotice(status({ reason: "budget_daily" }), ko, "ko", NOW)!;
    assert.ok(daily.startsWith(ko.upload.status.budget_daily), daily);
  });
});

describe("the run list after a followed run finished", () => {
  const watched: RunView = {
    ...emptyRun(65),
    runId: "new",
    language: "en",
    density: "standard",
    summary: {} as RunSummary,
  };

  it("uses the refreshed list when it has the run", () => {
    const list = [listing("new"), listing("old")];
    assert.deepEqual(listAfterRun(list, [listing("old")], "new", watched, "x"), {
      runs: list,
      finished: list[0],
    });
  });

  it("adds a run the page watched finish when the list lags or did not load", () => {
    for (const list of [[listing("old")], null]) {
      const after = listAfterRun(list, [listing("old")], "new", watched, "2026-10-03T12:00:00Z");
      assert.equal(after.finished?.runId, "new");
      assert.deepEqual(
        after.runs.map((r) => r.runId),
        ["new", "old"],
      );
    }
  });

  it("finds nothing for a run neither the list nor the page has", () => {
    const after = listAfterRun(null, [listing("old")], "other", watched, "x");
    assert.equal(after.finished, null);
    assert.deepEqual(
      after.runs.map((r) => r.runId),
      ["old"],
    );
  });
});

describe("opening an edit's saved result", () => {
  it("uses the save's own listing without reading the list again", async () => {
    const read = async () => assert.fail("read the list again");
    const found = await findSavedRun("edit-1", [listing("edit-1")], read, [0, 10], noWait);
    assert.equal(found?.saved.runId, "edit-1");
  });

  it("reads again until the list has it, counting a failed read as not listed yet", async () => {
    const answers: (() => RunListing[])[] = [
      () => [listing("base")],
      () => {
        throw new Error("503");
      },
      () => [listing("edit-1"), listing("base")],
    ];
    const found = await findSavedRun(
      "edit-1",
      undefined,
      async () => answers.shift()!(),
      [0, 10, 20, 40],
      noWait,
    );
    assert.equal(found?.saved.runId, "edit-1");
    assert.equal(answers.length, 0);
  });

  it("never opens another version in its place", async () => {
    const found = await findSavedRun(
      "edit-1",
      [listing("base")],
      async () => [listing("base"), listing("edit-0")],
      [0, 10],
      noWait,
    );
    assert.equal(found, null);
  });
});

describe("following an edit found after a reload", () => {
  const failed = { type: "run_failed", code: "voice_failed", t: 9 } as unknown as TimedRunEvent;

  it("checks again while it runs, opens it when saved, and stops with its code when it fails", () => {
    assert.deepEqual(pendingEditStep({ events: [], status: "running" }, 3), {
      next: "check",
      failures: 0,
    });
    assert.deepEqual(pendingEditStep({ events: [], status: "done" }, 0), { next: "saved" });
    assert.deepEqual(pendingEditStep({ events: [failed], status: "failed" }, 0), {
      next: "ended",
      code: "voice_failed",
    });
    assert.deepEqual(pendingEditStep({ events: [], status: "interrupted" }, 0), {
      next: "ended",
      code: null,
    });
  });

  it("gives up on a run the server no longer knows, or after about a minute without answers", () => {
    const gone = new RunRequestError(404, { error: "not_found" });
    assert.deepEqual(pendingEditStep({ error: gone }, 0), { next: "ended", code: null });
    const busy = new RunRequestError(503, {});
    assert.deepEqual(pendingEditStep({ error: busy }, 10), { next: "check", failures: 11 });
    assert.deepEqual(pendingEditStep({ error: busy }, 11), { next: "ended", code: null });
  });
});

describe("the live region", () => {
  /** Timers that run only when `flush` says so, recording what was said. */
  function fakeAnnouncer() {
    const said: string[] = [];
    const due = new Map<number, () => void>();
    let next = 0;
    const announcer = createAnnouncer((text) => said.push(text), {
      set: (run) => {
        next += 1;
        due.set(next, run);
        return next;
      },
      clear: (id) => due.delete(id),
    });
    const flush = () => {
      for (const [id, run] of [...due]) {
        due.delete(id);
        run();
      }
    };
    return { said, flush, ...announcer };
  }

  it("says a burst of stage updates once, as the last of them", () => {
    const a = fakeAnnouncer();
    a.announce("Hear: done", true);
    a.announce("Re-check silences and Watch: working", true);
    assert.deepEqual(a.said, []);
    a.flush();
    assert.deepEqual(a.said, ["Re-check silences and Watch: working"]);
  });

  it("says an immediate text at once and drops the update waiting before it", () => {
    const a = fakeAnnouncer();
    a.announce("Write: working", true);
    a.announce("Write: stopped");
    a.flush();
    assert.deepEqual(a.said, ["Write: stopped"]);
  });
});

describe("what a live run's stages announce", () => {
  const view = (states: Partial<Record<string, string>>, over: Partial<RunView> = {}): RunView => {
    const base = emptyRun(65);
    const stages = { ...base.stages };
    for (const [id, state] of Object.entries(states))
      stages[id as keyof typeof stages] = { ...stages[id as keyof typeof stages], state } as never;
    return { ...base, ...over, stages };
  };

  it("names stages working at once together, after a moment", () => {
    assert.deepEqual(
      stageAnnouncement(view({ hear: "done", relisten: "running", watch: "running" }), en, "en"),
      { text: "Re-check silences and Watch: working", settle: true },
    );
    assert.deepEqual(stageAnnouncement(view({ hear: "done" }), en, "en"), {
      text: "Hear: done",
      settle: true,
    });
  });

  it("says where a run stopped at once, and nothing while a lost run is checked on", () => {
    assert.deepEqual(stageAnnouncement(view({ hear: "done", write: "stopped" }), en, "en"), {
      text: "Write: stopped",
      settle: false,
    });
    assert.equal(stageAnnouncement(view({ hear: "done", watch: "lost" }), en, "en"), null);
    assert.equal(stageAnnouncement(view({}), en, "en"), null);
  });

  it("leaves a finished run's end to its result sentence", () => {
    const finished = view({ mix: "done" }, { summary: { cuesShipped: 7 } as RunSummary });
    assert.equal(stageAnnouncement(finished, en, "en"), null);
    assert.equal(
      runFinishedAnnouncement(finished, en),
      fill(en.workspace.runFinished, { lines: "7\u00a0lines" }),
    );
    const empty = view({ mix: "done" }, { summary: { cuesShipped: 0 } as RunSummary });
    assert.equal(runFinishedAnnouncement(empty, en), en.workspace.runFinishedEmpty);
  });
});
