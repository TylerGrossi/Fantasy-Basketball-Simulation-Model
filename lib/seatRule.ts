/**
 * Who starts on one day - the one lineup rule the win probability, Streamers and the
 * planner share (owner, 2026-11-03). A leaf module (it imports only playerPool) so
 * streamers, planner, crowdedDays and lineupCount can all use it without import cycles.
 */

import { seatable, type Slotted } from "./playerPool";

/**
 * The legal by-value lineup for one day: best by value first, each taken only while
 * everyone taken can still be seated in `layout` (greedy is optimal here - seatable sets
 * form a matroid; see bestLineup in lib/playerPool.ts). A player missing from
 * `eligibility` fills UTIL only; with no map at all the layout counts as all UTIL, i.e.
 * the plain slot-count cap. Returns the names that start.
 */
export function legalStarters(
  players: { name: string; value: number }[],
  layout: string[],
  eligibility: Record<string, string[]> | undefined
): Set<string> {
  if (!eligibility) layout = layout.map(() => "UTIL");
  const slotted = (name: string): Slotted => ({
    eligibleSlots: layout.some((s) => s !== "UTIL") ? (eligibility?.[name] ?? []) : ["UTIL"],
    position: "",
  });
  const taken: string[] = [];
  for (const p of [...players].sort((a, b) => b.value - a.value)) {
    const trial = [...taken, p.name];
    if (seatable(trial.map(slotted), layout) === trial.length) taken.push(p.name);
  }
  return new Set(taken);
}

/**
 * How YOUR lineup is set on a crowded day, for tools that re-seat it (Streamers, the
 * planner): positions checked, and the players the Bench recommendation sits that day go
 * LAST. With the roster unchanged this reproduces the recommendation exactly (its starters
 * are a maximum legal set, so all of them are seated first); after a move, the newcomer
 * is placed by value and the recommended sits still sit unless a spot opens.
 */
export interface SeatRule {
  layout: string[];
  eligibility?: Record<string, string[]>;
  /** ISO date -> names the Bench recommendation sits that day. */
  sits?: Map<string, Set<string>>;
}

/** Starters for one day: `rule` when given, else the old rule (top `slots` by value). */
export function seatDay(
  playing: { name: string; value: number }[],
  date: string,
  slots: number,
  rule?: SeatRule
): Set<string> {
  if (!rule) {
    return new Set(
      [...playing].sort((a, b) => b.value - a.value).slice(0, slots).map((p) => p.name)
    );
  }
  const sits = rule.sits?.get(date);
  return legalStarters(
    playing.map((p) => ({ name: p.name, value: sits?.has(p.name) ? p.value - 1e6 : p.value })),
    rule.layout,
    rule.eligibility
  );
}
