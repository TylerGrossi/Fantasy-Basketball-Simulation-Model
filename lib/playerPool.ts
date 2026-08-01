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

/** The counting stats summed when a set of players is treated as one roster. */
export const AGG_KEYS = [
  "FGM", "FGA", "FTM", "FTA", "3PM", "3PA", "REB", "AST", "STL", "BLK", "TO", "PTS",
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

/**
 * 9-cat W-L-T for aggregate `a` vs aggregate `b`. Lower TO wins; the percentage
 * categories are derived from makes/attempts rather than averaged.
 */
export function cat9Record(a: Agg, b: Agg): [number, number, number] {
  let win = 0;
  let loss = 0;
  let tie = 0;
  const comps: Array<[string, number]> = [
    ["PTS", 1], ["REB", 1], ["AST", 1], ["STL", 1], ["BLK", 1], ["3PM", 1], ["TO", -1],
  ];
  for (const [cat, dir] of comps) {
    const x = (a[cat] ?? 0) * dir;
    const y = (b[cat] ?? 0) * dir;
    if (x > y) win++;
    else if (x < y) loss++;
    else tie++;
  }
  for (const [made, att] of [["FGM", "FGA"], ["FTM", "FTA"]]) {
    const x = pct(a, made, att);
    const y = pct(b, made, att);
    if (x > y) win++;
    else if (x < y) loss++;
    else tie++;
  }
  return [win, loss, tie];
}

/** Your 9-cat record summed against every other team — all-play, so schedule luck is out. */
export function allPlayCats(you: Agg, others: Agg[]): [number, number, number] {
  let w = 0;
  let l = 0;
  let t = 0;
  for (const o of others) {
    const [a, b, c] = cat9Record(you, o);
    w += a;
    l += b;
    t += c;
  }
  return [w, l, t];
}
