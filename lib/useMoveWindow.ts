"use client";

import { useEffect, useMemo, useState } from "react";
import type { LeagueData } from "./league";
import { etDate } from "./dates";
import { moveWindow } from "./gaugeSides";

/**
 * The days an add or drop made NOW can still affect — shared by Streamers and the Week
 * Planner so the two never disagree about when a move counts. The rule itself lives in
 * lib/gaugeSides.ts `moveWindow` (also used by the export's Node step).
 *
 * ESPN'S ROSTER LOCK (owner, 2026-10-21). This league's rosterLocktimeType is
 * FIRSTGAME_SCORINGPERIOD: once the first NBA game of the day tips off, adds and drops
 * made that day take effect the NEXT day, whoever's game it is. So the day is locked as
 * soon as any game today has started (live NBA scoreboard: `gameLeft` below 1 for some
 * team). Unknown — no live data yet — counts as unlocked.
 */
export function useMoveWindow(
  league: LeagueData,
  /** Live NBA scoreboard: team -> share of today's game still to play. */
  gameLeft: Record<string, number> | null | undefined
) {
  // Today in Eastern time, set after mount: the server's clock and the browser's can
  // straddle midnight, and a hydration mismatch is not worth it. Until then every date
  // in the week counts as open.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(etDate());
  }, []);
  return useMemo(() => moveWindow(league, gameLeft, today), [league, gameLeft, today]);
}
