import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LeagueData, Matchup, Team } from "./league";

/**
 * Server-side league snapshot. Read at render time so every page ships with real data in
 * the HTML — no loading spinner for the first paint, and no client fetch to see anything.
 */
export async function loadLeague(): Promise<LeagueData> {
  const file = path.join(process.cwd(), "public", "data", "league.json");
  return JSON.parse(await readFile(file, "utf8")) as LeagueData;
}

/**
 * Which team is "yours". Mirrors DEFAULT_TEAM_NAME in legacy/config.py; becomes a user
 * setting (localStorage) in a later phase.
 */
export const DEFAULT_TEAM = "VJ Maxx";

export function myTeam(league: LeagueData): Team {
  return (
    league.teams.find((t) => t.name.trim() === DEFAULT_TEAM) ?? league.teams[0]
  );
}

export interface ResolvedMatchup {
  matchup: Matchup;
  isHome: boolean;
  youName: string;
  oppName: string;
  oppId: number;
}

export function resolveMatchup(
  league: LeagueData,
  teamId: number
): ResolvedMatchup | null {
  const matchup = league.matchups.find(
    (m) => m.homeId === teamId || m.awayId === teamId
  );
  if (!matchup) return null;
  const isHome = matchup.homeId === teamId;
  const oppId = isHome ? matchup.awayId : matchup.homeId;
  const byId = new Map(league.teams.map((t) => [t.id, t]));
  return {
    matchup,
    isHome,
    youName: byId.get(teamId)?.name ?? "Your team",
    oppName: byId.get(oppId)?.name ?? "Opponent",
    oppId,
  };
}
