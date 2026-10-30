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
  | "OTHER"
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
  /** Carries a sign, like the value. */
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
      // DD and TW: in the Total, on neither side of the ball — the third part, so the
      // three bars below Total add up to it (owner, 2026-10-21).
      { key: "OTHER", label: "Other Value", signed: true },
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
     * Team Wins on its own. It IS in the value (all fifteen categories are, owner
     * 2026-10-21), on neither side of the ball — but it is the one category a player has
     * almost no individual control over, measuring the team he happens to play for, so
     * it is worth seeing apart from the categories that are about him.
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

/**
 * Games behind a player's line for a basis — what a Min GP filter or a percentile's
 * qualifying bar should test. The window's own games for 30D / 15D.
 *
 * For the SEASON, the games the line actually rests on. Early in a season a player's line
 * is a BLEND (statSource "blend", engine/data.py): this season's few games mixed with all
 * of last season's. `gp` counts only this season's — 1 on opening week — so every star who
 * had played was hidden by Min GP 10 and printed "Not qualified" on his card, while a
 * player who had NOT played yet (a pure last-season line, gp 65) passed. The blend's
 * sample is both seasons' games, so that is what it counts.
 */
export function gamesFor(p: PoolPlayer, basis: ValueBasis): number {
  if (basis === "30D") return p.last30?.gp ?? 0;
  if (basis === "15D") return p.last15?.gp ?? 0;
  // The export counts it (`sampleGp`, engine/data.py SampleGP): present only when it
  // differs from `gp`. A rookie's blend is with a projection, which adds no games.
  return p.sampleGp ?? p.gp ?? 0;
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
  /**
   * 0-100, or null when there is nothing to rank (no figure, or no reference). Still set
   * when the player's sample is too small — see `qualified`.
   */
  percentile: number | null;
  /**
   * The player's own sample clears the bar. When false the percentile is where his figure
   * WOULD sit, drawn dimmed on the card (Baseball Savant's not-qualified bar) rather than
   * hidden: the length is still worth seeing, it just is not a standing yet.
   */
  qualified: boolean;
  /** How many players the rank was taken against. */
  n: number;
  /**
   * League rank among those `n`: 1 + everyone strictly better. Null exactly when
   * `percentile` is. `tied` when someone else has the identical figure, so the rank is
   * shared ("T-12th") rather than arbitrarily broken.
   */
  rank: number | null;
  tied: boolean;
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

/** 1 + how many have a strictly better figure; `tied` if another shares this one. */
function rankOf(value: number, others: number[], lowerIsBetter?: boolean) {
  let better = 0;
  let equal = 0;
  for (const o of others) {
    if (o === value) equal++;
    else if (lowerIsBetter ? o < value : o > value) better++;
  }
  // `others` includes the player himself when he is in the reference population, so a
  // tie means a SECOND equal figure.
  return { rank: better + 1, tied: equal > 1 };
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
  basis: ValueBasis,
  inBlend = false
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
   * DD and TW are in Total but on neither side — their own Other bar — so the bars are
   * Offence + Defence + Other = Total, and defence is `total - offence - other`.
   *
   * Two invariants have to hold at once: the parts must add up, and Total must be the
   * same number the rest of the app ranks by. Computing all three independently satisfies
   * neither exactly — the export rounds per-game stats to a decimal or two in the JSON, so
   * recomputing from those rounded inputs drifts by up to 0.05, enough for +7.2 and +5.6 to
   * print beside a total of +12.9. Taking defence as the remainder makes the sum exact
   * by construction and parks that sub-0.05 drift in the half that is least sensitive to
   * it. The independently computed `def` is what confirms the drift is that small.
   */
  const valueOf = (x: PoolPlayer, key: StatKey): number | null => {
    if (key !== "OFF" && key !== "DEF" && key !== "OTHER") return statValue(x, key, basis);
    const parts = split(x);
    if (!parts) return null;
    if (key === "OFF") return parts.off;
    if (key === "OTHER") return parts.other;
    const total = statValue(x, "VALUE", basis);
    return total == null ? null : total - parts.off - parts.other;
  };

  /*
   * Is the PLAYER's own sample big enough to rank him, against the same bar the reference
   * population had to clear?
   *
   * A player with one game in the last 30 days has a figure, but not one a percentile
   * should be drawn from: ranking a single game against everyone else's month reports a
   * hot night as a hot month. Below the bar every row comes back `qualified: false`, and
   * the card draws its bar dimmed and hatched as "Not qualified".
   *
   * `inBlend` exempts the SEASON bar while the site's rankings still blend in last season
   * (engine/data.py BLEND_FULL_GAMES, first 10 games). The card shows his own few games
   * (thisSeasonOnly), but every early-season line is that small — marking each one Not
   * qualified for the opening weeks hatched the whole league (owner, 2026-10-29).
   */
  const unqualified = !(inBlend && basis === "Regular") && gamesFor(player, basis) < min;

  const rows: PercentileRow[] = [];
  for (const group of STAT_GROUPS) {
    for (const spec of group.stats) {
      const value = valueOf(player, spec.key);
      const others = population
        .map((x) => valueOf(x, spec.key))
        .filter((v): v is number => v != null);
      const ranked = !(value == null || others.length < 2);
      const r = ranked ? rankOf(value, others, spec.lowerIsBetter) : null;
      rows.push({
        spec,
        value,
        percentile: ranked ? midrank(value, others, spec.lowerIsBetter) : null,
        qualified: ranked && !unqualified,
        n: others.length,
        rank: r?.rank ?? null,
        tied: r?.tied ?? false,
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
/* The league value, and its offence / defence / other split                   */
/* -------------------------------------------------------------------------- */

/**
 * The categories the value counts: ALL FIFTEEN this league scores (owner, 2026-10-21),
 * not the standard nine. FGM, FGA, 3PA, 3P%, DD and TW decide matchups here, so a value
 * that left them out ranked players by a game this league does not play. Every category
 * is "more is better" except turnovers — FGA and 3PA included, as the league scores them.
 *
 * `engine/data.py` (`league_value`) is the same formula, term for term, and writes the
 * `value` every page ranks by; this one recomputes it from any line (a window, a run of
 * games, one night) and must agree with it.
 *
 * Which side of the ball each belongs to:
 *   - OFFENCE: scoring and shooting (PTS, 3PM, 3PA, FGM, FGA, FG%, FT%, 3P%), AST, and
 *     TO — you cannot commit a turnover without the ball.
 *   - DEFENCE: REB, STL, BLK. Rebounds are genuinely both, but defensive boards are about
 *     three-quarters of almost everyone's total.
 *   - OTHER: DD and TW (owner) — a double-double is a threshold across categories and
 *     team wins measure his team, so neither is a side of the ball.
 * Exhaustive and non-overlapping: offence + defence + other is the value exactly.
 */
type ValueSide = "off" | "def" | "other";
interface ValueCat {
  cat: string;
  side: ValueSide;
  /** A percentage: scored by its volume-weighted impact, from these makes / attempts. */
  rate?: readonly [string, string];
  lowerIsBetter?: true;
}
const VALUE_CATS: readonly ValueCat[] = [
  { cat: "PTS", side: "off" },
  { cat: "3PM", side: "off" },
  { cat: "3PA", side: "off" },
  { cat: "FGM", side: "off" },
  { cat: "FGA", side: "off" },
  { cat: "FG%", side: "off", rate: ["FGM", "FGA"] },
  { cat: "FT%", side: "off", rate: ["FTM", "FTA"] },
  { cat: "3P%", side: "off", rate: ["3PM", "3PA"] },
  { cat: "AST", side: "off" },
  { cat: "TO", side: "off", lowerIsBetter: true },
  { cat: "REB", side: "def" },
  { cat: "STL", side: "def" },
  { cat: "BLK", side: "def" },
  { cat: "DD", side: "other" },
  { cat: "TW", side: "other" },
];

/**
 * Every stat a line needs for the value. A line missing one counts it as ZERO — which on
 * this scale is a real (bad) number, not "unknown" — so anything building a line to value
 * (a game log, a window, an average) carries all of these.
 */
export const VALUE_INPUTS = [
  "PTS", "REB", "AST", "STL", "BLK", "TO", "3PM", "3PA",
  "FGM", "FGA", "FTM", "FTA", "DD", "TW",
] as const;

export interface ValueSplit {
  off: number;
  def: number;
  /** DD and TW: in the total, on neither side of the ball. */
  other: number;
}

/** The whole value: every part of the split. */
export const valueTotal = (v: ValueSplit) => v.off + v.def + v.other;

/**
 * The per-game inputs a value is computed from.
 *
 * Deliberately a plain bag of numbers rather than a `PoolPlayer`, so the same engine can
 * value a season line, a 15-day window, or an arbitrary run of games off a box-score log
 * (see the rolling-value chart). Anything missing counts as zero.
 */
export type StatLine = Partial<Record<string, number>>;

/** A double-double, as ESPN's fantasy side scores it: 10+ in two of these five. */
export function doubleDouble(line: StatLine): number {
  const tens = ["PTS", "REB", "AST", "STL", "BLK"].filter((k) => Number(line[k] ?? 0) >= 10);
  return tens.length >= 2 ? 1 : 0;
}

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
 * The reference distribution every value is scored against, and the per-category z-score.
 *
 * Factored out because several things need the identical moments: the total value, the
 * offence/defence split, and the per-category z-vector behind the shape chart and the
 * similar-player search. Recomputing them separately would let those drift apart, and a
 * "similar" player who did not have a similar value would be indefensible.
 *
 * A percentage is scored by its IMPACT, `made - leagueRate * attempts`: algebraically what
 * `(pct - leagueRate) * attempts` computes, but it needs no percentage field, so window
 * lines (makes and attempts, no rate) work unchanged. Weighting by volume is the point:
 * 90% on two free throws a game is not 90% on nine, and only the second wins a category.
 *
 * `spreads` replaces each category's spread and nothing else (see makeGameValuer).
 */
function refMoments(ref: PoolPlayer[], spreads?: Record<string, number>) {
  const spreadOf = (c: string, s: number) => (spreads?.[c] && spreads[c] > 0 ? spreads[c] : s);
  const moments: Record<string, { m: number; s: number; lg: number }> = {};

  for (const { cat, rate } of VALUE_CATS) {
    if (rate) {
      const [made, att] = rate;
      const rows = ref
        .map((x) => [rawStat(x, made, "Regular"), rawStat(x, att, "Regular")] as const)
        .filter(([a, b]) => !Number.isNaN(a) && !Number.isNaN(b));
      const sumMade = rows.reduce((a, [v]) => a + v, 0);
      const sumAtt = rows.reduce((a, [, v]) => a + v, 0);
      const lg = sumAtt > 0 ? sumMade / sumAtt : 0;
      const imp = rows.map(([a, b]) => a - lg * b);
      const m = mean(imp);
      moments[cat] = { m, s: spreadOf(cat, sd(imp, m)), lg };
    } else {
      const xs = ref.map((x) => rawStat(x, cat, "Regular")).filter((v) => !Number.isNaN(v));
      const m = mean(xs);
      moments[cat] = { m, s: spreadOf(cat, sd(xs, m)), lg: 0 };
    }
  }

  const at = (line: StatLine, k: string) => Number(line[k] ?? 0);
  /** One category's z-score for a line, SIGNED so further out is always better. */
  const zOf = (line: StatLine, c: ValueCat): number => {
    const { m, s, lg } = moments[c.cat];
    if (!(s > 0)) return 0;
    const x = c.rate ? at(line, c.rate[0]) - lg * at(line, c.rate[1]) : at(line, c.cat);
    const z = (x - m) / s;
    return c.lowerIsBetter ? -z : z;
  };
  return { zOf };
}

/**
 * The nine STANDARD categories, in the order the shape chart walks them.
 *
 * The shape and the similar-player search stay on these nine on purpose: they describe
 * the KIND of player (a scorer, a big, a defender), and the league's extra categories
 * would add near-copies of the same axes (FGM and FGA beside PTS; 3PA beside 3PM) and a
 * team stat (TW) that says nothing about him. The value itself counts all fifteen.
 *
 * Offence and defence are kept contiguous rather than interleaved, so a scorer and a
 * defender produce visibly different shapes rather than two similar-looking stars.
 */
export const CAT_AXES = [
  "PTS", "3PM", "FG%", "FT%", "AST", "REB", "STL", "BLK", "TO",
] as const;
export type CatAxis = (typeof CAT_AXES)[number];

/**
 * One z-score per category for the shape chart's nine axes — each exactly the term it
 * contributes to the value.
 *
 * Turnovers are already SIGNED here (fewer is better, so a low-turnover player scores
 * positive), which is what lets every axis be read the same way: further out is better.
 */
export function makeZVector(ref: PoolPlayer[]): (line: StatLine) => Record<CatAxis, number> {
  const { zOf } = refMoments(ref);
  const axes = CAT_AXES.map((a) => VALUE_CATS.find((c) => c.cat === a)!);
  return (line) =>
    Object.fromEntries(axes.map((c) => [c.cat, zOf(line, c)])) as Record<CatAxis, number>;
}

/**
 * The engine, exposed on its own: value ANY per-game line against the season pool, split
 * into its offence / defence / other parts (sum them with `valueTotal`).
 *
 * Split out from `valueSplitter` so the rolling-value chart can score a run of box scores
 * on exactly the scale the card's Total Value uses. If the chart rolled its own maths the
 * line could disagree with the number printed directly above it, which is the kind of
 * inconsistency nobody would ever chase down.
 */
export function makeValuer(ref: PoolPlayer[]): (line: StatLine) => ValueSplit {
  const { zOf } = refMoments(ref);
  return (line) => {
    const v: ValueSplit = { off: 0, def: 0, other: 0 };
    for (const c of VALUE_CATS) v[c.side] += zOf(line, c);
    return v;
  };
}

/**
 * `makeValuer` for ONE GAME (Game Day), by category: the same means and the same formula,
 * but every category divided by how far a SINGLE GAME spreads — measured from 14,000+ real
 * game logs by scripts/build_game_spread.mjs — instead of how far season averages spread.
 *
 * The season spreads are far too narrow for one night: steals averages sit only 0.36
 * apart, so 3 steals scored +6.8 and outweighed a 36-point game; one game's steals spread
 * 1.05. Returned per category (not summed) because Game Day paces the counting stats to
 * the share of the game played but scores Team Wins off the live win probability.
 */
export function makeGameValuer(
  ref: PoolPlayer[],
  spreads: Record<string, number>
): (line: StatLine) => Record<string, number> {
  const { zOf } = refMoments(ref, spreads);
  return (line) => Object.fromEntries(VALUE_CATS.map((c) => [c.cat, zOf(line, c)]));
}

/**
 * Split a POOL PLAYER's value for a given basis, window fallback and all.
 *
 * THE REFERENCE IS ALWAYS THE SEASON, whatever basis is being shown — `makeValuer` is
 * built from the season pool once, and only the player's own LINE comes from the window.
 * That matches `league_value(df, ref)` in the export, where `df` is the window being
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

  return (p) => {
    // No games in the window: the export falls back to the season value
    // (`Recent.fillna(Value)`), so the parts have to fall back with it or they would
    // sum to nothing beside a Total that is showing a real number.
    const from: ValueBasis = windowFor(p, basis) ? basis : "Regular";
    const line: StatLine = {};
    for (const k of VALUE_INPUTS) line[k] = rawStat(p, k, from);
    return value(line);
  };
}
