"use client";

import { useEffect, useMemo, useState } from "react";
import type { LeagueData } from "./league";
import { dayRange, etDate } from "./dates";

/**
 * The days an add or drop made NOW can still affect — shared by Streamers and the Week
 * Planner so the two never disagree about when a move counts.
 *
 * ESPN'S ROSTER LOCK (owner, 2026-10-21). This league's rosterLocktimeType is
 * FIRSTGAME_SCORINGPERIOD: once the first NBA game of the day tips off, adds and drops
 * made that day take effect the NEXT day, whoever's game it is. (Lineup moves lock per
 * game — that is a different setting, and not what an add is subject to.) So the day is
 * locked as soon as any game today has started (live NBA scoreboard: `gameLeft` below 1
 * for some team). Unknown — no live data yet — counts as unlocked.
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

  const rosterLocked =
    !!today && !!gameLeft && Object.values(gameLeft).some((left) => left < 1);

  const sched = league.weekSchedule;
  // Starting spots: every roster slot that is not Bench or IR. 10 in this league.
  const slots =
    (league.rosterSlots ?? []).filter((s) => s !== "Bench" && s !== "IR").length || 10;

  const { days, dates } = useMemo(() => {
    if (!sched) return { days: [] as string[], dates: [] as string[] };
    const days = dayRange(sched.start, sched.end);
    // Later days, plus today's only while the day is unlocked. The lock holds the DROP
    // too — dropped after tip-off, he is still yours for today.
    const dates = days.filter((d) => !today || d > today || (d === today && !rosterLocked));
    return { days, dates };
  }, [sched, today, rosterLocked]);

  return {
    today,
    rosterLocked,
    /** Every day of the matchup week, played ones included — for display. */
    days,
    /** The days a move made now can still change, ascending. */
    dates,
    /** The week's NBA schedule: team -> ISO date -> opponent. */
    teams: sched?.teams ?? {},
    slots,
  };
}
