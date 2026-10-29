"use client";

import { useMemo } from "react";
import type { LeagueData, Matchup } from "@/lib/league";
import { liveRoster } from "@/lib/liveAdjust";
import { lineupOrder } from "@/lib/lineupOrder";
import { useLiveTotals } from "@/lib/useLiveTotals";
import RosterView from "./RosterView";
import WeekSchedule from "./WeekSchedule";

/**
 * Current Matchup's Roster and Schedule tabs on TODAY's ESPN rosters (owner, 2026-10-27):
 * a pickup shows the moment ESPN has him, not at the next scheduled export. Only the
 * roster moves — games left stay the export's week counts, as they always read on these
 * two tabs. Shares the page's one live poller (lib/useLiveTotals).
 */
interface Props {
  league: LeagueData;
  matchup: Matchup;
  isHome: boolean;
  teamId: number;
  youName: string;
  oppName: string;
  /** false = the export's rosters, never fetch (?demo=1). */
  live?: boolean;
}

function useLiveRosters({ league, matchup, isHome, teamId, live = true }: Props) {
  const youRaw = isHome ? matchup.home : matchup.away;
  const oppRaw = isHome ? matchup.away : matchup.home;
  const t = useLiveTotals(league.period, teamId, youRaw.current, oppRaw.current, live);
  const you = useMemo(
    () => liveRoster(league, youRaw, t.youToday, t.youAdded),
    [league, youRaw, t.youToday, t.youAdded]
  );
  const opp = useMemo(
    () => liveRoster(league, oppRaw, t.oppToday, t.oppAdded),
    [league, oppRaw, t.oppToday, t.oppAdded]
  );
  // Today's ESPN lineup per side, for display order (lib/lineupOrder.ts).
  const youLineup = useMemo(() => lineupOrder(t.youToday), [t.youToday]);
  const oppLineup = useMemo(() => lineupOrder(t.oppToday), [t.oppToday]);
  return { you, opp, youLineup, oppLineup };
}

export function LiveRosterView(props: Props) {
  const { you, opp, youLineup, oppLineup } = useLiveRosters(props);
  return (
    <RosterView
      league={props.league}
      you={you}
      opp={opp}
      youLineup={youLineup}
      oppLineup={oppLineup}
      youName={props.youName}
      oppName={props.oppName}
    />
  );
}

export function LiveWeekSchedule(props: Props) {
  const { you, opp, youLineup, oppLineup } = useLiveRosters(props);
  return (
    <WeekSchedule
      league={props.league}
      sides={[
        { label: props.youName, players: you.players, lineup: youLineup },
        { label: props.oppName, players: opp.players, lineup: oppLineup },
      ]}
    />
  );
}
