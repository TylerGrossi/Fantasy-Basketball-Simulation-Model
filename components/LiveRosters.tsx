"use client";

import { useMemo } from "react";
import type { LeagueData, Matchup } from "@/lib/league";
import { sideMoments } from "@/lib/league";
import { useLiveSides } from "@/lib/useLiveSides";
import { startingLayout, useCrowdedDays } from "@/lib/useCrowdedDays";
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
  /** Both rosters' ESPN eligible slots - the Schedule's crowded-day lineups check positions. */
  eligibility?: Record<string, string[]>;
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
  // Who sits on a crowded day still to play: the Bench section's recommendation
  // (lib/crowdedDays.ts), each side scored against the other (owner, 2026-11-03).
  const { league, matchup, isHome, teamId, live = true, eligibility } = props;
  const sides = useLiveSides(league, matchup, isHome, teamId, live);
  const youM = useMemo(() => sideMoments(sides.you, sides.live.you), [sides.you, sides.live.you]);
  const oppM = useMemo(() => sideMoments(sides.opp, sides.live.opp), [sides.opp, sides.live.opp]);
  const youCrowded = useCrowdedDays(
    league, sides.you.players, youM, oppM, sides.live.youToday, sides.live.gameLeft, eligibility
  );
  const oppCrowded = useCrowdedDays(
    league, sides.opp.players, oppM, youM, sides.live.oppToday, sides.live.gameLeft, eligibility
  );
  return (
    <WeekSchedule
      league={league}
      layout={startingLayout(league)}
      eligibility={eligibility}
      sides={[
        { label: props.youName, players: you.players, lineup: youLineup, crowded: youCrowded },
        { label: props.oppName, players: opp.players, lineup: oppLineup, crowded: oppCrowded },
      ]}
    />
  );
}
