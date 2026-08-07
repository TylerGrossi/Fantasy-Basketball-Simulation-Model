import type { PoolPlayer } from "./league";
import type { StatLine } from "./percentiles";

/** The stats a 9-cat value is built from, as a plain line. */
const KEYS = [
  "PTS", "REB", "AST", "STL", "BLK", "TO", "3PM",
  "FGM", "FGA", "FTM", "FTA",
];

/**
 * A pool player's SEASON line, in the shape the value engine eats.
 *
 * Shared by the category-shape dial and the similar-player search so both describe a
 * player with the identical set of numbers — a "similar" player found on one basis and
 * drawn on another would be quietly comparing two different things.
 */
export function lineOf(p: PoolPlayer): StatLine {
  const rec = p as unknown as Record<string, number>;
  const line: StatLine = {};
  for (const k of KEYS) line[k] = Number(rec[k] ?? 0);
  return line;
}
