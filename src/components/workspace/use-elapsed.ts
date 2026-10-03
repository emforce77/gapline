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
