"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { StatVector } from "./probability";
import type { BoxLine } from "./loadLeague";
import type { PlayerRow } from "./league";

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
  /** Each side's lines for TODAY, with whether the lineup slot counts (Game Day). */
  youToday: TodayLine[] | null;
  oppToday: TodayLine[] | null;
  /**
   * Projection rows for players on today's roster the export has not got on that team yet
   * (a pickup since the last export). Applied with lib/liveAdjust.ts `liveRoster`.
   */
  youAdded: PlayerRow[] | null;
  oppAdded: PlayerRow[] | null;
}

/** One player's single-day line for today's scoring period. */
export interface TodayLine {
  name: string;
  playerId: number | null;
  /** ESPN's injury status now ("ACTIVE", "OUT", …). Absent from older deploys of the route. */
  status?: string;
  /** Expected return (YYYY-MM-DD) from ESPN's NBA injuries feed, when it has one. */
  returnDate?: string | null;
  /** In a lineup slot that counts — false on the bench or IR. */
  counted: boolean;
  /** ESPN's lineupSlotId today (0 PG … 11 UTIL, 12 Bench, 13 IR). Absent from older deploys. */
  slot?: number;
  /** ESPN's NBA event id. Empty before his game starts. */
  gameId: string;
  min: number;
  /** Today's totals in `stats` order. Null before his game starts (or with no game). */
  v: number[] | null;
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
  // A server page that already fetched this matchup (LiveSeed) hands the result down, so
  // the FIRST PAINT is live — no snapshot numbers flashing before the swap.
  const seedCtx = useContext(LiveSeedContext);
  const key = `${period}-${teamId}`;
  const seed = enabled && seedCtx?.key === key ? seedCtx.result : null;
  const [you, setYou] = useState<StatVector>(seed?.you ?? snapshotYou);
  const [opp, setOpp] = useState<StatVector>(seed?.opp ?? snapshotOpp);
  const [state, setState] = useState<LiveState>(
    !enabled ? "frozen" : seed ? "live" : "snapshot"
  );
  const [fetchedAt, setFetchedAt] = useState<string | null>(seed?.fetchedAt ?? null);
  const [extra, setExtra] = useState<{
    youLines: BoxLine[] | null;
    oppLines: BoxLine[] | null;
    youPlayed: string[] | null;
    oppPlayed: string[] | null;
    gameLeft: Record<string, number> | null;
    games: LiveGame[] | null;
    youToday: TodayLine[] | null;
    oppToday: TodayLine[] | null;
    youAdded: PlayerRow[] | null;
    oppAdded: PlayerRow[] | null;
  }>({
    youLines: seed?.youLines ?? null,
    oppLines: seed?.oppLines ?? null,
    youPlayed: seed?.youPlayed ?? null,
    oppPlayed: seed?.oppPlayed ?? null,
    gameLeft: seed?.gameLeft ?? null,
    games: seed?.games ?? null,
    youToday: seed?.youToday ?? null,
    oppToday: seed?.oppToday ?? null,
    youAdded: seed?.youAdded ?? null,
    oppAdded: seed?.oppAdded ?? null,
  });

  useEffect(() => {
    if (!enabled) return;
    // Every component on the page that asks for the same matchup shares ONE poller (see
    // `subscribe`): the Current Matchup page mounts four of them, which used to mean
    // four identical ESPN round trips every 90 seconds.
    return subscribe(key, period, teamId, refreshMs, seed, (r) => {
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
          youToday: r.youToday,
          oppToday: r.oppToday,
          youAdded: r.youAdded,
          oppAdded: r.oppAdded,
        });
        setFetchedAt(r.fetchedAt);
        setState("live");
      } else {
        setState("error");
      }
    });
    // `seed` is first-render data only; a new seed object must not restart the poller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, period, teamId, refreshMs, enabled]);

  return { you, opp, state, fetchedAt, ...extra };
}

/* ------------------------------------------------------------- server seed */

type LiveOk = Extract<LiveResult, { ok: true }>;

/**
 * A live result fetched by the SERVER while it rendered the page (lib/liveMatchup.ts
 * liveSeed), keyed to one matchup. Provided by components/LiveSeed.tsx.
 */
export const LiveSeedContext = createContext<{ key: string; result: LiveOk } | null>(null);

/** "7:42:05 PM" in Eastern — the same on the server and in the browser, so a seeded
 *  first paint hydrates to identical text. */
const clock = (iso: string | undefined) =>
  new Date(iso ?? Date.now()).toLocaleTimeString("en-US", { timeZone: "America/New_York" });

/**
 * `/api/live`'s JSON as the hook's result — one reading for the browser's poll and the
 * server's seed. Null when the payload is malformed.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toLiveResult(data: any): LiveOk | null {
  if (!Array.isArray(data?.you) || !Array.isArray(data?.opp)) return null;
  return {
    ok: true,
    you: data.you,
    opp: data.opp,
    // Null when an older deploy of the route does not send them.
    youLines: Array.isArray(data.youLines) ? data.youLines : null,
    oppLines: Array.isArray(data.oppLines) ? data.oppLines : null,
    youPlayed: Array.isArray(data.youPlayedToday) ? data.youPlayedToday : null,
    oppPlayed: Array.isArray(data.oppPlayedToday) ? data.oppPlayedToday : null,
    gameLeft: data.gameLeft && typeof data.gameLeft === "object" ? data.gameLeft : null,
    games: Array.isArray(data.games) ? data.games : null,
    youToday: Array.isArray(data.youToday) ? data.youToday : null,
    oppToday: Array.isArray(data.oppToday) ? data.oppToday : null,
    youAdded: Array.isArray(data.youAdded) ? data.youAdded : null,
    oppAdded: Array.isArray(data.oppAdded) ? data.oppAdded : null,
    fetchedAt: clock(data.fetchedAt),
  };
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
      youToday: TodayLine[] | null;
      oppToday: TodayLine[] | null;
      youAdded: PlayerRow[] | null;
      oppAdded: PlayerRow[] | null;
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
  /** The server's seed, when the page had one: the loop starts from it instead of a fetch. */
  primed: LiveResult | null,
  listener: (r: LiveResult) => void
): () => void {
  let p = pollers.get(key);
  if (!p) {
    const poller: Poller = { listeners: new Set(), last: primed, timer: 0 as never };
    const refresh = async () => {
      let r: LiveResult;
      try {
        // Under a minute between polls (Game Day): ask for the route's shorter cache.
        const fast = refreshMs < 60_000 ? "&fast=1" : "";
        const res = await fetch(`/api/live?period=${period}&teamId=${teamId}${fast}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ok = toLiveResult(await res.json());
        if (!ok) throw new Error("malformed response");
        r = ok;
      } catch {
        r = { ok: false };
      }
      poller.last = r;
      poller.listeners.forEach((l) => l(r));
    };
    poller.timer = setInterval(refresh, refreshMs);
    pollers.set(key, poller);
    p = poller;
    // Seeded: the server fetched this moments ago, so the first poll waits for the
    // interval rather than re-asking ESPN the same question on load.
    if (!primed) void refresh();
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
