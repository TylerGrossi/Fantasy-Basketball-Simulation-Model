/**
 * Percentile ranks for one player against the league, for the Player Card's bars.
 *
 * The card used to print a two-column list of per-game averages. A raw average answers
 * "how many" but not "is that good" — 4.6 rebounds means nothing until you know it beats
 * 62% of the league. These rank every stat against the pool so the card answers the second
 * question, which is the one a roster decision actually turns on.
 *
 * Everything here is BASIS-AWARE and symmetric: a 15D percentile ranks the player's last
 * 15 days against everyone else's last 15 days, never against season lines. Comparing a
 * hot stretch to full-season baselines would flatter every player on the page.
 */

import type { PoolPlayer } from "./league";
import type { ValueBasis } from "./playerPool";

export type StatKey =
  | "VALUE"
  | "PTS"
  | "3PM"
  | "FG%"
  | "FT%"
  | "3P%"
  | "REB"
  | "AST"
  | "DD"
  | "STL"
  | "BLK"
  | "TO";

export interface StatSpec {
  key: StatKey;
  label: string;
  /** Turnovers: fewer is better, so the percentile inverts. */
  lowerIsBetter?: boolean;
  /** A 0..1 rate that prints as `48.4`, not `0.484`. */
  rate?: boolean;
  /** Carries a sign, like the 9-cat value. */
  signed?: boolean;
}

/**
 * The bars, grouped the way the card reads top to bottom.
 *
 * Value leads alone because it is the number the rest of the app ranks by — everything
 * below it is the detail behind it. Grouping after that follows what a manager is
 * shopping for: scoring, then the other counting categories, then the two that are about
 * possession rather than production.
 */
export const STAT_GROUPS: Array<{ title: string; stats: StatSpec[] }> = [
  {
    title: "Value",
    stats: [{ key: "VALUE", label: "9-Cat Value", signed: true }],
  },
  {
    title: "Scoring",
    stats: [
      { key: "PTS", label: "Points" },
      { key: "3PM", label: "3-Pointers" },
      { key: "FG%", label: "Field Goal %", rate: true },
      { key: "FT%", label: "Free Throw %", rate: true },
      { key: "3P%", label: "3-Point %", rate: true },
    ],
  },
  {
    title: "Rebounding & Playmaking",
    stats: [
      { key: "REB", label: "Rebounds" },
      { key: "AST", label: "Assists" },
      { key: "DD", label: "Double-Doubles" },
    ],
  },
  {
    // Stocks (steals+blocks) used to sit here and was dropped: it is the sum of the two
    // bars directly above it, so it re-stated them rather than adding anything. Losing it
    // also squares the two columns at six bars each.
    title: "Defense & Ball Security",
    stats: [
      { key: "STL", label: "Steals" },
      { key: "BLK", label: "Blocks" },
      { key: "TO", label: "Turnovers", lowerIsBetter: true },
    ],
  },
];

/**
 * Games a player needs in the window before they join the REFERENCE population.
 *
 * A three-game sample can top any per-game leaderboard, and a handful of those in the
 * reference set drags everyone else's percentile down. The season bar is the strict one;
 * the windows are looser because a 15-day window only holds so many games to begin with.
 */
const MIN_GP: Record<ValueBasis, number> = { Regular: 15, "30D": 5, "15D": 3 };

function windowOf(p: PoolPlayer, basis: ValueBasis) {
  if (basis === "30D") return p.last30;
  if (basis === "15D") return p.last15;
  return undefined;
}

function gamesFor(p: PoolPlayer, basis: ValueBasis): number {
  if (basis === "30D") return p.last30?.gp ?? 0;
  if (basis === "15D") return p.last15?.gp ?? 0;
  return p.gp ?? 0;
}

/**
 * One player's value for one stat, or `null` when they have NO SAMPLE for it.
 *
 * Null is not zero, and the difference matters twice over: a player who took no threes
 * has no 3P% (counting them at 0% would invent a terrible shooter), and a player with no
 * games in the window has no window line at all. Null rows are dropped from the reference
 * population rather than sunk to the bottom of it.
 */
export function statValue(
  p: PoolPlayer,
  key: StatKey,
  basis: ValueBasis
): number | null {
  if (key === "VALUE") {
    return basis === "30D" ? p.recent : basis === "15D" ? p.recent15 : p.value;
  }

  const w = windowOf(p, basis);
  if (basis !== "Regular" && !w) return null;

  const raw = (k: string): number =>
    w ? Number(w[k] ?? 0) : Number((p as unknown as Record<string, number>)[k] ?? 0);

  // Rates are recomputed from the window's OWN makes and attempts — never carried over
  // from the season line, which would report a different window's shooting.
  const ratio = (made: string, att: string, seasonPct: number): number | null => {
    const attempts = raw(att);
    if (attempts <= 0) return null;
    return w ? raw(made) / attempts : seasonPct;
  };

  switch (key) {
    case "FG%":
      return ratio("FGM", "FGA", p.fgPct);
    case "FT%":
      return ratio("FTM", "FTA", p.ftPct);
    case "3P%":
      return ratio("3PM", "3PA", p.tpPct);
    default:
      return raw(key);
  }
}

export interface PercentileRow {
  spec: StatSpec;
  /** The player's own figure, or null when they have no sample. */
  value: number | null;
  /** 0-100, or null when the row can't be ranked. */
  percentile: number | null;
  /** How many players the rank was taken against. */
  n: number;
}

/**
 * Percentile via MIDRANK: half credit for the players tied with you.
 *
 * Plain "share strictly below" hands every tied player the bottom of their own tie, which
 * matters here because whole-number categories tie constantly — a third of the league has
 * 0.0 double-doubles, and without midrank all of them would read as 0th percentile rather
 * than the middle of the group they actually share.
 */
function midrank(value: number, others: number[], lowerIsBetter?: boolean): number {
  let below = 0;
  let equal = 0;
  for (const o of others) {
    if (o === value) equal++;
    else if (lowerIsBetter ? o > value : o < value) below++;
  }
  return Math.round(((below + equal / 2) / others.length) * 100);
}

/**
 * Every bar for one player: their figure, its percentile, and the sample it was ranked
 * against.
 *
 * The reference population is recomputed per stat rather than once, because "has a sample"
 * is per-stat: a player with no three-point attempts drops out of the 3P% ranking while
 * still counting toward points.
 */
export function percentileRows(
  pool: PoolPlayer[],
  player: PoolPlayer,
  basis: ValueBasis
): PercentileRow[] {
  const min = MIN_GP[basis];
  const qualified = pool.filter((x) => gamesFor(x, basis) >= min);
  // If the qualifier leaves too few to rank against, it is doing more harm than good —
  // an export mid-season, or a window nobody has played enough games in.
  const population = qualified.length >= 30 ? qualified : pool;

  const rows: PercentileRow[] = [];
  for (const group of STAT_GROUPS) {
    for (const spec of group.stats) {
      const value = statValue(player, spec.key, basis);
      const others = population
        .map((x) => statValue(x, spec.key, basis))
        .filter((v): v is number => v != null);
      rows.push({
        spec,
        value,
        percentile:
          value == null || others.length < 2
            ? null
            : midrank(value, others, spec.lowerIsBetter),
        n: others.length,
      });
    }
  }
  return rows;
}

/** Print a figure the way its stat wants to be read. */
export function formatStat(spec: StatSpec, v: number | null): string {
  if (v == null) return "—";
  if (spec.rate) return (v * 100).toFixed(1);
  if (spec.signed) return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
  return v.toFixed(1);
}
