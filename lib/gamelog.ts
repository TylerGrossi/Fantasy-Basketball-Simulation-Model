"use client";

import { useEffect, useState } from "react";

/**
 * One player's ESPN game log, fetched once and shared by everything that needs it.
 *
 * THREE components on the Player Card were each fetching this same URL: the rolling-value
 * chart, the game-log table, and the injury log (which derives missed games from it). Same
 * player, same endpoint, three round trips — and three separate caches that could disagree
 * about what had loaded. This is the one fetch they all read.
 *
 * The cache holds the PROMISE, not the result, so components mounting in the same tick
 * share the in-flight request instead of racing to start three of their own.
 *
 * The raw payload is what is shared, deliberately — each consumer parses it differently
 * and correctly so. The chart wants regular-season games only, oldest first, as numbers;
 * the table wants ESPN's display strings and keeps the postseason; the injury log wants
 * event ids and team ids and no stats at all. Sharing a pre-parsed shape would have to
 * serve all three and would end up serving none of them well.
 */

// The payload SHAPE and the two predicates moved to lib/gamelogTypes.ts so server-side
// code can use them — a `"use client"` module cannot be called from the server, which is
// what kept the Agent from ever seeing a game log. Re-exported so client imports here are
// unchanged.
export type { EspnGameEvent, EspnGameLog } from "./gamelogTypes";
export { isAllStar, isRegularSeason } from "./gamelogTypes";
import type { EspnGameLog } from "./gamelogTypes";

/*
 * `season` (ESPN's year: 2027 = 2026-27) asks for that season explicitly. Without it ESPN
 * serves ITS default, which lags the calendar — two days into 2026-27 it still handed
 * back 2025-26 — so a card set to one season drew its chart and splits from another.
 */
const URL_FOR = (playerId: number, season?: number) =>
  `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog` +
  (season ? `?season=${season}` : "");

const CACHE = new Map<string, Promise<EspnGameLog>>();

/** The raw log for one player and season. Repeat calls in a session reuse the first. */
export function fetchGameLog(playerId: number, season?: number): Promise<EspnGameLog> {
  const key = `${playerId}-${season ?? ""}`;
  let hit = CACHE.get(key);
  if (!hit) {
    hit = fetch(URL_FOR(playerId, season))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<EspnGameLog>;
      })
      .catch((err) => {
        // A failed request must not be cached as a permanent failure — the next player
        // switch (or a retry) should be free to try again.
        CACHE.delete(key);
        throw err;
      });
    CACHE.set(key, hit);
  }
  return hit;
}

export type LoadState = "idle" | "loading" | "done" | "error";

/** `fetchGameLog` as a hook, with the switched-player race already handled. */
export function useGameLog(playerId: number | null, season?: number): {
  log: EspnGameLog | null;
  state: LoadState;
} {
  const [log, setLog] = useState<EspnGameLog | null>(null);
  const [state, setState] = useState<LoadState>(playerId ? "loading" : "idle");

  useEffect(() => {
    if (!playerId) {
      setLog(null);
      setState("idle");
      return;
    }
    let live = true;
    setState("loading");
    setLog(null);
    fetchGameLog(playerId, season)
      .then((d) => {
        // The card may have moved to another player while this was in flight.
        if (!live) return;
        setLog(d);
        setState("done");
      })
      .catch(() => {
        if (live) setState("error");
      });
    return () => {
      live = false;
    };
  }, [playerId, season]);

  return { log, state };
}

/**
 * ESPN files the ALL-STAR GAME under the regular season, with "WORLD" as the player's
 * team. It is not a real game for any purpose here.
 */
