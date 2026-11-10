/**
 * Weekly Recap (owner, 2026-11-09): one finished week, league-wide - every matchup with
 * its pre-week odds and upsets, all-play and luck, category leaders, the week's top
 * players, risers and fallers, and the best single games.
 *
 * Nothing new is modelled here; every number comes from a piece the rest of the app uses:
 *   - results, all-play and luck: lib/history.ts `weeklyAllPlay` (Schedule's columns);
 *   - pre-week win probability: lib/predictions.ts `forecastFor` (the logged forecast,
 *     the same number Current Matchup showed before the week);
 *   - a week's value: lib/percentiles.ts `makeValuer` on the week's per-game line, the
 *     Player Value page's formula and scale, so it compares directly with season value;
 *   - Game Score: `makeGameValuer` on one day's line, exactly as Game Day scores a final.
 * Player lines are ESPN's: boxscores.json (weekly totals) and gamelogs.json (each counted
 * day of a finished week; the days sum to the weekly totals exactly).
 */

import { categoryValue, type LeagueData, type PoolPlayer } from "./league";
import { weeklyAllPlay, type WeekRow } from "./history";
import { forecastFor, type PreWeekLog } from "./predictions";
import { makeGameValuer, makeValuer } from "./percentiles";
import { bestLineup, STARTER_LAYOUT } from "./playerPool";
import type { BoxScores, GameLogs } from "./loadLeague";

/** A player needs this many games before his week ranks among the top or the movers. */
export const RECAP_MIN_GP = 2;

export interface RecapMatchup {
  homeId: number;
  awayId: number;
  home: number[];
  away: number[];
  /** Categories won by home / away, and ties. */
  score: { home: number; away: number; tie: number };
  winnerId: number | null;
  /** Pre-week P(win) for each side, 0-1; null when no forecast was logged for the week. */
  pre: { home: number; away: number } | null;
  /** The side the forecast had under 50% won. */
  upset: boolean;
}

export interface RecapTeam {
  teamId: number;
  row: WeekRow;
}

export interface RecapPlayer {
  name: string;
  teamId: number;
  gp: number;
  /** Per-game line over the week, by stat. */
  perGame: Record<string, number>;
  /** The week's per-game value, season scale. */
  week: number;
  /** His season value (player pool), or null when the pool has no line for him. */
  season: number | null;
}

export interface RecapGame {
  name: string;
  teamId: number;
  date: string;
  line: Record<string, number>;
  gs: number;
}

export interface CategoryLeader {
  cat: string;
  best: { teamId: number; value: number };
  worst: { teamId: number; value: number };
}

export interface WeekRecapData {
  period: number;
  matchups: RecapMatchup[];
  teams: RecapTeam[];
  leaders: CategoryLeader[];
  players: RecapPlayer[];
  games: RecapGame[];
}

/** The finished weeks a recap can show, newest first. */
export function finishedPeriods(league: LeagueData): number[] {
  return (league.periodResults ?? [])
    .map((p) => p.period)
    .filter((p) => league.seasonOver || p !== league.period)
    .sort((a, b) => b - a);
}

const lineOf = (stats: string[], v: number[], scale = 1) =>
  Object.fromEntries(stats.map((s, i) => [s, (v[i] ?? 0) / scale]));

export function buildWeekRecap(
  league: LeagueData,
  period: number,
  box: BoxScores | null,
  logs: GameLogs | null,
  preLog: PreWeekLog | null,
  gameSpread: Record<string, number>
): WeekRecapData | null {
  const result = (league.periodResults ?? []).find((p) => p.period === period);
  if (!result) return null;
  const pool: PoolPlayer[] = league.seasonData.playerPool ?? [];

  // Results, all-play and luck per team, from Schedule's own function.
  const teams: RecapTeam[] = [];
  for (const t of league.teams) {
    const row = weeklyAllPlay(league, t.id).weeks.find((w) => w.period === period);
    if (row) teams.push({ teamId: t.id, row });
  }
  const rowOf = new Map(teams.map((t) => [t.teamId, t.row]));

  const matchups: RecapMatchup[] = result.games.map((g) => {
    const a = rowOf.get(g.homeId)?.actual ?? { win: 0, loss: 0, tie: 0 };
    const score = { home: a.win, away: a.loss, tie: a.tie };
    const winnerId = score.home > score.away ? g.homeId : score.away > score.home ? g.awayId : null;
    const f = forecastFor(preLog, league, period, g.homeId);
    const pre = f ? { home: f.win, away: f.loss } : null;
    const upset =
      !!pre && winnerId != null && (winnerId === g.homeId ? pre.home : pre.away) < 0.5;
    return { homeId: g.homeId, awayId: g.awayId, home: g.home, away: g.away, score, winnerId, pre, upset };
  });

  // Category leaders: every team's total that week (TO: fewest is best).
  const lower = new Set(league.lowerIsBetter);
  const totals: Array<{ teamId: number; vec: number[] }> = result.games.flatMap((g) => [
    { teamId: g.homeId, vec: g.home },
    { teamId: g.awayId, vec: g.away },
  ]);
  const leaders: CategoryLeader[] = league.categories.map((cat) => {
    const vals = totals.map((t) => ({ teamId: t.teamId, value: categoryValue(league.stats, t.vec, cat) }));
    const better = (x: number, y: number) => (lower.has(cat) ? x < y : x > y);
    let best = vals[0];
    let worst = vals[0];
    for (const v of vals) {
      if (better(v.value, best.value)) best = v;
      if (better(worst.value, v.value)) worst = v;
    }
    return { cat, best, worst };
  });

  // Players: the week's per-game value against the season pool, beside his season value.
  const value = makeValuer(pool);
  const seasonOf = new Map(pool.map((p) => [p.name, typeof p.value === "number" ? p.value : null]));
  const players: RecapPlayer[] = [];
  for (const [tid, lines] of Object.entries(box?.periods[String(period)] ?? {})) {
    for (const l of lines) {
      if (!l.v || !l.gp) continue;
      const perGame = lineOf(league.stats, l.v, l.gp);
      const split = value(perGame);
      players.push({
        name: l.name,
        teamId: Number(tid),
        gp: l.gp,
        perGame,
        week: split.off + split.def + split.other,
        season: seasonOf.get(l.name) ?? null,
      });
    }
  }

  // Best single games: each counted day, scored as Game Day scores a final.
  const gameValue = makeGameValuer(pool, gameSpread);
  const games: RecapGame[] = [];
  const stats = logs?.stats ?? league.stats;
  for (const [tid, lines] of Object.entries(logs?.periods[String(period)] ?? {})) {
    for (const l of lines) {
      const line = lineOf(stats, l.v);
      const gs = Object.values(gameValue(line)).reduce((a, b) => a + b, 0);
      games.push({ name: l.name, teamId: Number(tid), date: l.date, line, gs });
    }
  }

  return { period, matchups, teams, leaders, players, games };
}

/** One seat in the Fantasy Team of the Week. */
export interface TeamOfWeekSeat {
  slot: string;
  player: RecapPlayer | null;
  /** ESPN id for the headshot, from the player pool. */
  playerId: number | null;
  /** The week's TOTAL value: per-game value x games played (Top players' ranking). */
  total: number | null;
}

/**
 * Fantasy Team of the Week (owner, 2026-11-10): the best legal starting lineup from every
 * rostered player's week, by TOTAL value - the league's starting slots (PG SG SF PF C G F
 * + UTILs) filled by `bestLineup`, the same seating Starter Rankings uses, with positions
 * from the player pool's eligible slots.
 */
export function teamOfTheWeek(league: LeagueData, players: RecapPlayer[]): TeamOfWeekSeat[] {
  const layout = (league.rosterSlots ?? []).filter((s) => s !== "Bench" && s !== "IR");
  const slots = layout.length ? layout : STARTER_LAYOUT;
  const pool = new Map((league.seasonData.playerPool ?? []).map((p) => [p.name, p]));
  const byRow = new Map<PoolPlayer, RecapPlayer>();
  const rows: PoolPlayer[] = [];
  for (const r of players) {
    const p = pool.get(r.name);
    if (!p || r.gp <= 0) continue;
    const row = { ...p, value: r.week * r.gp };
    byRow.set(row, r);
    rows.push(row);
  }
  return bestLineup(rows, slots).map((p, i) => ({
    slot: slots[i] === "UTIL" ? "UTIL" : slots[i],
    player: p ? byRow.get(p)! : null,
    playerId: p?.playerId ?? null,
    total: p ? p.value : null,
  }));
}
