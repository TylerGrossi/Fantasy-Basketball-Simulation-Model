"use client";

import { useMemo } from "react";
import type { LeagueData, PlayerRow } from "./league";
import type { Moments } from "./probability";
import type { TodayLine } from "./useLiveTotals";
import { analyzeCrowdedDays, type CrowdedDay } from "./crowdedDays";
import { lineupOrder } from "./lineupOrder";
import { useMoveWindow } from "./useMoveWindow";
import { irOf, startingLayout } from "./gaugeSides";

export { startingLayout };

/**
 * One side's crowded days (lib/crowdedDays.ts) with the page's live inputs: the days a
 * lineup can still change, today's IR slots, and the league's starting layout. Shared by
 * the Bench section and the Schedule grid so the two always grey out the same games.
 */
export function useCrowdedDays(
  league: LeagueData,
  roster: PlayerRow[],
  teamMoments: Moments,
  oppMoments: Moments,
  today: TodayLine[] | null | undefined,
  gameLeft: Record<string, number> | null | undefined,
  eligibility: Record<string, string[]> | undefined
): CrowdedDay[] | null {
  const win = useMoveWindow(league, gameLeft);
  const ir = useMemo(() => irOf(lineupOrder(today)), [today]);
  return useMemo(
    () =>
      league.weekSchedule
        ? analyzeCrowdedDays({
            league,
            roster,
            teamMoments,
            oppMoments,
            dates: win.dates,
            teams: win.teams,
            slots: win.slots,
            ir,
            layout: startingLayout(league),
            eligibility: eligibility ?? league.eligibility,
          })
        : null,
    [league, roster, teamMoments, oppMoments, win.dates, win.teams, win.slots, ir, eligibility]
  );
}
