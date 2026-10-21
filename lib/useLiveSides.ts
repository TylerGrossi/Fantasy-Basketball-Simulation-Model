"use client";

import { useMemo } from "react";
import type { LeagueData, Matchup } from "./league";
import { remainingSide } from "./liveAdjust";
import { useLiveTotals } from "./useLiveTotals";

/**
 * Your matchup, live: ESPN's totals for both sides (games in progress included) and each
 * side's projection MINUS every game those totals already count — played today, or on a
 * day since the export (lib/liveAdjust.ts) — so the two never count a game twice and the
 * odds move as games finish.
 *
 * The one place the live wiring lives; Matchup Odds, Streamers and Bench all use it, and
 * share a single poller through useLiveTotals.
 */
export function useLiveSides(
  league: LeagueData,
  matchup: Matchup,
  isHome: boolean,
  teamId: number,
  /** false = freeze on the export's snapshot, never fetch (?demo=1). */
  enabled = true
) {
  const youRaw = isHome ? matchup.home : matchup.away;
  const oppRaw = isHome ? matchup.away : matchup.home;

  const live = useLiveTotals(league.period, teamId, youRaw.current, oppRaw.current, enabled);

  const you = useMemo(
    () => remainingSide(league, youRaw, live.youPlayed, live.gameLeft),
    [league, youRaw, live.youPlayed, live.gameLeft]
  );
  const opp = useMemo(
    () => remainingSide(league, oppRaw, live.oppPlayed, live.gameLeft),
    [league, oppRaw, live.oppPlayed, live.gameLeft]
  );

  return { live, you, opp };
}
