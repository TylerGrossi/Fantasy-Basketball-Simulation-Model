"use client";

import { useEffect, useState } from "react";
import type { StatVector } from "./probability";
import type { BoxLine } from "./loadLeague";

export type LiveState = "snapshot" | "live" | "error" | "frozen";

export interface LiveTotals {
  /** Banked totals INCLUDING games in progress — what ESPN's scoreboard shows. */
  you: StatVector;
  opp: StatVector;
  state: LiveState;
  fetchedAt: string | null;
  /** Live per-player matchup lines (Box Score). Null until the first fetch lands. */
  youLines: BoxLine[] | null;
  oppLines: BoxLine[] | null;
  /**
   * Players with a game played today. The models take those games out of the projection
   * (lib/liveAdjust.ts) so live totals + projection count each game once. Null until the
   * first fetch lands.
   */
  youPlayed: string[] | null;
  oppPlayed: string[] | null;
  /**
   * Share of each NBA team's game today still to play (1 = not started, 0 = final), keyed
   * by `PlayerRow.nbaTeam`. Lets the models take an in-progress game only PARTLY out of
   * the projection. Null until the first fetch, or if ESPN's NBA scoreboard failed.
   */
  gameLeft: Record<string, number> | null;
  /** Every matchup this period, live (League Home's scores). Null until the first fetch. */
  games: LiveGame[] | null;
}

/** One matchup's live totals, from the same request. */
export interface LiveGame {
  homeId: number;
  awayId: number;
  home: StatVector;
  away: StatVector;
  homePlayedToday: string[];
  awayPlayedToday: string[];
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
  const [extra, setExtra] = useState<{
    youLines: BoxLine[] | null;
    oppLines: BoxLine[] | null;
    youPlayed: string[] | null;
    oppPlayed: string[] | null;
    gameLeft: Record<string, number> | null;
    games: LiveGame[] | null;
  }>({
    youLines: null,
    oppLines: null,
    youPlayed: null,
    oppPlayed: null,
    gameLeft: null,
    games: null,
  });

  useEffect(() => {
    if (!enabled) return;
    // Every component on the page that asks for the same matchup shares ONE poller (see
    // `subscribe`): the Current Matchup page mounts four of them, which used to mean
    // four identical ESPN round trips every 90 seconds.
    return subscribe(`${period}-${teamId}`, period, teamId, refreshMs, (r) => {
      if (r.ok) {
        setYou(r.you);
        setOpp(r.opp);
        setExtra({
          youLines: r.youLines,
          oppLines: r.oppLines,
          youPlayed: r.youPlayed,
          oppPlayed: r.oppPlayed,
          gameLeft: r.gameLeft,
          games: r.games,
        });
        setFetchedAt(r.fetchedAt);
        setState("live");
      } else {
        setState("error");
      }
    });
  }, [period, teamId, refreshMs, enabled]);

  return { you, opp, state, fetchedAt, ...extra };
}

/* ------------------------------------------------------------ shared poller */

type LiveResult =
  | {
      ok: true;
      you: StatVector;
      opp: StatVector;
      youLines: BoxLine[] | null;
      oppLines: BoxLine[] | null;
      youPlayed: string[] | null;
      oppPlayed: string[] | null;
      gameLeft: Record<string, number> | null;
      games: LiveGame[] | null;
      fetchedAt: string;
    }
  | { ok: false };

interface Poller {
  listeners: Set<(r: LiveResult) => void>;
  last: LiveResult | null;
  timer: ReturnType<typeof setInterval>;
}

const pollers = new Map<string, Poller>();

/**
 * Join (or start) the poller for one matchup. The first subscriber starts the fetch loop,
 * later ones get the latest result immediately and every result after; the loop stops
 * when the last one unmounts. Returns the unsubscribe.
 */
function subscribe(
  key: string,
  period: number,
  teamId: number,
  refreshMs: number,
  listener: (r: LiveResult) => void
): () => void {
  let p = pollers.get(key);
  if (!p) {
    const poller: Poller = { listeners: new Set(), last: null, timer: 0 as never };
    const refresh = async () => {
      let r: LiveResult;
      try {
        const res = await fetch(`/api/live?period=${period}&teamId=${teamId}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data.you) || !Array.isArray(data.opp)) {
          throw new Error("malformed response");
        }
        r = {
          ok: true,
          you: data.you,
          opp: data.opp,
          // Null when an older deploy of the route does not send them.
          youLines: Array.isArray(data.youLines) ? data.youLines : null,
          oppLines: Array.isArray(data.oppLines) ? data.oppLines : null,
          youPlayed: Array.isArray(data.youPlayedToday) ? data.youPlayedToday : null,
          oppPlayed: Array.isArray(data.oppPlayedToday) ? data.oppPlayedToday : null,
          gameLeft:
            data.gameLeft && typeof data.gameLeft === "object" ? data.gameLeft : null,
          games: Array.isArray(data.games) ? data.games : null,
          fetchedAt: new Date().toLocaleTimeString(),
        };
      } catch {
        r = { ok: false };
      }
      poller.last = r;
      poller.listeners.forEach((l) => l(r));
    };
    poller.timer = setInterval(refresh, refreshMs);
    pollers.set(key, poller);
    p = poller;
    void refresh();
  } else if (p.last) {
    listener(p.last);
  }
  p.listeners.add(listener);
  const mine = p;
  return () => {
    mine.listeners.delete(listener);
    if (mine.listeners.size === 0) {
      clearInterval(mine.timer);
      pollers.delete(key);
    }
  };
}
