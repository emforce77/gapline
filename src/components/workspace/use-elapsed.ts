"use client";

import { useEffect, useState } from "react";

const TICK_MS = 1_000;

/**
 * Whole seconds since `running` turned true, ticking once a second; 0 while it is false. An edit or
 * a removal takes minutes, and a counter that moves says the request is still alive.
 */
export function useElapsedSeconds(running: boolean): number {
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (!running) {
      setSince(null);
      return;
    }
    const start = Date.now();
    setSince(start);
    setNow(start);
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, [running]);
  return since === null ? 0 : Math.floor((now - since) / TICK_MS);
}

/**
 * The edit request is one blocking POST, so the page tells its step from the usual timing. Measured
 * on 2026-10-03 (QA round 2, 43 edits of the sample): voicing and measuring a one-word edit took 1–3 s
 * (a 156-character line: 2.8 s of speech synthesis); the whole-track review after them had a median
 * of 42 s and a p90 of 84 s, and the mix about 5 s more. Seen from the page, the voicing step takes
 * longer: refusals for running long came 3.8 s after the click for 4.7 s of words and 5.9 s after it
 * for 9.0 s of words (fix round 3), so the page says "reviewing" only from 7 s. Saying "voicing" a few
 * seconds into the review costs less than announcing a review and then a voicing refusal.
 */
const VOICED_WITHIN_SECONDS = 7;
const LONG_REVIEW_SECONDS = 90;

/** What a removal (no voicing) is most likely doing after `elapsed` seconds. */
export function reviewStep(elapsed: number): "reviewing" | "long" {
  return elapsed < LONG_REVIEW_SECONDS ? "reviewing" : "long";
}

/** What an edit that re-voices its line is most likely doing after `elapsed` seconds. */
export function editStep(elapsed: number): "voicing" | "reviewing" | "long" {
  return elapsed < VOICED_WITHIN_SECONDS ? "voicing" : reviewStep(elapsed);
}
