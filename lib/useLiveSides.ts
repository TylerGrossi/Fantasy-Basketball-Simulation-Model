"use client";

import { useEffect, useMemo, useState } from "react";
import { winProbability, type LeagueData, type Matchup } from "./league";
import { etDate } from "./dates";
import { liveSides, projectedSides } from "./gaugeSides";
import { useLiveTotals } from "./useLiveTotals";

/**
 * Your matchup, live: ESPN's totals for both sides (games in progress included) and each
 * side's projection MINUS every game those totals already count — so the two never count a
 * game twice and the odds move as games finish. The pipeline is lib/gaugeSides.ts
 * `liveSides`; this hook only fetches and memoises.
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
  const sides = useMemo(
    () => liveSides(league, matchup, isHome, live),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [league, matchup, isHome, live.youToday, live.youAdded, live.youPlayed, live.oppToday, live.oppAdded, live.oppPlayed, live.gameLeft]
  );
  return { live, you: sides.you, opp: sides.opp };
}

/**
 * The live sides as the WIN PROBABILITY counts them (owner, 2026-11-03): on each crowded
 * day still to set, your team starts the Bench recommendation and the opponent his ESPN
 * lineup, positions checked. lib/gaugeSides.ts `projectedSides` is the one implementation
 * (the export's Node step runs it too); every win-probability number reads this.
 */
export function useProjectedSides(
  league: LeagueData,
  matchup: Matchup,
  isHome: boolean,
  teamId: number,
  enabled = true
) {
  const youRaw = isHome ? matchup.home : matchup.away;
  const oppRaw = isHome ? matchup.away : matchup.home;
  const live = useLiveTotals(league.period, teamId, youRaw.current, oppRaw.current, enabled);
  // Today (ET) after mount, as useMoveWindow: server and browser clocks can straddle midnight.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(etDate()), []);
  const p = useMemo(
    () => projectedSides(league, matchup, isHome, live, today),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [league, matchup, isHome, today, live.you, live.opp, live.youToday, live.youAdded, live.youPlayed, live.oppToday, live.oppAdded, live.oppPlayed, live.gameLeft]
  );
  // The same lineup rule for tools that re-seat your week (Streamers, the planner): with
  // no move it reproduces the recount, so their "no move" is this win probability.
  const rule = useMemo(
    () => ({
      layout: (league.rosterSlots ?? []).filter((s) => s !== "Bench" && s !== "IR"),
      eligibility: league.eligibility,
      sits: new Map(
        (p.crowded ?? []).map((c) => [c.date, new Set(c.players.filter((x) => x.recSit).map((x) => x.name))])
      ),
    }),
    [league.rosterSlots, league.eligibility, p.crowded]
  );
  return { live, you: p.you, opp: p.opp, crowded: p.crowded, rule };
}

/**
 * THE week's win probability, live — the number every page shows for your matchup
 * (Current Matchup's gauge, League Home, Game Day, Schedule). Read it from here, never
 * recompute it.
 */
export function useLiveWin(
  league: LeagueData,
  matchup: Matchup,
  isHome: boolean,
  teamId: number,
  enabled = true
) {
  const { live, you, opp } = useProjectedSides(league, matchup, isHome, teamId, enabled);
  const outcome = useMemo(
    () => winProbability(league, you, opp, live.you, live.opp),
    [league, you, opp, live.you, live.opp]
  );
  return { live, outcome };
}
