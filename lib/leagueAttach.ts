/**
 * The league as every model sees it: the export plus what loadLeague attaches (Will They
 * Play's chances for every scored player, rostered players' eligible slots). Its own module, free of
 * Next.js, so the export's Node step (scripts/node/season.ts) loads the league EXACTLY as
 * the pages do - otherwise the season engine's "this week" could differ from the gauge's.
 */

import type { LeagueData } from "./league";
import type { AvailabilityData } from "./availability";

/** Defaults for optional sections, plus the attached fields. */
export function normaliseLeague(raw: LeagueData, avail: AvailabilityData | null): LeagueData {
  // Normalise the optional sections. An older or partially-generated export was enough to
  // crash a production BUILD (`Cannot read properties of undefined`) rather than just
  // render an empty page — defaults make a stale file degrade instead of failing.
  return {
    ...raw,
    teams: raw.teams ?? [],
    matchups: raw.matchups ?? [],
    freeAgents: raw.freeAgents ?? [],
    seasonData: raw.seasonData ?? {},
    availability: availabilityRows(avail),
    eligibility: rosteredEligibility(raw),
  };
}

/** Rostered players' eligible slots (see LeagueData.eligibility). */
export function rosteredEligibility(raw: LeagueData): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of raw.seasonData?.playerPool ?? []) {
    if (!p.owner || p.owner === "Waivers") continue;
    const e = p.eligibleSlots?.length ? p.eligibleSlots : [p.position].filter(Boolean);
    if (e.length) out[p.name] = e;
  }
  return out;
}

/**
 * Will They Play, reduced to what the projections use: [date, chance] per remaining game
 * for EVERY scored player (owner, 2026-11-21). Undefined without availability.json.
 *
 * It was players WITH DOUBT only (a status, or a game under 85%; option b, 2026-11-03), so
 * a healthy player projected for every game. Healthy players do not play every game: in
 * week 4 of 2026-27 they played 93% of their projected counted games, and the model gave
 * them 92% (doubtful players: 81% and 81%). Projected counted games ran 350 against 313
 * played; with every player's chance 307 (per-team miss 4.6 -> 3.5 games). Every team's
 * pre-week total had been 8-17% over its actual week, about half of it these games.
 */
export function availabilityRows(data: AvailabilityData | null): LeagueData["availability"] {
  if (!data) return undefined;
  const out: Record<string, Array<[string, number]>> = {};
  for (const p of data.players) {
    if (!p.week.length) continue;
    out[p.name] = p.week.map((g) => [g.date, g.p]);
  }
  return out;
}

