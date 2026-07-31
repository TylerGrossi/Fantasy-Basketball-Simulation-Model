"use client";

import { useEffect, useState } from "react";
import type { StatVector } from "./probability";

export type LiveState = "snapshot" | "live" | "error" | "frozen";

export interface LiveTotals {
  you: StatVector;
  opp: StatVector;
  state: LiveState;
  fetchedAt: string | null;
}

/**
 * The LIVE half of the data: current banked category totals, refreshed from ESPN.
 *
 * Starts from the build-time snapshot so the page is never blank and never shows a
 * spinner for its first paint, then swaps in live numbers. On failure it KEEPS the
 * snapshot rather than blanking — that is still real data, just older — and reports the
 * state so the UI can say which one you are looking at instead of quietly lying.
 *
 * 90s poll: box scores only move as games finish, and ESPN's own data lags anyway.
 */
export function useLiveTotals(
  period: number,
  teamId: number,
  snapshotYou: StatVector,
  snapshotOpp: StatVector,
  /**
   * Set false to freeze on the snapshot and never fetch (`?demo=1`).
   *
   * This matters for more than demos. The snapshot's `current` and `projMu` are a matched
   * pair describing one moment; fetching live totals replaces `current` but NOT the
   * projection, so against a hand-made or stale snapshot you can end up with an
   * impossible state — e.g. the FINAL score alongside games still to play — and every
   * downstream number becomes nonsense. Freezing keeps the pair consistent.
   */
  enabled = true,
  refreshMs = 90_000
): LiveTotals {
  const [you, setYou] = useState<StatVector>(snapshotYou);
  const [opp, setOpp] = useState<StatVector>(snapshotOpp);
  const [state, setState] = useState<LiveState>(enabled ? "snapshot" : "frozen");
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function refresh() {
      try {
        const res = await fetch(`/api/live?period=${period}&teamId=${teamId}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        if (!Array.isArray(data.you) || !Array.isArray(data.opp)) {
          throw new Error("malformed response");
        }
        setYou(data.you);
        setOpp(data.opp);
        setFetchedAt(new Date().toLocaleTimeString());
        setState("live");
      } catch {
        if (!cancelled) setState("error");
      }
    }

    refresh();
    const id = setInterval(refresh, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [period, teamId, refreshMs, enabled]);

  return { you, opp, state, fetchedAt };
}
