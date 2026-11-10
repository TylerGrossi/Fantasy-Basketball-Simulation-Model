/**
 * The league as every model sees it: the export plus what loadLeague attaches (Will They
 * Play's doubtful players, rostered players' eligible slots). Its own module, free of
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
    availability: doubtful(avail),
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
 * Will They Play, reduced to what the projections use (owner's option b, 2026-11-03): only
 * players WITH DOUBT - a status on the report or ESPN, or any game this week under 85% -
 * with [date, chance] per remaining game. Healthy players are left out so their
 * projections do not move. Undefined without availability.json.
 */
export function doubtful(data: AvailabilityData | null): LeagueData["availability"] {
  if (!data) return undefined;
  const out: Record<string, Array<[string, number]>> = {};
  for (const p of data.players) {
    if (!p.week.length) continue;
    if (!p.status && !p.week.some((g) => g.p < 0.85)) continue;
    out[p.name] = p.week.map((g) => [g.date, g.p]);
  }
  return out;
}

