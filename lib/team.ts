import { cookies } from "next/headers";
import type { LeagueData, Team } from "./league";
import { TEAM_COOKIE } from "./teamCookie";

/**
 * Which team the app analyses.
 *
 * Stored in a COOKIE rather than localStorage, because every page resolves the team on
 * the server while rendering — a localStorage value would arrive too late and the first
 * paint would show the wrong team, then snap. The cookie is readable by the server on the
 * very first request, so the HTML is right immediately.
 *
 * This is a display preference, not a credential: no auth, no secrets, and it never
 * leaves this browser except as a plain cookie header.
 */
export { TEAM_COOKIE } from "./teamCookie";

/** Falls back to the export's default when unset or when the name no longer exists. */
export async function resolveTeam(league: LeagueData): Promise<Team> {
  const fallback =
    league.teams.find((t) => t.name.trim() === DEFAULT_TEAM_NAME) ?? league.teams[0];
  try {
    const store = await cookies();
    const wanted = store.get(TEAM_COOKIE)?.value;
    if (!wanted) return fallback;
    const decoded = decodeURIComponent(wanted).trim();
    return league.teams.find((t) => t.name.trim() === decoded) ?? fallback;
  } catch {
    // cookies() throws outside a request scope (e.g. during static generation).
    return fallback;
  }
}

/** Mirrors DEFAULT_TEAM_NAME in legacy/config.py. */
export const DEFAULT_TEAM_NAME = "VJ Maxx";
