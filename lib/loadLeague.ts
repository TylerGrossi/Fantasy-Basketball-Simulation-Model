import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LeagueData, Matchup, Team } from "./league";
import { resolveTeam } from "./team";

/**
 * Server-side league snapshot. Read at render time so every page ships with real data in
 * the HTML — no loading spinner for the first paint, and no client fetch to see anything.
 */
export async function loadLeague(): Promise<LeagueData> {
  const file = path.join(process.cwd(), "public", "data", "league.json");
  const raw = JSON.parse(await readFile(file, "utf8")) as LeagueData;
  // Normalise the optional sections. An older or partially-generated export was enough to
  // crash a production BUILD (`Cannot read properties of undefined`) rather than just
  // render an empty page — defaults make a stale file degrade instead of failing.
  return {
    ...raw,
    teams: raw.teams ?? [],
    matchups: raw.matchups ?? [],
    freeAgents: raw.freeAgents ?? [],
    seasonData: raw.seasonData ?? {},
  };
}

/**
 * Which team is "yours" — read from the team cookie, falling back to the export's
 * default. Async because it touches request headers; see lib/team.ts for why a cookie
 * rather than localStorage.
 */
export { DEFAULT_TEAM_NAME as DEFAULT_TEAM } from "./team";

export async function myTeam(league: LeagueData): Promise<Team> {
  return resolveTeam(league);
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

/**
 * Trim the league down to what ONE client component actually needs.
 *
 * Anything passed from a server component to a client component is serialised into the
 * page's payload. Passing the whole `league` object put the entire 258 KB export into the
 * HTML of every interactive page — /player-value shipped 405 KB, /scoreboard 314 KB,
 * against 23 KB for a pure server page. The browser was downloading all ten matchups, 98
 * free agents, 289 pool players and every season table just to render one scoreboard.
 *
 * Returns the same `LeagueData` shape with the unused parts emptied, so component
 * signatures don't change — the caller just declares what it needs.
 */
export function trimLeague(
  league: LeagueData,
  keep: {
    /** Keep only this team's matchup (with rosters); drop the other nine. */
    matchupTeamId?: number;
    freeAgents?: boolean;
    playerPool?: boolean;
    /** Final totals for past weeks. ~22 KB, so off unless the page renders one. */
    periodResults?: boolean;
    /** Season-wide tables (standings, rankings, schedules, odds). */
    seasonTables?: boolean;
  } = {}
): LeagueData {
  const matchups =
    keep.matchupTeamId == null
      ? []
      : league.matchups.filter(
          (m) => m.homeId === keep.matchupTeamId || m.awayId === keep.matchupTeamId
        );

  const sd = league.seasonData ?? {};
  return {
    ...league,
    matchups,
    freeAgents: keep.freeAgents ? league.freeAgents : [],
    periodResults: keep.periodResults ? league.periodResults : [],
    seasonData: {
      playerPool: keep.playerPool ? sd.playerPool : undefined,
      ...(keep.seasonTables
        ? {
            standings: sd.standings,
            powerRankings: sd.powerRankings,
            schedules: sd.schedules,
            playoffOdds: sd.playoffOdds,
            championshipFinalists: sd.championshipFinalists,
            teamSeasonStats: sd.teamSeasonStats,
          }
        : {}),
    },
  };
}
