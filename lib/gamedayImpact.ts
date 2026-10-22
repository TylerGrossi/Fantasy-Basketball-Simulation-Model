import type { LeagueData, TeamSide } from "./league";
import { winProbability } from "./league";
import { remainingSide } from "./liveAdjust";
import type { MatchupOutcome, StatVector } from "./probability";
import { gameLeftByTeam, type NbaGame } from "./gameday";
import type { TodayLine } from "./useLiveTotals";

/**
 * What tonight has done to your matchup (Game Day): the model's odds NOW against its odds
 * at TIP-OFF, so a 40-point night reads as "+9 points of win probability" rather than as
 * a box score you have to translate yourself.
 *
 * Tip-off is reconstructed, not remembered — the page may be opened at 11pm:
 *
 *   totals at tip-off  = live totals − tonight's COUNTED lines (bench and IR excluded:
 *                        their stats never reached the totals in the first place)
 *   projection         = every game tonight still fully to play (gameLeft 1)
 *
 * Now uses the same machinery as Current Matchup (lib/liveAdjust.ts): live totals plus
 * the projection minus whatever share of tonight has been played, read off the NBA clock.
 *
 * "Today" is ESPN's NBA day, not the Eastern calendar: after midnight with a late game
 * still running, the slate is still last night's, and both halves must agree on that or
 * the in-progress game is dropped from the projection while only part of it is banked.
 */
export interface NightImpact {
  now: MatchupOutcome;
  /** Null until tonight's lines have arrived (no game started yet = no change to show). */
  start: MatchupOutcome | null;
  /** Tonight's counted production per side, in `stats` order. */
  tonightYou: StatVector;
  tonightOpp: StatVector;
  /** Totals at tip-off, in `stats` order. */
  startYou: StatVector;
  startOpp: StatVector;
}

/** P(win the week), ties split — the single number the page leads with. */
export const winShare = (o: MatchupOutcome) => o.win + o.tie / 2;

/** A calendar day as a Date that reads as that day in Eastern time. */
export const dayAsDate = (day: string | null) =>
  day ? new Date(`${day}T16:00:00Z`) : new Date();

export function sumCounted(lines: TodayLine[] | null, width: number): StatVector {
  const out = new Array(width).fill(0);
  for (const l of lines ?? []) {
    if (!l.counted || !l.v) continue;
    for (let i = 0; i < width; i++) out[i] += l.v[i] ?? 0;
  }
  return out;
}

export function nightImpact(
  league: LeagueData,
  youRaw: TeamSide,
  oppRaw: TeamSide,
  liveYou: StatVector,
  liveOpp: StatVector,
  youToday: TodayLine[] | null,
  oppToday: TodayLine[] | null,
  games: NbaGame[],
  day: string | null
): NightImpact {
  const when = dayAsDate(day);
  const gl = gameLeftByTeam(games);
  const now = winProbability(
    league,
    remainingSide(league, youRaw, null, gl, when),
    remainingSide(league, oppRaw, null, gl, when),
    liveYou,
    liveOpp
  );

  const width = league.stats.length;
  const tonightYou = sumCounted(youToday, width);
  const tonightOpp = sumCounted(oppToday, width);
  const startYou = liveYou.map((x, i) => Math.max(0, x - tonightYou[i]));
  const startOpp = liveOpp.map((x, i) => Math.max(0, x - tonightOpp[i]));

  let start: MatchupOutcome | null = null;
  if (youToday && oppToday && games.some((g) => g.state !== "pre")) {
    const fresh = Object.fromEntries(Object.keys(gl).map((k) => [k, 1]));
    start = winProbability(
      league,
      remainingSide(league, youRaw, null, fresh, when),
      remainingSide(league, oppRaw, null, fresh, when),
      startYou,
      startOpp
    );
  }
  return { now, start, tonightYou, tonightOpp, startYou, startOpp };
}
