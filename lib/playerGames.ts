"use client";

import { useMemo } from "react";
import type { PoolPlayer } from "./league";
import { useGameLog } from "./gamelog";
import { makeValuer, type StatLine } from "./percentiles";
// One implementation, shared with the Agent — see lib/espnLive.ts.
import { parseGameLog, averageLine as sharedAverageLine, type PlayerGame } from "./espnLive";
export type { PlayerGame } from "./espnLive";

/**
 * One player's season as a list of GAMES, each scored on the card's own value scale.
 *
 * Everything below the percentile bars that asks "when", "where" or "how consistently"
 * reduces to grouping this list: monthly splits, home/away, rest, the best and worst
 * nights, the spread. Parsing it once here keeps those modules honest with each other —
 * and with the rolling chart, which reads the same shared log.
 *
 * REGULAR SEASON ONLY, no All-Star game, no did-not-plays. Same rules as everywhere else
 * on the card: the fantasy season is the NBA regular season, and a night the player was
 * not on the floor is not a data point about how he played.
 */



/** The player's games, valued. Empty until the shared log resolves. */
export function usePlayerGames(
  playerId: number | null,
  pool: PoolPlayer[]
): { games: PlayerGame[]; loading: boolean } {
  const { log, state } = useGameLog(playerId);
  const value = useMemo(() => makeValuer(pool), [pool]);
  const games = useMemo(() => (log ? parseGameLog(log, value) : []), [log, value]);
  return { games, loading: state === "loading" };
}

/** Re-exported from lib/espnLive.ts, which owns it now. */
export { averageLine } from "./espnLive";

/** Re-exported from lib/espnLive.ts, which owns them now. */
export { mean, stdev, consistency, type Consistency } from "./espnLive";
