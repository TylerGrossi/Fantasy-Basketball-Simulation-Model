"use client";

import { useEffect, useState } from "react";
// One implementation, shared with the Agent — see lib/espnLive.ts.
import { parseTeamDefense, type TeamDefense } from "./espnLive";
export type { TeamDefense } from "./espnLive";

/**
 * How good each NBA team's defence was, keyed by the abbreviation the game log uses.
 *
 * Points allowed per game, from ESPN's team-statistics endpoint — one request for all
 * thirty teams, cached for the session. Not a possession-adjusted rating: ESPN does not
 * publish pace here, so a fast team looks slightly worse than it is. That is a real
 * limitation and the reason the card buckets teams into thirds rather than printing a
 * rank — the ordering is sound at that resolution, and thirds is all the split needs.
 */


const URL =
  "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byteam?season=2026&seasontype=2";


let CACHE: Promise<Map<string, TeamDefense>> | null = null;


export function useTeamDefense(): Map<string, TeamDefense> | null {
  const [map, setMap] = useState<Map<string, TeamDefense> | null>(null);
  useEffect(() => {
    if (!CACHE) {
      CACHE = fetch(URL)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          // `parseTeamDefense` owns the payload shape now; it takes the raw JSON.
          return r.json();
        })
        .then(parseTeamDefense)
        .catch((e) => {
          CACHE = null;
          throw e;
        });
    }
    let live = true;
    CACHE.then((m) => live && setMap(m)).catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return map;
}
