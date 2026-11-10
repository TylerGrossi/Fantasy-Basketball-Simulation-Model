/**
 * THE win probability's sides, as plain functions (2026-11-09).
 *
 * Everything the headline gauge counts for a matchup: today's ESPN rosters (liveRoster),
 * the games already played taken out (remainingSide), Will They Play (applyAvailability),
 * and who STARTS on each crowded day still to set (your Bench recommendation, his ESPN
 * lineup - lib/lineupCount.ts). The React hooks in lib/useLiveSides.ts are thin memoising
 * wrappers around these, and the export's Node step (scripts/node/season.ts) calls them
 * directly - so the gauge, the logged forecast, the win-prob log and the season engine's
 * current week are built by one piece of code and cannot drift apart.
 */

import type { LeagueData, Matchup, PlayerRow, TeamSide } from "./league";
import { applyAvailability, sideMoments, withWeekTerm } from "./league";
import { analyzeCrowdedDays, type CrowdedDay } from "./crowdedDays";
import { lineupOrder, type LineupOrder } from "./lineupOrder";
import { recountTheirs, recountYours } from "./lineupCount";
import { liveRoster, remainingSide } from "./liveAdjust";
import { dayRange } from "./dates";
import type { StatVector } from "./probability";
import type { TodayLine } from "./useLiveTotals";

/** The live inputs, as useLiveTotals reports them (all null = the export's snapshot). */
export interface GaugeLive {
  you: StatVector;
  opp: StatVector;
  youToday: TodayLine[] | null;
  oppToday: TodayLine[] | null;
  youAdded: PlayerRow[] | null;
  oppAdded: PlayerRow[] | null;
  youPlayed: string[] | null;
  oppPlayed: string[] | null;
  gameLeft: Record<string, number> | null;
}

/** The export's own snapshot as the live inputs: nothing fetched, nothing played since. */
export function snapshotLive(matchup: Matchup, isHome: boolean, today?: { you: TodayLine[]; opp: TodayLine[] }): GaugeLive {
  const you = isHome ? matchup.home : matchup.away;
  const opp = isHome ? matchup.away : matchup.home;
  return {
    you: you.current,
    opp: opp.current,
    youToday: today?.you ?? null,
    oppToday: today?.opp ?? null,
    youAdded: null,
    oppAdded: null,
    youPlayed: null,
    oppPlayed: null,
    gameLeft: null,
  };
}

/** The league's starting slots in order: every roster slot that is not Bench or IR. */
export const startingLayout = (league: LeagueData) =>
  (league.rosterSlots ?? []).filter((s) => s !== "Bench" && s !== "IR");

/**
 * The days an add, drop or lineup change made NOW can still affect (see useMoveWindow for
 * ESPN's roster lock). `today` null = unknown, every day open.
 */
export function moveWindow(
  league: LeagueData,
  gameLeft: Record<string, number> | null | undefined,
  today: string | null
) {
  const rosterLocked = !!today && !!gameLeft && Object.values(gameLeft).some((left) => left < 1);
  const sched = league.weekSchedule;
  const slots = startingLayout(league).length || 10;
  const days = sched ? dayRange(sched.start, sched.end) : [];
  const dates = days.filter((d) => !today || d > today || (d === today && !rosterLocked));
  return { today, rosterLocked, days, dates, teams: sched?.teams ?? {}, slots };
}

export type MoveWindow = ReturnType<typeof moveWindow>;

/** IR-slot players in a lineup. */
export const irOf = (l: LineupOrder) =>
  new Set([...l].filter(([, v]) => v.label === "IR").map(([n]) => n));

/** The live sides before the lineup recount: rosters, games played, Will They Play. */
export function liveSides(league: LeagueData, matchup: Matchup, isHome: boolean, live: GaugeLive) {
  const youRaw = isHome ? matchup.home : matchup.away;
  const oppRaw = isHome ? matchup.away : matchup.home;
  const you = applyAvailability(
    league,
    remainingSide(league, liveRoster(league, youRaw, live.youToday, live.youAdded), live.youPlayed, live.gameLeft)
  );
  const opp = applyAvailability(
    league,
    remainingSide(league, liveRoster(league, oppRaw, live.oppToday, live.oppAdded), live.oppPlayed, live.gameLeft)
  );
  return { you, opp };
}

/** One side's crowded days (the Bench recommendation) on a move window. */
export function crowdedFor(
  league: LeagueData,
  side: TeamSide,
  sideCurrent: StatVector,
  oppSide: TeamSide,
  oppCurrent: StatVector,
  today: TodayLine[] | null | undefined,
  win: MoveWindow,
  eligibility?: Record<string, string[]>
): CrowdedDay[] | null {
  if (!league.weekSchedule) return null;
  return analyzeCrowdedDays({
    league,
    roster: side.players,
    teamMoments: sideMoments(side, sideCurrent),
    oppMoments: sideMoments(oppSide, oppCurrent),
    dates: win.dates,
    teams: win.teams,
    slots: win.slots,
    ir: irOf(lineupOrder(today)),
    layout: startingLayout(league),
    eligibility: eligibility ?? league.eligibility,
  });
}

/**
 * The sides the WIN PROBABILITY counts: liveSides, then on each crowded day still to set
 * your team starts the Bench recommendation and the opponent his ESPN lineup (positions
 * checked). `today`: ISO date in ET, or null before it is known.
 */
export function projectedSides(
  league: LeagueData,
  matchup: Matchup,
  isHome: boolean,
  live: GaugeLive,
  today: string | null
) {
  const base = liveSides(league, matchup, isHome, live);
  const win = moveWindow(league, live.gameLeft, today);
  const crowded = crowdedFor(league, base.you, live.you, base.opp, live.opp, live.youToday, win);
  const window = { dates: win.dates, teams: win.teams, slots: win.slots, layout: startingLayout(league) };
  const youLineup = lineupOrder(live.youToday);
  const oppLineup = lineupOrder(live.oppToday);
  // Last: the week term on what is left (the recount has settled who plays).
  const you = withWeekTerm(league, recountYours(league, base.you, window, irOf(youLineup), crowded));
  const opp = withWeekTerm(league, recountTheirs(league, base.opp, window, irOf(oppLineup), oppLineup));
  return { base, you, opp, crowded, win };
}

/**
 * A matchup's sides as an OBSERVER sees them (neither team is "yours"): both on their own
 * ESPN lineup. The season engine uses this for matchups that do not involve the viewer.
 */
export function observerSides(
  league: LeagueData,
  matchup: Matchup,
  live: GaugeLive,
  today: string | null
) {
  const base = liveSides(league, matchup, true, live);
  const win = moveWindow(league, live.gameLeft, today);
  const window = { dates: win.dates, teams: win.teams, slots: win.slots, layout: startingLayout(league) };
  const homeLineup = lineupOrder(live.youToday);
  const awayLineup = lineupOrder(live.oppToday);
  return {
    home: withWeekTerm(league, recountTheirs(league, base.you, window, irOf(homeLineup), homeLineup)),
    away: withWeekTerm(league, recountTheirs(league, base.opp, window, irOf(awayLineup), awayLineup)),
  };
}
