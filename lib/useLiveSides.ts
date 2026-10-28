"use client";

import { useMemo } from "react";
import { winProbability, type LeagueData, type Matchup } from "./league";
import { liveRoster, remainingSide } from "./liveAdjust";
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

  // Today's ESPN rosters first (pickups and drops since the export), then the games
  // already played come out of what is left.
  const you = useMemo(
    () =>
      remainingSide(
        league,
        liveRoster(league, youRaw, live.youToday, live.youAdded),
        live.youPlayed,
        live.gameLeft
      ),
    [league, youRaw, live.youToday, live.youAdded, live.youPlayed, live.gameLeft]
  );
  const opp = useMemo(
    () =>
      remainingSide(
        league,
        liveRoster(league, oppRaw, live.oppToday, live.oppAdded),
        live.oppPlayed,
        live.gameLeft
      ),
    [league, oppRaw, live.oppToday, live.oppAdded, live.oppPlayed, live.gameLeft]
  );

  return { live, you, opp };
}

/**
 * THE week's win probability, live — the number every page shows for your matchup
 * (Current Matchup's gauge, League Home, Game Day, Schedule). ESPN's live totals plus the
 * projection minus every game they already count, through `winProbability`; `.win` is a
 * win outright (a tied matchup is not one). Read it from here, never recompute it.
 */
export function useLiveWin(
  league: LeagueData,
  matchup: Matchup,
  isHome: boolean,
  teamId: number,
  enabled = true
) {
  const { live, you, opp } = useLiveSides(league, matchup, isHome, teamId, enabled);
  const outcome = useMemo(
    () => winProbability(league, you, opp, live.you, live.opp),
    [league, you, opp, live.you, live.opp]
  );
  return { live, outcome };
}
