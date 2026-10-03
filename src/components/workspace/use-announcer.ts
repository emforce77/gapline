"use client";

import { useEffect, useRef, useState } from "react";

/** Updates closer together than this are announced as one: the last of them. */
const SETTLE_MS = 1_200;

/** The timer functions an announcer uses (the window's; tests pass their own). */
export interface AnnouncerTimers {
  set: (run: () => void, ms: number) => number;
  clear: (id: number) => void;
}

/**
 * Says texts through `say`. `announce(text)` says it now; with `settle`, it waits until no other
 * update has come for SETTLE_MS, so a burst of stage changes (one stage ends as the next starts, a
 * few milliseconds apart) is said once, as where the run is now. Any newer text replaces a waiting one.
 */
export function createAnnouncer(say: (text: string) => void, timers: AnnouncerTimers) {
  let waiting: number | null = null;
  const cancel = () => {
    if (waiting !== null) timers.clear(waiting);
    waiting = null;
  };
  const announce = (text: string, settle = false) => {
    cancel();
    if (!settle) {
      say(text);
      return;
    }
    waiting = timers.set(() => {
      waiting = null;
      say(text);
    }, SETTLE_MS);
  };
  return { announce, cancel };
}

/** The text of the page's polite live region, and `announce` (createAnnouncer) to change it. */
export function useAnnouncer(): {
  announcement: string;
  announce: (text: string, settle?: boolean) => void;
} {
  const [announcement, setAnnouncement] = useState("");
  const announcer = useRef<ReturnType<typeof createAnnouncer> | null>(null);
  announcer.current ??= createAnnouncer(setAnnouncement, {
    set: (run, ms) => window.setTimeout(run, ms),
    clear: (id) => window.clearTimeout(id),
  });
  const { announce, cancel } = announcer.current;
  useEffect(() => cancel, [cancel]);
  return { announcement, announce };
}
