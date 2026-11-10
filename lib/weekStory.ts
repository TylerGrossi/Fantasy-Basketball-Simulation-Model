/**
 * How a finished matchup played out (owner, 2026-11-10): the numbers behind the charts
 * on a past week's matchup page (components/WeekStory.tsx) and the shading on its box
 * scores.
 *
 *   forecast  the pre-week forecast against what happened, overall and per category
 *   byDay     the category score at the end of every day
 *   margins   each category's final margin, in units of the league's typical spread
 *   race      each category's running lead, day by day
 *   games     the matchup's best single games (Game Score)
 *   sides     per team: the day-by-day grid (with each player's week against his
 *             season) and the box-score heat shading
 *
 * Inputs are ESPN's own lines: gamelogs.json (each counted player-day of a finished week;
 * the days sum to the weekly totals exactly, checked for weeks 1-3) and boxscores.json
 * (weekly totals). Nothing new is modeled - every scale is one the app already uses:
 *   - forecast: lib/predictions.ts `forecastFor`, the number Current Matchup showed;
 *   - week vs season value: `makeValuer`, the Player Value scale (as Weekly Recap does);
 *   - Game Score: `makeGameValuer` on one day's line, exactly as Game Day scores a final.
 * "Focus" is the team on the left of the board, "opp" the one on the right.
 */

import { categoryValue, type LeagueData, type PoolPlayer } from "./league";
import type { BoxLine, GameLogs } from "./loadLeague";
import { dayRange } from "./dates";
import { forecastFor, type PreWeekLog } from "./predictions";
import { makeGameValuer, makeValuer } from "./percentiles";

export interface RaceDay {
  date: string;
  /** Running lead after this day, + = focus ahead (TO inverted; ratios in % points). */
  lead: number;
  focus: number;
  opp: number;
}

export interface CategoryRace {
  cat: string;
  days: RaceDay[];
  /** Index of the first day from which the final leader never trailed or tied again;
   *  null for a tied category. 0 = led wire to wire. */
  ledFrom: number | null;
  /** Times the lead changed hands (ties skipped). */
  changes: number;
}

export interface DayScore {
  date: string;
  win: number;
  loss: number;
  tie: number;
}

export interface Margin {
  cat: string;
  focus: number;
  opp: number;
  /** Signed raw margin, + = focus better (TO inverted; ratios as a fraction). */
  raw: number;
  /** raw / the league's typical team-week spread in this category. */
  z: number;
  /** Pre-week chance focus wins this category, 0-1; null when no forecast was logged. */
  pre: number | null;
}

export interface WeekForecast {
  /** Pre-week P(win) for each side, 0-1. */
  focusWin: number;
  oppWin: number;
  /** Expected categories won by focus, of `cats`. */
  expected: number;
  cats: number;
  /** The side the forecast had under 50% won. */
  upset: boolean;
  /** Categories won by the side the forecast had under 50% in that category. */
  against: string[];
}

export type StatLine = Record<string, number>;

export interface StandoutGame {
  name: string;
  /** ESPN id for the headshot, from the player pool; null when he is not in it. */
  playerId: number | null;
  side: "focus" | "opp";
  date: string;
  line: StatLine;
  gs: number;
}

export interface PlayerWeek {
  name: string;
  gp: number;
  /** Per-game value this week and over the season, Player Value scale. */
  week: number;
  season: number;
}

export interface DayCell {
  gs: number;
  line: StatLine;
}

export interface SideDetail {
  /** Players in box-score order (most points first). */
  players: string[];
  /** player -> date -> that day's counted line. A missing date = no counted game. */
  days: Record<string, Record<string, DayCell>>;
  /**
   * Box-score heat: player -> column -> how far this week sat from his season level, in
   * standard errors of a week's average (single-game spread / sqrt(games)). + = better.
   */
  heat: Record<string, Record<string, number>>;
  /** player -> his week against his season (players with STORY_MIN_GP+ games). */
  vsSeason: Record<string, PlayerWeek>;
}

export interface WeekStoryData {
  /** Every day of the week's window, game or not (the charts' x axis). */
  dates: string[];
  /** The days either team had a counted game (the day grids' columns). */
  gameDates: string[];
  forecast: WeekForecast | null;
  race: CategoryRace[];
  byDay: DayScore[];
  margins: Margin[];
  /** Each team's three best single games. */
  games: { focus: StandoutGame[]; opp: StandoutGame[] };
  /** The widest |week - season| across both teams, so both grids' bars share a scale. */
  vsCap: number;
  focus: SideDetail;
  opp: SideDetail;
}

/** A player needs this many games before his week is compared with his season. */
export const STORY_MIN_GP = 2;

const isRatio = (c: string) => c.includes("%");

/** Lead in display units: counting stats raw, percentages in percentage points. */
function leadOf(league: LeagueData, cat: string, a: number[], b: number[]): number {
  const x = categoryValue(league.stats, a, cat);
  const y = categoryValue(league.stats, b, cat);
  const d = league.lowerIsBetter.includes(cat) ? y - x : x - y;
  return isRatio(cat) ? d * 100 : d;
}

function tallyVec(league: LeagueData, a: number[], b: number[]) {
  let win = 0;
  let loss = 0;
  let tie = 0;
  for (const c of league.categories) {
    const d = leadOf(league, c, a, b);
    if (Math.abs(d) < 1e-9) tie += 1;
    else if (d > 0) win += 1;
    else loss += 1;
  }
  return { win, loss, tie };
}

/**
 * The typical spread of a team-week total, per category, from every finished regular-
 * season week: each team's value minus THAT WEEK's league mean, so a long week (more
 * games for everyone) does not read as spread.
 */
function typicalSpread(league: LeagueData, through: number): Record<string, number> {
  const devs: Record<string, number[]> = Object.fromEntries(league.categories.map((c) => [c, []]));
  for (const p of league.periodResults ?? []) {
    if (p.period > through || p.period > (league.regularSeasonWeeks || 99)) continue;
    const vecs = p.games.flatMap((g) => [g.home, g.away]);
    if (vecs.length < 2) continue;
    for (const c of league.categories) {
      const vals = vecs.map((v) => categoryValue(league.stats, v, c));
      const mean = vals.reduce((s, x) => s + x, 0) / vals.length;
      for (const x of vals) devs[c].push(x - mean);
    }
  }
  return Object.fromEntries(
    league.categories.map((c) => {
      const d = devs[c];
      const sd = d.length > 1 ? Math.sqrt(d.reduce((s, x) => s + x * x, 0) / (d.length - 1)) : 0;
      return [c, sd];
    })
  );
}

const lineOf = (stats: string[], v: number[], scale = 1): StatLine =>
  Object.fromEntries(stats.map((s, i) => [s, (v[i] ?? 0) / scale]));

/** Box-score columns the heat covers, and the value category each one is scored by. */
const HEAT_COLS: Array<[col: string, cat: string]> = [
  ["PTS", "PTS"], ["REB", "REB"], ["AST", "AST"], ["STL", "STL"], ["BLK", "BLK"],
  ["FG%", "FG%"], ["3P%", "3P%"], ["FT%", "FT%"], ["TO", "TO"], ["DD", "DD"],
];

export function buildWeekStory(args: {
  league: LeagueData;
  period: number;
  focusId: number;
  oppId: number;
  focusVec: number[];
  oppVec: number[];
  logs: GameLogs | null;
  box: { stats: string[]; focus: BoxLine[]; opp: BoxLine[] } | null;
  preLog: PreWeekLog | null;
  gameSpread: Record<string, number>;
}): WeekStoryData {
  const { league, period, focusId, oppId, focusVec, oppVec, logs, box, preLog, gameSpread } = args;
  const n = league.stats.length;
  const pool: PoolPlayer[] = league.seasonData?.playerPool ?? [];
  const poolBy = new Map(pool.map((p) => [p.name, p]));
  const gameValue = makeGameValuer(pool, gameSpread);
  const value = makeValuer(pool);
  const gsOf = (line: StatLine) => Object.values(gameValue(line)).reduce((a, b) => a + b, 0);

  // ---- day-by-day running totals ----
  const per = logs?.periods[String(period)];
  const dayIdx = logs ? league.stats.map((s) => logs.stats.indexOf(s)) : [];
  const daily = (id: number) => {
    const m = new Map<string, number[]>();
    for (const l of per?.[String(id)] ?? []) {
      const v = m.get(l.date) ?? new Array(n).fill(0);
      dayIdx.forEach((j, i) => {
        if (j >= 0) v[i] += l.v[j] ?? 0;
      });
      m.set(l.date, v);
    }
    return m;
  };
  const fd = daily(focusId);
  const od = daily(oppId);
  const seen = [...new Set([...fd.keys(), ...od.keys()])].sort();
  const dates = seen.length ? dayRange(seen[0], seen[seen.length - 1]) : [];

  const cumF: number[][] = [];
  const cumO: number[][] = [];
  let f = new Array(n).fill(0);
  let o = new Array(n).fill(0);
  for (const d of dates) {
    const a = fd.get(d);
    const b = od.get(d);
    if (a) f = f.map((x, i) => x + a[i]);
    if (b) o = o.map((x, i) => x + b[i]);
    cumF.push(f);
    cumO.push(o);
  }

  const race: CategoryRace[] = league.categories.map((cat) => {
    const days = dates.map((date, i) => ({
      date,
      lead: leadOf(league, cat, cumF[i], cumO[i]),
      focus: categoryValue(league.stats, cumF[i], cat),
      opp: categoryValue(league.stats, cumO[i], cat),
    }));
    const sign = (x: number) => (Math.abs(x) < 1e-9 ? 0 : x > 0 ? 1 : -1);
    const final = days.length ? sign(days[days.length - 1].lead) : 0;
    let ledFrom: number | null = null;
    if (final !== 0) {
      ledFrom = 0;
      days.forEach((d, i) => {
        if (sign(d.lead) !== final) ledFrom = i + 1;
      });
    }
    let changes = 0;
    let prev = 0;
    for (const d of days) {
      const s = sign(d.lead);
      if (s !== 0) {
        if (prev !== 0 && s !== prev) changes += 1;
        prev = s;
      }
    }
    return { cat, days, ledFrom, changes };
  });

  const byDay = dates.map((date, i) => ({ date, ...tallyVec(league, cumF[i], cumO[i]) }));

  // ---- the pre-week forecast ----
  const fc = forecastFor(preLog, league, period, focusId);
  const catProbs =
    fc && fc.categoryProbs.length === league.categories.length ? fc.categoryProbs : null;

  // ---- final margins, in typical spreads ----
  const sd = typicalSpread(league, period);
  const margins = league.categories
    .map((cat, i) => {
      const x = categoryValue(league.stats, focusVec, cat);
      const y = categoryValue(league.stats, oppVec, cat);
      const raw = league.lowerIsBetter.includes(cat) ? y - x : x - y;
      return { cat, focus: x, opp: y, raw, z: sd[cat] > 0 ? raw / sd[cat] : 0, pre: catProbs?.[i] ?? null };
    })
    .sort((a, b) => b.z - a.z);

  let forecast: WeekForecast | null = null;
  if (fc) {
    const final = tallyVec(league, focusVec, oppVec);
    const winner = final.win > final.loss ? 1 : final.loss > final.win ? -1 : 0;
    forecast = {
      focusWin: fc.win,
      oppWin: fc.loss,
      expected: fc.expected,
      cats: league.categories.length,
      upset: (winner === 1 && fc.win < 0.5) || (winner === -1 && fc.loss < 0.5),
      against: margins
        .filter((m) => m.pre != null && Math.abs(m.raw) > 1e-9 && (m.raw > 0 ? m.pre < 0.5 : m.pre > 0.5))
        .map((m) => m.cat),
    };
  }

  // ---- per side: day grid, heat, players vs season ----
  const logIdx = logs ? logs.stats : league.stats;
  const side = (id: number, lines: BoxLine[]) => {
    const played = lines.filter((l) => l.v);
    const ptsAt = box ? box.stats.indexOf("PTS") : -1;
    const players = [...played]
      .sort((a, b) => (b.v![ptsAt] ?? 0) - (a.v![ptsAt] ?? 0))
      .map((l) => l.name);

    const days: SideDetail["days"] = {};
    for (const l of per?.[String(id)] ?? []) {
      const line = lineOf(logIdx, l.v);
      (days[l.name] ??= {})[l.date] = { gs: gsOf(line), line };
    }

    const heat: SideDetail["heat"] = {};
    const weeks: PlayerWeek[] = [];
    for (const l of played) {
      if (!l.gp || !box) continue;
      const perGame = lineOf(box.stats, l.v!, l.gp);
      const p = poolBy.get(l.name);
      if (!p) continue;
      const seasonLine = p as unknown as StatLine;
      // Single-game z, and the gap scaled to the week's average of `gp` games.
      const zw = gameValue(perGame);
      const zs = gameValue(seasonLine);
      const k = Math.sqrt(l.gp);
      const row: Record<string, number> = {};
      for (const [col, cat] of HEAT_COLS) row[col] = ((zw[cat] ?? 0) - (zs[cat] ?? 0)) * k;
      heat[l.name] = row;
      if (l.gp >= STORY_MIN_GP && typeof p.value === "number") {
        const w = value(perGame);
        weeks.push({ name: l.name, gp: l.gp, week: w.off + w.def + w.other, season: p.value });
      }
    }
    const vsSeason = Object.fromEntries(weeks.map((w) => [w.name, w]));
    return { detail: { players, days, heat, vsSeason }, weeks };
  };
  const fs = side(focusId, box?.focus ?? []);
  const os = side(oppId, box?.opp ?? []);

  // ---- each team's best single games ----
  const topGames = (s: "focus" | "opp", id: number): StandoutGame[] =>
    (per?.[String(id)] ?? [])
      .map((l) => {
        const line = lineOf(logIdx, l.v);
        const playerId = poolBy.get(l.name)?.playerId ?? null;
        return { name: l.name, playerId, side: s, date: l.date, line, gs: gsOf(line) };
      })
      .sort((a, b) => b.gs - a.gs)
      .slice(0, 3);

  return {
    dates,
    gameDates: seen,
    forecast,
    race,
    byDay,
    margins,
    games: { focus: topGames("focus", focusId), opp: topGames("opp", oppId) },
    vsCap: Math.max(4, ...[...fs.weeks, ...os.weeks].map((w) => Math.abs(w.week - w.season))),
    focus: fs.detail,
    opp: os.detail,
  };
}
