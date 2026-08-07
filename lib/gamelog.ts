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

export interface EspnGameEvent {
  eventId: string;
  stats?: string[];
}

export interface EspnGameLog {
  labels?: string[];
  events?: Record<
    string,
    {
      gameDate?: string;
      atVs?: string;
      opponent?: { abbreviation?: string };
      team?: { id?: string; isAllStar?: boolean };
      gameResult?: string;
    }
  >;
  seasonTypes?: Array<{
    displayName?: string;
    categories?: Array<{ events?: EspnGameEvent[] }>;
  }>;
}

const URL_FOR = (playerId: number) =>
  `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog`;

const CACHE = new Map<number, Promise<EspnGameLog>>();

/** The raw log for one player. Repeat calls in a session reuse the first request. */
export function fetchGameLog(playerId: number): Promise<EspnGameLog> {
  let hit = CACHE.get(playerId);
  if (!hit) {
    hit = fetch(URL_FOR(playerId))
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<EspnGameLog>;
      })
      .catch((err) => {
        // A failed request must not be cached as a permanent failure — the next player
        // switch (or a retry) should be free to try again.
        CACHE.delete(playerId);
        throw err;
      });
    CACHE.set(playerId, hit);
  }
  return hit;
}

export type LoadState = "idle" | "loading" | "done" | "error";

/** `fetchGameLog` as a hook, with the switched-player race already handled. */
export function useGameLog(playerId: number | null): {
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
    fetchGameLog(playerId)
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
  }, [playerId]);

  return { log, state };
}

/**
 * ESPN files the ALL-STAR GAME under the regular season, with "WORLD" as the player's
 * team. It is not a real game for any purpose here.
 */
export function isAllStar(log: EspnGameLog, eventId: string): boolean {
  return !!log.events?.[eventId]?.team?.isAllStar;
}

/**
 * A real regular-season block.
 *
 * `Play In Regular Season` is ESPN's own label for the play-in and contains "Regular
 * Season", so it has to be excluded by name rather than by a substring match.
 */
export function isRegularSeason(displayName: string): boolean {
  return /regular season/i.test(displayName) && !/play.?in/i.test(displayName);
}
