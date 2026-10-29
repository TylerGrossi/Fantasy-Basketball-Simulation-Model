import type { TodayLine } from "./useLiveTotals";

/**
 * TODAY'S ESPN LINEUP as a display order (owner, 2026-10-29): rosters on the Current
 * Matchup page list players slot by slot — PG, SG, SF, PF, C, G, F, UTIL, Bench, IR —
 * the way ESPN's own roster page does, read from the live feed's `lineupSlotId`, so it
 * follows whatever lineup is set in ESPN with no setup here.
 *
 * Display only. Who STARTS on a crowded day is still decided by value (the projection's
 * rule), and League Rosters deliberately keeps its best-lineup-by-value board.
 */

/** ESPN lineupSlotIds in roster-page order. */
export const SLOT_ORDER = [0, 1, 2, 3, 4, 5, 6, 11, 12, 13];
export const SLOT_LABEL: Record<number, string> = {
  0: "PG", 1: "SG", 2: "SF", 3: "PF", 4: "C", 5: "G", 6: "F", 11: "UTIL", 12: "Bench", 13: "IR",
};

export type LineupOrder = Map<string, { order: number; label: string }>;

/** Name -> position in today's lineup and slot label. Empty without live slots. */
export function lineupOrder(today: TodayLine[] | null | undefined): LineupOrder {
  const out: LineupOrder = new Map();
  (today ?? []).forEach((t, i) => {
    if (t.slot == null || !Number.isFinite(t.slot)) return;
    const k = SLOT_ORDER.indexOf(t.slot);
    // ESPN's own entry order breaks ties inside a slot (the three UTILs, the bench).
    out.set(t.name, { order: (k < 0 ? SLOT_ORDER.length : k) * 100 + i, label: SLOT_LABEL[t.slot] ?? "" });
  });
  return out;
}

/**
 * Sort by today's lineup; players it does not know (no live data yet, or a fresh pickup
 * ESPN has not slotted) fall to the end in `fallback` order.
 */
export function byLineup<T extends { name: string }>(
  rows: T[],
  lineup: LineupOrder,
  fallback: (a: T, b: T) => number
): T[] {
  const at = (r: T) => lineup.get(r.name)?.order ?? Infinity;
  return [...rows].sort((a, b) => at(a) - at(b) || fallback(a, b));
}
