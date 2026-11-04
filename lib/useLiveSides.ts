"use client";

import { useMemo } from "react";
import { applyAvailability, sideMoments, winProbability, type LeagueData, type Matchup } from "./league";
import { lineupOrder } from "./lineupOrder";
import { recountTheirs, recountYours } from "./lineupCount";
import { startingLayout, useCrowdedDays } from "./useCrowdedDays";
import { useMoveWindow } from "./useMoveWindow";
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
      // Will They Play last: a doubtful player's remaining games become likely, not
      // certain (lib/league.ts applyAvailability).
      applyAvailability(
        league,
        remainingSide(
          league,
          liveRoster(league, youRaw, live.youToday, live.youAdded),
          live.youPlayed,
          live.gameLeft
        )
      ),
    [league, youRaw, live.youToday, live.youAdded, live.youPlayed, live.gameLeft]
  );
  const opp = useMemo(
    () =>
      applyAvailability(
        league,
        remainingSide(
          league,
          liveRoster(league, oppRaw, live.oppToday, live.oppAdded),
          live.oppPlayed,
          live.gameLeft
        )
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
/**
 * The live sides as the WIN PROBABILITY counts them (owner, 2026-11-03): on each crowded
 * day still to set, your team starts the Bench recommendation and the opponent his ESPN
 * lineup, positions checked (lib/lineupCount.ts). Every win-probability number reads
 * this; the tools (Streamers, planner, crowded days) keep useLiveSides' export baseline.
 */
export function useProjectedSides(
  league: LeagueData,
  matchup: Matchup,
  isHome: boolean,
  teamId: number,
  enabled = true
) {
  const base = useLiveSides(league, matchup, isHome, teamId, enabled);
  const { live } = base;
  const youM = useMemo(() => sideMoments(base.you, live.you), [base.you, live.you]);
  const oppM = useMemo(() => sideMoments(base.opp, live.opp), [base.opp, live.opp]);
  const crowded = useCrowdedDays(league, base.you.players, youM, oppM, live.youToday, live.gameLeft, undefined);
  const win = useMoveWindow(league, live.gameLeft);
  const youLineup = useMemo(() => lineupOrder(live.youToday), [live.youToday]);
  const oppLineup = useMemo(() => lineupOrder(live.oppToday), [live.oppToday]);
  const irOf = (l: ReturnType<typeof lineupOrder>) =>
    new Set([...l].filter(([, v]) => v.label === "IR").map(([n]) => n));
  const window = useMemo(
    () => ({ dates: win.dates, teams: win.teams, slots: win.slots, layout: startingLayout(league) }),
    [win.dates, win.teams, win.slots, league]
  );
  const you = useMemo(
    () => recountYours(league, base.you, window, irOf(youLineup), crowded),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [league, base.you, window, youLineup, crowded]
  );
  const opp = useMemo(
    () => recountTheirs(league, base.opp, window, irOf(oppLineup), oppLineup),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [league, base.opp, window, oppLineup]
  );
  // The same lineup rule for tools that re-seat your week (Streamers, the planner): with
  // no move it reproduces the recount above, so their "no move" is this win probability.
  const rule = useMemo(
    () => ({
      layout: window.layout,
      eligibility: league.eligibility,
      sits: new Map(
        (crowded ?? []).map((c) => [c.date, new Set(c.players.filter((x) => x.recSit).map((x) => x.name))])
      ),
    }),
    [window.layout, league.eligibility, crowded]
  );
  return { live, you, opp, crowded, rule };
}

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
