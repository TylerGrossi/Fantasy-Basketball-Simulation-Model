/**
 * Shared helpers over `seasonData.playerPool` — the one list behind Player Value, Player
 * Card, Compare and the Trade Simulator.
 *
 * These are ports of the legacy helpers of the same name (`_player_status`, `_pv_headshot`,
 * `_team_agg`, `_cat9_record`, `_all_play_cats` in streamlit_app.py). Kept in one module so
 * the four views can't drift from each other the way four copies would.
 */

import type { PoolPlayer } from "./league";

/** Statuses that mean UNAVAILABLE, not just a game-time decision (config.INJURED_STATUSES). */
const INJURED = new Set(["OUT", "INJURY_RESERVE", "SSPD"]);

/** Raw ESPN injuryStatus -> (short label, severity). '' severity = active. */
const STATUS_LABELS: Record<string, [string, Severity]> = {
  OUT: ["OUT", "out"],
  INJURY_RESERVE: ["IR", "out"],
  SSPD: ["SUSP", "out"],
  DAY_TO_DAY: ["DTD", "day"],
  DTD: ["DTD", "day"],
  QUESTIONABLE: ["Q", "day"],
  Q: ["Q", "day"],
  DOUBTFUL: ["DTF", "day"],
  D: ["DTF", "day"],
};

export type Severity = "out" | "day" | "";

/**
 * `[shortLabel, severity]` for a raw status (which may be a comma-joined list). An
 * out/IR/suspension anywhere wins; otherwise the first known game-time status.
 */
export function playerStatus(raw: string | undefined): [string, Severity] {
  const parts = String(raw ?? "")
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((p) => p.toUpperCase());
  for (const p of parts) {
    if (INJURED.has(p)) return STATUS_LABELS[p] ?? ["OUT", "out"];
  }
  for (const p of parts) {
    if (STATUS_LABELS[p]) return STATUS_LABELS[p];
  }
  return ["", ""];
}

/** ESPN headshot for a player id, or null when the export has no id for them. */
export function headshotUrl(playerId: number | null | undefined): string | null {
  return playerId
    ? `https://a.espncdn.com/i/headshots/nba/players/full/${playerId}.png`
    : null;
}

/** Steals + blocks, the pairing the player cards show as one figure. */
export function stocks(p: PoolPlayer): number {
  return (p.STL ?? 0) + (p.BLK ?? 0);
}

export function isFreeAgent(p: PoolPlayer): boolean {
  return !p.owner || /^(fa|waivers?|free agent)$/i.test(p.owner);
}

/** Lineup order (backcourt -> frontcourt) for position menus — not alphabetical. */
export const POSITION_ORDER = ["PG", "SG", "SF", "PF", "C"];

/** Which value column a "value basis" choice reads, and the trend that goes with it. */
export const VALUE_BASES = ["Regular", "30D", "15D"] as const;
export type ValueBasis = (typeof VALUE_BASES)[number];

export const VALUE_COL: Record<ValueBasis, "value" | "recent" | "recent15"> = {
  Regular: "value",
  "30D": "recent",
  "15D": "recent15",
};
export const TREND_COL: Record<ValueBasis, "trend" | "trend15"> = {
  Regular: "trend15",
  "30D": "trend",
  "15D": "trend15",
};

/** Minimum games-played thresholds offered by "Min GP" filters. */
export const MIN_GP_OPTIONS = [0, 5, 10, 15, 20] as const;

/**
 * Games played behind a given value basis — the season total for "Regular", or the
 * window's OWN games-played for "30D"/"15D". A 30D value built from 3 games is exactly
 * as noisy as a season value built from 3 games, so the threshold has to track whichever
 * window is being ranked, not always the season count.
 */
export function gpFor(p: PoolPlayer, basis: ValueBasis): number {
  if (basis === "30D") return p.last30?.gp ?? 0;
  if (basis === "15D") return p.last15?.gp ?? 0;
  return p.gp ?? 0;
}

/** The counting stats summed when a set of players is treated as one roster. */
export const AGG_KEYS = [
  "FGM", "FGA", "FTM", "FTA", "3PM", "3PA", "REB", "AST", "STL", "BLK", "TO", "PTS", "DD",
] as const;

export type Agg = Record<string, number>;

/** Sum per-game category production over a set of players. */
export function teamAgg(players: PoolPlayer[]): Agg {
  const out: Agg = {};
  for (const k of AGG_KEYS) {
    out[k] = players.reduce((a, p) => a + Number(p[k as keyof PoolPlayer] ?? 0), 0);
  }
  return out;
}

const pct = (s: Agg, made: string, att: string) => (s[att] ? s[made] / s[att] : 0);

/** A ratio category and the two counting stats it is derived from. */
const RATIO_OF: Record<string, [string, string]> = {
  "FG%": ["FGM", "FGA"],
  "FT%": ["FTM", "FTA"],
  "3P%": ["3PM", "3PA"],
};

/**
 * Which of the league's scoring categories can be scored from the player pool.
 *
 * The pool carries no TW, so a 15-category league is compared over 14. Everything else —
 * including the volume categories FGA and 3PA, which feel odd to "win" but are exactly
 * how this league scores — is in.
 */
export function scorableCategories(categories: string[]): string[] {
  return categories.filter((c) => {
    const pair = RATIO_OF[c];
    if (pair) return AGG_KEYS.includes(pair[0] as never) && AGG_KEYS.includes(pair[1] as never);
    return AGG_KEYS.includes(c as never);
  });
}

/**
 * Category W-L-T for roster aggregate `a` against `b`, over the league's OWN categories.
 *
 * Was a hardcoded 9-cat comparison, which is the convention behind a player's "value"
 * z-score but not how this league scores — it plays 15 categories, so scoring 9 of them
 * measured a game nobody is playing. The percentage categories are derived from
 * makes/attempts rather than averaged, and `lowerIsBetter` (turnovers) inverts.
 */
export function categoryRecord(
  a: Agg,
  b: Agg,
  categories: string[],
  lowerIsBetter: string[] = ["TO"]
): [number, number, number] {
  const lower = new Set(lowerIsBetter);
  let win = 0;
  let loss = 0;
  let tie = 0;
  for (const cat of categories) {
    const pair = RATIO_OF[cat];
    const dir = lower.has(cat) ? -1 : 1;
    const x = (pair ? pct(a, pair[0], pair[1]) : (a[cat] ?? 0)) * dir;
    const y = (pair ? pct(b, pair[0], pair[1]) : (b[cat] ?? 0)) * dir;
    if (x > y) win++;
    else if (x < y) loss++;
    else tie++;
  }
  return [win, loss, tie];
}

/**
 * Your category record summed against every other team's roster.
 *
 * NOT the same statistic as the all-play record on the standings page. That one is the
 * season as it actually happened — every real week, the totals those rosters actually
 * produced. This is a snapshot: today's rosters, per-game averages. A team whose stars
 * were hurt all year can grade out well here and still have finished 7th, which is
 * exactly what Born In The Darkness does. Read the CHANGE, not the absolute.
 */
export function allPlayCats(
  you: Agg,
  others: Agg[],
  categories: string[],
  lowerIsBetter?: string[]
): [number, number, number] {
  let w = 0;
  let l = 0;
  let t = 0;
  for (const o of others) {
    const [a, b, c] = categoryRecord(you, o, categories, lowerIsBetter);
    w += a;
    l += b;
    t += c;
  }
  return [w, l, t];
}
