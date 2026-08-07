"use client";

import { useEffect, useState } from "react";

/**
 * How good each NBA team's defence was, keyed by the abbreviation the game log uses.
 *
 * Points allowed per game, from ESPN's team-statistics endpoint — one request for all
 * thirty teams, cached for the session. Not a possession-adjusted rating: ESPN does not
 * publish pace here, so a fast team looks slightly worse than it is. That is a real
 * limitation and the reason the card buckets teams into thirds rather than printing a
 * rank — the ordering is sound at that resolution, and thirds is all the split needs.
 */

export interface TeamDefense {
  /** Opponent points per game. Lower is a better defence. */
  allowed: number;
  /** 1 = stingiest defence in the league. */
  rank: number;
}

const URL =
  "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/statistics/byteam?season=2026&seasontype=2";

interface ByTeam {
  teams?: Array<{
    team?: { abbreviation?: string };
    categories?: Array<{ name?: string; splitId?: string; names?: string[]; values?: number[] }>;
  }>;
  categories?: Array<{ name?: string; names?: string[] }>;
}

let CACHE: Promise<Map<string, TeamDefense>> | null = null;

function parse(d: ByTeam): Map<string, TeamDefense> {
  // The stat NAMES live once at the top level, per category; each team then ships a bare
  // `values` array in that order. `splitId: "900"` is the OPPONENT half of a category —
  // opponent offence is, by definition, this team's defence.
  const names = new Map<string, string[]>();
  for (const c of d.categories ?? []) {
    if (c.name && c.names) names.set(c.name, c.names);
  }

  const rows: Array<{ abbr: string; allowed: number }> = [];
  for (const t of d.teams ?? []) {
    const abbr = t.team?.abbreviation;
    if (!abbr) continue;
    const cat = (t.categories ?? []).find(
      (c) => c.name === "offensive" && c.splitId === "900"
    );
    const idx = names.get("offensive")?.indexOf("avgPoints") ?? -1;
    const v = idx >= 0 ? cat?.values?.[idx] : undefined;
    if (typeof v === "number" && v > 0) rows.push({ abbr, allowed: v });
  }

  rows.sort((a, b) => a.allowed - b.allowed);
  const out = new Map<string, TeamDefense>();
  rows.forEach((r, i) => out.set(r.abbr, { allowed: r.allowed, rank: i + 1 }));
  return out;
}

export function useTeamDefense(): Map<string, TeamDefense> | null {
  const [map, setMap] = useState<Map<string, TeamDefense> | null>(null);
  useEffect(() => {
    if (!CACHE) {
      CACHE = fetch(URL)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<ByTeam>;
        })
        .then(parse)
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
