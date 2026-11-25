/**
 * The pre-week forecast log — the model's own scorecard.
 *
 * Written by `record_preweek_predictions` in scripts/build_data.py at the START of each
 * scoring period, before a single game of it has been played, and never rewritten
 * afterwards. That "never rewritten" is the whole point: a forecast recomputed after the
 * result is known is not a forecast, and the only thing that makes this file worth having
 * is that its numbers were fixed before the week they describe.
 *
 * It stores MOMENTS, not probabilities, so the percentage is still produced by the one
 * engine in `lib/probability.ts`. A win% baked in by the Python side would be a second
 * implementation of the same maths whose drift from the first nobody would ever notice.
 *
 * EMPTY UNTIL A SEASON RUNS. The 2025-26 season ended before this existed, and it
 * deliberately does not backfill — reconstructing a "forecast" from finished weeks would
 * mean using end-of-season averages and known games-played, i.e. hindsight, and labelling
 * hindsight as a prediction is exactly the thing this file exists to avoid. Every consumer
 * therefore treats a missing entry as normal, not as an error.
 */

import { matchupOutcome, type LeagueMeta, type Moments } from "./probability";
import { weekTerm } from "./league";

/**
 * The meta every entry is scored with: the CURRENT model's.
 *
 * REGRADED (owner, 2026-11-21). Until now each entry was scored with the constants stored
 * beside it, so history showed exactly what the site said at the time - including weeks
 * 1-4 of 2026-27, logged before the week term and the week correlation existed, which read
 * 96-98% on matchups the favourite lost. The owner chose the current maths for every week
 * instead. What stays fixed is what makes an entry a forecast: its MOMENTS (rosters,
 * averages, games), all written before the week was played. Only how those moments are
 * turned into a probability is re-applied, so a regraded number is still no hindsight.
 * The constants stored with an entry are kept in the file but no longer read here.
 */
export type ScoringMeta = LeagueMeta & { weekUncertainty?: number[] };

/** The constants the recorder stores with an entry - an audit trail, not read for scoring. */
interface LoggedConstants {
  variance?: number[];
  projectionError?: number[];
  shotCorrelation?: Record<string, number>;
  categoryCorrelation?: number[][];
  weekCorrelation?: number[][];
}

/** The meta to score an entry with: the log's categories, the current model's maths. */
function entryMeta(log: { stats?: string[]; categories?: string[]; lowerIsBetter?: string[] } | null, meta: LeagueMeta): LeagueMeta {
  // A log kept under different categories gets no matrices whose rows mean something else.
  const same = !log?.categories || log.categories.join() === meta.categories.join();
  return {
    stats: log?.stats ?? meta.stats,
    categories: log?.categories ?? meta.categories,
    lowerIsBetter: log?.lowerIsBetter ?? meta.lowerIsBetter,
    categoryCorrelation: same ? meta.categoryCorrelation : undefined,
    shotCorrelation: meta.shotCorrelation,
    weekCorrelation: same ? meta.weekCorrelation : undefined,
  };
}

/**
 * A logged side as the current gauge would build it. Entries from before 2026-11-09 have
 * no week term: it is added from the logged projection, (cv x rest-of-week mu)^2, exactly
 * as lib/league.ts withWeekTerm does for a live side (the logged mu IS the rest of week).
 */
function loggedSide(meta: ScoringMeta, mu: number[], v: number[], wk?: number[]): Moments {
  if (wk) return { mu, var: v, wk };
  const w = weekTerm({ stats: meta.stats, weekUncertainty: meta.weekUncertainty }, mu);
  return { mu, var: v.map((x, i) => x + w[i]), wk: w };
}

export interface PreWeekGame {
  homeId: number;
  awayId: number;
  homeMu: number[];
  homeVar: number[];
  awayMu: number[];
  awayVar: number[];
  /** The week term inside each var (since 2026-11-09); older entries have none. */
  homeWk?: number[];
  awayWk?: number[];
}

export interface PreWeekPeriod extends LoggedConstants {
  /** When the forecast was written — before any of the week was played. */
  recordedAt: string;
  games: PreWeekGame[];
}

export interface PreWeekLog {
  schemaVersion: number;
  stats?: string[];
  categories?: string[];
  lowerIsBetter?: string[];
  periods: Record<string, PreWeekPeriod>;
}

/** One team's forecast for one week, already turned into a probability. */
export interface Forecast {
  /** Chance the model gave this team of winning the matchup, 0-1. */
  win: number;
  loss: number;
  tie: number;
  /** Expected categories won. */
  expected: number;
  /** Distribution over categories won — the same array the live view plots. */
  distribution: number[];
  /** Per-category win chance, aligned to the scored categories. */
  categoryProbs: number[];
  recordedAt: string;
}

/**
 * The forecast this team was given for this period, or null when none was logged.
 *
 * Null is the ordinary case for any week the recorder did not see untouched — a period
 * that had already started when the exporter first ran, or any week before this feature
 * existed. Callers render nothing rather than a zero.
 */
export function forecastFor(
  log: PreWeekLog | null,
  meta: ScoringMeta,
  period: number,
  teamId: number
): Forecast | null {
  const entry = log?.periods?.[String(period)];
  if (!entry) return null;
  const game = entry.games.find(
    (g) => g.homeId === teamId || g.awayId === teamId
  );
  if (!game) return null;

  // The gauge's own sides at the time (since 2026-11-09 the recorder logs those).
  const isHome = game.homeId === teamId;
  const mom = (mu: number[], v: number[], wk?: number[]): Moments => loggedSide(meta, mu, v, wk);
  const you = isHome ? mom(game.homeMu, game.homeVar, game.homeWk) : mom(game.awayMu, game.awayVar, game.awayWk);
  const opp = isHome ? mom(game.awayMu, game.awayVar, game.awayWk) : mom(game.homeMu, game.homeVar, game.homeWk);
  const scoreMeta = entryMeta(log, meta);
  const out = matchupOutcome(scoreMeta, you, opp);
  return {
    win: out.win,
    loss: out.loss,
    tie: out.tie,
    expected: out.expectedCats,
    distribution: out.distribution,
    categoryProbs: out.categoryProbs,
    recordedAt: entry.recordedAt,
  };
}

/**
 * How the forecast did, once the result is in.
 *
 * "Right" is deliberately the coarse test — did the side it favoured actually win — and
 * NOT a calibration claim. A single 62% forecast that loses is not wrong; it is the 38%
 * happening. Only a run of them says anything, which is why this returns the raw pair and
 * leaves the verdict to a caller that can show both numbers side by side.
 */
export function gradeForecast(
  f: Forecast,
  won: boolean,
  tied: boolean
): { favoured: "you" | "opp" | "even"; right: boolean | null } {
  const favoured =
    Math.abs(f.win - f.loss) < 0.02 ? "even" : f.win > f.loss ? "you" : "opp";
  if (favoured === "even" || tied) return { favoured, right: null };
  return { favoured, right: favoured === "you" ? won : !won };
}

/* --------------------------------------------------- win probability over the week */

/** One recorded reading of every matchup (scripts/build_data.py record_winprob_reading). */
export interface WinProbReading extends LoggedConstants {
  at: string;
  games: Array<{
    homeId: number;
    awayId: number;
    homeCur: number[];
    awayCur: number[];
    homeMu: number[];
    homeVar: number[];
    awayMu: number[];
    awayVar: number[];
    homeWk?: number[];
    awayWk?: number[];
  }>;
}

export interface WinProbLog {
  schemaVersion: number;
  stats?: string[];
  categories?: string[];
  lowerIsBetter?: string[];
  periods: Record<string, WinProbReading[]>;
}

/** One point on the week's win-probability chart. */
export interface WinProbPoint {
  /** ISO timestamp of the reading. */
  at: string;
  /** P(you win the week), 0-1 — the gauge's number at that moment. */
  win: number;
  /** "forecast" = the pre-week forecast; "reading" = a data refresh mid-week. */
  kind: "forecast" | "reading";
}

/**
 * Your win probability at every recorded moment of a period: the pre-week forecast, then
 * each data refresh's reading. Computed here with the same engine as the gauge
 * (`matchupOutcome` on banked + projected moments), so a point on the chart is exactly
 * what the page showed at that time.
 */
export function winProbHistory(
  forecastLog: PreWeekLog | null,
  log: WinProbLog | null,
  meta: ScoringMeta,
  period: number,
  teamId: number
): WinProbPoint[] {
  const points: WinProbPoint[] = [];
  const pre = forecastFor(forecastLog, meta, period, teamId);
  if (pre) points.push({ at: pre.recordedAt, win: pre.win, kind: "forecast" });

  for (const r of log?.periods?.[String(period)] ?? []) {
    const g = r.games.find((x) => x.homeId === teamId || x.awayId === teamId);
    if (!g) continue;
    const home = g.homeId === teamId;
    // The week term on the rest-of-week projection (before banked totals are added).
    const side = (mu: number[], vr: number[], cur: number[], wk?: number[]): Moments => {
      const m = loggedSide(meta, mu, vr, wk);
      return { ...m, mu: mu.map((v, i) => v + (cur[i] ?? 0)) };
    };
    const you = home ? side(g.homeMu, g.homeVar, g.homeCur, g.homeWk) : side(g.awayMu, g.awayVar, g.awayCur, g.awayWk);
    const opp = home ? side(g.awayMu, g.awayVar, g.awayCur, g.awayWk) : side(g.homeMu, g.homeVar, g.homeCur, g.homeWk);
    points.push({ at: r.at, win: matchupOutcome(entryMeta(log, meta), you, opp).win, kind: "reading" });
  }
  return points.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
