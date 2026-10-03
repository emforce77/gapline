import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  pinRunInUrl,
  pinSettingInUrl,
  settingInParams,
  unpinRunInUrl,
} from "../src/lib/client/run-url";

/** The page's address and the history writes made to it, as a browser would keep them. */
function fakeWindow(href: string) {
  const writes: { state: unknown; url: string }[] = [];
  const location = new URL(href);
  const window = {
    location,
    history: {
      replaceState(state: unknown, _unused: string, url: string) {
        writes.push({ state, url });
        const next = new URL(url, location.href);
        location.search = next.search;
      },
    },
  };
  return { window, writes };
}

describe("the address of what the workspace shows", () => {
  const global = globalThis as unknown as { window?: unknown };
  let saved: unknown;
  beforeEach(() => {
    saved = global.window;
  });
  afterEach(() => {
    global.window = saved;
  });

  it("writes after the effects that asked, so Next's own history state is not wiped on mount", async () => {
    const { window, writes } = fakeWindow("https://gapline.test/p/tos-opening?run=gone");
    global.window = window;
    unpinRunInUrl();
    // Nothing yet: Next's router patches history in its own effect, which runs after the page's.
    assert.deepEqual(writes, []);
    await Promise.resolve();
    assert.deepEqual(writes, [{ state: null, url: "/p/tos-opening" }]);
  });

  it("applies two changes made in one turn, in order", async () => {
    const { window, writes } = fakeWindow("https://gapline.test/p/u-1?run=old");
    global.window = window;
    pinSettingInUrl({ language: "ko", density: "brief" });
    // Worked out from the address before the first write, this would drop the setting again.
    unpinRunInUrl();
    await Promise.resolve();
    assert.equal(writes.at(-1)?.url, "/p/u-1?narration=ko&density=brief");
  });

  it("names a setting without a result in place of the run, and a run in place of the setting", async () => {
    const { window, writes } = fakeWindow("https://gapline.test/p/u-1?run=old#top");
    global.window = window;
    pinSettingInUrl({ language: "ko", density: "standard" });
    await Promise.resolve();
    assert.equal(writes.at(-1)?.url, "/p/u-1?narration=ko&density=standard#top");
    pinRunInUrl("new-run");
    await Promise.resolve();
    assert.equal(writes.at(-1)?.url, "/p/u-1?run=new-run#top");
  });

  it("reads only a setting it could have written", () => {
    assert.deepEqual(settingInParams({ narration: "ko", density: "brief" }), {
      language: "ko",
      density: "brief",
    });
    assert.deepEqual(settingInParams({ narration: "fr", density: ["brief", "standard"] }), {});
    assert.deepEqual(settingInParams({ run: "x" }), {});
  });
});
