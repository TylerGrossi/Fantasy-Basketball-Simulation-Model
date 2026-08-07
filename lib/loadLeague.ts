import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LeagueData, Matchup, Team } from "./league";
import type { PreWeekLog } from "./predictions";
import type { CareerLog } from "./career";
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

/** One player's line for one scoring period, as ESPN reported it. */
export interface BoxLine {
  name: string;
  /** NBA games that counted for this player that week. */
  gp: number;
  min: number;
  /** Totals in `stats` order. Absent when the player did not play. */
  v?: number[];
}

export interface BoxScores {
  generatedAt: string;
  stats: string[];
  /** period -> team id -> player lines. Both keys are strings, as JSON keys are. */
  periods: Record<string, Record<string, BoxLine[]>>;
}

/**
 * Per-player weekly lines, from their own file.
 *
 * Deliberately NOT part of league.json: at 347 KB they are larger than everything else
 * put together, and only the week recap reads them. Every other page's server render
 * would pay for parsing them otherwise.
 *
 * Returns null when the file is missing — an export predating this feature must degrade
 * to the team-level recap, not to a crash.
 */
export async function loadBoxScores(): Promise<BoxScores | null> {
  try {
    const file = path.join(process.cwd(), "public", "data", "boxscores.json");
    return JSON.parse(await readFile(file, "utf8")) as BoxScores;
  } catch {
    return null;
  }
}

/**
 * The pre-week forecast log. Its own file for the same reason box scores are: it is
 * APPEND-ONLY and survives every rebuild, while league.json is regenerated from scratch
 * each run. Returns null when it does not exist yet, which is the normal state until a
 * season has actually run with the recorder in place — see lib/predictions.ts.
 */
export async function loadPredictions(): Promise<PreWeekLog | null> {
  try {
    const file = path.join(process.cwd(), "public", "data", "predictions.json");
    return JSON.parse(await readFile(file, "utf8")) as PreWeekLog;
  } catch {
    return null;
  }
}

/**
 * Career history across every league and season. Its own file because it is built on
 * demand by scripts/build_history.py rather than by the hourly export — finished seasons
 * do not change. Null until that script has been run.
 */
export async function loadCareer(): Promise<CareerLog | null> {
  try {
    const file = path.join(process.cwd(), "public", "data", "career.json");
    return JSON.parse(await readFile(file, "utf8")) as CareerLog;
  } catch {
    return null;
  }
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
