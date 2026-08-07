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
  | "OFF"
  | "DEF"
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
  | "TO"
  | "TW";

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
    stats: [
      { key: "VALUE", label: "Total Value", signed: true },
      { key: "OFF", label: "Offensive Value", signed: true },
      { key: "DEF", label: "Defensive Value", signed: true },
    ],
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
  {
    /*
     * Scored categories that are NOT part of the 9-cat value.
     *
     * Team Wins is a real category in this league, but it is not one of the nine the
     * `value` engine z-scores, and folding it in would silently move every value in the
     * app. Its own group says both things at once: it counts in your matchup, and it is
     * not in the number above.
     *
     * It is also the one category a player has almost no individual control over — it
     * measures the team he happens to play for — which is worth seeing separately rather
     * than blended into a rating of him.
     */
    title: "Other",
    stats: [{ key: "TW", label: "Team Wins" }],
  },
];

/**
 * Games a player needs in the window before they join the REFERENCE population.
 *
 * A three-game sample can top any per-game leaderboard, and a handful of those in the
 * reference set drags everyone else's percentile down. The season bar is the strict one;
 * the windows are looser because a 15-day window only holds so many games to begin with.
 */
export const MIN_GP: Record<ValueBasis, number> = { Regular: 15, "30D": 5, "15D": 3 };

function windowOf(p: PoolPlayer, basis: ValueBasis) {
  if (basis === "30D") return p.last30;
  if (basis === "15D") return p.last15;
  return undefined;
}

export function gamesFor(p: PoolPlayer, basis: ValueBasis): number {
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

  /*
   * Offence and defence need a reference distribution to z-score against, which
   * `statValue` has no access to — so the split is built once here and read per player.
   *
   * It is handed the FULL pool, not the qualified `population` used for ranking. Those are
   * two different jobs: `population` decides who a percentile is measured against, while
   * the splitter has to reproduce the exact scale the export used for `value`, and the
   * export scored against every player in the pool. Passing the filtered set here made
   * Offensive + Defensive miss Total by a couple of points.
   */
  const split = valueSplitter(pool, basis);

  /*
   * Total is the export's own `value`, and DEFENCE IS THE REMAINDER — deliberately not the
   * separately-computed `def`.
   *
   * Two invariants have to hold at once: the three bars must add up, and Total must be the
   * same number the rest of the app ranks by. Computing all three independently satisfies
   * neither exactly — the export rounds per-game stats to a decimal or two in the JSON, so
   * recomputing from those rounded inputs drifts by up to 0.05, enough for +7.2 and +5.6 to
   * print beside a total of +12.9. Taking defence as `total - offence` makes the sum exact
   * by construction and parks that sub-0.05 drift in the half that is least sensitive to
   * it. The independently computed `def` is what confirms the drift is that small.
   */
  const valueOf = (x: PoolPlayer, key: StatKey): number | null => {
    if (key !== "OFF" && key !== "DEF") return statValue(x, key, basis);
    const parts = split(x);
    if (!parts) return null;
    if (key === "OFF") return parts.off;
    const total = statValue(x, "VALUE", basis);
    return total == null ? null : total - parts.off;
  };

  /*
   * Is the PLAYER's own sample big enough to rank him, against the same bar the reference
   * population had to clear?
   *
   * A player with one game in the last 30 days has a figure, but not one a percentile
   * should be drawn from: ranking a single game against everyone else's month reports a
   * hot night as a hot month. Below the bar every row comes back with a null percentile
   * and the card draws it as "Not qualified".
   */
  const unqualified = gamesFor(player, basis) < min;

  const rows: PercentileRow[] = [];
  for (const group of STAT_GROUPS) {
    for (const spec of group.stats) {
      const value = valueOf(player, spec.key);
      const others = population
        .map((x) => valueOf(x, spec.key))
        .filter((v): v is number => v != null);
      rows.push({
        spec,
        value,
        percentile:
          value == null || unqualified || others.length < 2
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


/* -------------------------------------------------------------------------- */
/* Splitting the 9-cat value into offence and defence                          */
/* -------------------------------------------------------------------------- */

/**
 * Which side of the ball each scored category belongs to.
 *
 * Rebounds sit on DEFENCE. They are genuinely both — an offensive board is offence — but
 * defensive rebounds are roughly three-quarters of the total for almost every player, so
 * counting them as defence is the closer of the two available answers. Turnovers are
 * offence: you cannot commit one without the ball.
 *
 * The split is exhaustive and non-overlapping, which is the property that matters:
 * offence + defence adds up to the 9-cat value exactly, so the three bars in the Value
 * group are one number and its two halves rather than three loosely related figures.
 */
const OFF_CATS = ["PTS", "AST", "3PM"] as const;
const DEF_CATS = ["REB", "STL", "BLK"] as const;

export interface ValueSplit {
  off: number;
  def: number;
}

/**
 * The per-game inputs a 9-cat value is computed from.
 *
 * Deliberately a plain bag of numbers rather than a `PoolPlayer`, so the same engine can
 * value a season line, a 15-day window, or an arbitrary run of games off a box-score log
 * (see the rolling-value chart). Anything missing counts as zero.
 */
export type StatLine = Partial<Record<string, number>>;

/** The window's own line, or undefined for the season (which lives on the player). */
function windowFor(p: PoolPlayer, basis: ValueBasis) {
  return basis === "30D" ? p.last30 : basis === "15D" ? p.last15 : undefined;
}

/** One raw counting stat, from the window if there is one. NaN = no sample. */
function rawStat(p: PoolPlayer, key: string, basis: ValueBasis): number {
  const w = windowFor(p, basis);
  if (basis !== "Regular" && !w) return NaN;
  if (w) return Number(w[key] ?? 0);
  return Number((p as unknown as Record<string, number>)[key] ?? 0);
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const sd = (xs: number[], m: number) => {
  const v = mean(xs.map((x) => (x - m) ** 2));
  return v > 0 ? Math.sqrt(v) : 0;
};

/**
 * Build a function that splits any player's 9-cat value into offence and defence.
 *
 * This is `_nine_cat_value` from the Streamlit app (legacy/streamlit_app.py), term for
 * term, just partitioned: the same z-score per counting category against the reference
 * population, the same subtraction for turnovers, and the same VOLUME-WEIGHTED impact for
 * the two percentages. Impact is written as `made - leagueRate * attempts`, which is
 * algebraically what `(pct - leagueRate) * attempts` computes but needs no percentage
 * field — so the window lines, which carry makes and attempts but no rate, work unchanged.
 *
 * Weighting the percentages by volume is the whole reason this cannot be eyeballed off the
 * bars: 90% on two free throws a game is not 90% on nine, and only the second one wins a
 * category.
 */
/**
 * The engine, exposed on its own: value ANY per-game line against the season pool.
 *
 * Split out from `valueSplitter` so the rolling-value chart can score a run of box scores
 * on exactly the scale the card's Total Value uses. If the chart rolled its own maths the
 * line could disagree with the number printed directly above it, which is the kind of
 * inconsistency nobody would ever chase down.
 */
/**
 * The reference distribution every value on this page is scored against.
 *
 * Factored out because three things need the identical moments: the total value, the
 * offence/defence split, and the per-category z-vector behind the shape chart and the
 * similar-player search. Recomputing them separately would let those drift apart, and a
 * "similar" player who did not have a similar value would be indefensible.
 */
function refMoments(ref: PoolPlayer[]) {
  const cats = [...OFF_CATS, ...DEF_CATS, "TO"] as const;

  const moments: Record<string, { m: number; s: number }> = {};
  for (const c of cats) {
    const xs = ref.map((x) => rawStat(x, c, "Regular")).filter((v) => !Number.isNaN(v));
    const m = mean(xs);
    moments[c] = { m, s: sd(xs, m) };
  }

  const rates: Record<string, { lg: number; m: number; s: number }> = {};
  for (const [made, att] of [["FGM", "FGA"], ["FTM", "FTA"]] as const) {
    const rows = ref
      .map((x) => [rawStat(x, made, "Regular"), rawStat(x, att, "Regular")] as const)
      .filter(([a, b]) => !Number.isNaN(a) && !Number.isNaN(b));
    const sumMade = rows.reduce((a, [v]) => a + v, 0);
    const sumAtt = rows.reduce((a, [, v]) => a + v, 0);
    const lg = sumAtt > 0 ? sumMade / sumAtt : 0;
    const imp = rows.map(([a, b]) => a - lg * b);
    const m = mean(imp);
    rates[att] = { lg, m, s: sd(imp, m) };
  }

  const at = (line: StatLine, k: string) => Number(line[k] ?? 0);
  const z = (c: string, v: number) =>
    moments[c].s > 0 ? (v - moments[c].m) / moments[c].s : 0;
  /** A percentage category's z-score, weighted by the volume behind it. */
  const zRate = (line: StatLine, made: string, att: string) => {
    const r = rates[att];
    return r.s > 0 ? (at(line, made) - r.lg * at(line, att) - r.m) / r.s : 0;
  };

  return { at, z, zRate };
}

/**
 * The nine scored categories, in the order the shape chart walks them.
 *
 * Offence and defence are kept contiguous rather than interleaved, so a scorer and a
 * defender produce visibly different shapes rather than two similar-looking stars.
 */
export const CAT_AXES = [
  "PTS", "3PM", "FG%", "FT%", "AST", "REB", "STL", "BLK", "TO",
] as const;
export type CatAxis = (typeof CAT_AXES)[number];

/**
 * One z-score per category — the vector the total value is the sum of.
 *
 * Turnovers are already SIGNED here (fewer is better, so a low-turnover player scores
 * positive), which is what lets every axis be read the same way: further out is better.
 */
export function makeZVector(ref: PoolPlayer[]): (line: StatLine) => Record<CatAxis, number> {
  const { at, z, zRate } = refMoments(ref);
  return (line) => ({
    PTS: z("PTS", at(line, "PTS")),
    "3PM": z("3PM", at(line, "3PM")),
    "FG%": zRate(line, "FGM", "FGA"),
    "FT%": zRate(line, "FTM", "FTA"),
    AST: z("AST", at(line, "AST")),
    REB: z("REB", at(line, "REB")),
    STL: z("STL", at(line, "STL")),
    BLK: z("BLK", at(line, "BLK")),
    TO: -z("TO", at(line, "TO")),
  });
}

/**
 * The engine, exposed on its own: value ANY per-game line against the season pool.
 *
 * Split out from `valueSplitter` so the rolling-value chart can score a run of box scores
 * on exactly the scale the card's Total Value uses. If the chart rolled its own maths the
 * line could disagree with the number printed directly above it, which is the kind of
 * inconsistency nobody would ever chase down.
 *
 * Weighting the percentages by volume is the whole reason this cannot be eyeballed off the
 * bars: 90% on two free throws a game is not 90% on nine, and only the second one wins a
 * category.
 */
export function makeValuer(ref: PoolPlayer[]): (line: StatLine) => ValueSplit {
  const vec = makeZVector(ref);
  return (line) => {
    const v = vec(line);
    return {
      off: v.PTS + v["3PM"] + v["FG%"] + v["FT%"] + v.AST + v.TO,
      def: v.REB + v.STL + v.BLK,
    };
  };
}

/**
 * Split a POOL PLAYER's value for a given basis, window fallback and all.
 *
 * THE REFERENCE IS ALWAYS THE SEASON, whatever basis is being shown — `makeValuer` is
 * built from the season pool once, and only the player's own LINE comes from the window.
 * That matches `_nine_cat_value(df, ref)` in the export, where `df` is the window being
 * valued but `ref` is `season_df` every time. It is what puts season and last-30 on one
 * scale so `trend = recent - value` means anything; scoring a 15-day window against
 * 15-day baselines produced a number on a different scale entirely, which is why
 * Offensive + Defensive drifted furthest from Total on the short windows.
 */
function valueSplitter(
  ref: PoolPlayer[],
  basis: ValueBasis
): (p: PoolPlayer) => ValueSplit | null {
  const value = makeValuer(ref);
  const KEYS = [...OFF_CATS, ...DEF_CATS, "TO", "FGM", "FGA", "FTM", "FTA"] as const;

  return (p) => {
    // No games in the window: the export falls back to the season value
    // (`Recent.fillna(Value)`), so the halves have to fall back with it or they would
    // sum to nothing beside a Total that is showing a real number.
    const from: ValueBasis = windowFor(p, basis) ? basis : "Regular";
    const line: StatLine = {};
    for (const k of KEYS) line[k] = rawStat(p, k, from);
    return value(line);
  };
}
