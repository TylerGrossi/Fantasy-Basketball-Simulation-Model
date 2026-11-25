/**
 * LONG-TERM VALUE (owner, 2026-11-21): a player's worth for the rest of the season, for the
 * Week Planner's "Long term" drops. Season value alone rests on ~15 games in November - it
 * had Brandin Podziemski (3.12) above Tyler Herro (1.79), so Long term would trade Herro
 * for a one-game Podziemski bump. A track record says more: this season's games at full
 * weight, last season's at LT_DECAY, the one before at LT_DECAY^2 (by games played), so 15
 * games now sit beside ~35 game-equivalents of history.
 *   Herro 1.79 -> 5.77, Podziemski 3.12 -> 1.35, Embiid 4.43 -> 9.19, Paul Reed 0.73 -> -2.76.
 * Scored with the Player Value formula and scale (makeValuer against the season pool). DD
 * and TW are not in the history lines, so they come from this season.
 * Players with no history row fall back to their season value; no pool row = no entry.
 */

import type { LeagueData, PoolPlayer } from "./league";
import { makeValuer } from "./percentiles";

export const LT_DECAY = 0.5;
const COUNTING = ["PTS", "REB", "AST", "STL", "BLK", "TO", "3PM", "3PA", "FGM", "FGA", "FTM", "FTA"] as const;

export function longTermValues(league: Pick<LeagueData, "season" | "seasonData">): Map<string, number> {
  const pool: PoolPlayer[] = league.seasonData?.playerPool ?? [];
  const out = new Map<string, number>();
  if (!pool.length) return out;
  const value = makeValuer(pool);
  for (const p of pool) {
    const rows = (p.history ?? []).filter((h) => (h.gp ?? 0) > 0);
    if (!rows.length) {
      if (typeof p.value === "number") out.set(p.name, p.value);
      continue;
    }
    const line: Record<string, number> = {};
    let w = 0;
    for (const k of COUNTING) line[k] = 0;
    for (const h of rows) {
      const wt = (h.gp ?? 0) * Math.pow(LT_DECAY, Math.max(0, league.season - h.season));
      w += wt;
      for (const k of COUNTING) line[k] += wt * (h[k] || 0);
    }
    for (const k of COUNTING) line[k] /= w || 1;
    const cur = p as unknown as { DD?: number; TW?: number };
    line.DD = cur.DD ?? 0;
    line.TW = cur.TW ?? 0;
    const s = value(line);
    out.set(p.name, s.off + s.def + s.other);
  }
  return out;
}
