/**
 * The ESPN game-log SHAPE and the two predicates that read it — with no React, so both
 * the browser hooks and server-side code can use them.
 *
 * These lived in `lib/gamelog.ts`, which is `"use client"` for its cache-and-hook half.
 * A `"use client"` module cannot be called from a server component or a route handler, so
 * the Agent had no way to reach the game log at all. Splitting the pure part out is what
 * lets one implementation serve both — see lib/espnLive.ts.
 *
 * `lib/gamelog.ts` re-exports everything here, so existing client imports are unchanged.
 */

export interface EspnGameEvent {
  eventId: string;
  stats?: string[];
}

export interface EspnGameLog {
  labels?: string[];
  events?: Record<
    string,
    {
      gameDate?: string;
      atVs?: string;
      opponent?: { abbreviation?: string };
      team?: { id?: string; isAllStar?: boolean };
      gameResult?: string;
    }
  >;
  seasonTypes?: Array<{
    displayName?: string;
    categories?: Array<{ events?: EspnGameEvent[] }>;
  }>;
}

export function isAllStar(log: EspnGameLog, eventId: string): boolean {
  return !!log.events?.[eventId]?.team?.isAllStar;
}

/**
 * A real regular-season block.
 *
 * `Play In Regular Season` is ESPN's own label for the play-in and contains "Regular
 * Season", so it has to be excluded by name rather than by a substring match.
 */
export function isRegularSeason(displayName: string): boolean {
  return /regular season/i.test(displayName) && !/play.?in/i.test(displayName);
}
