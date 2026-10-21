import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { LeagueData, Matchup, PoolPlayer, Team } from "./league";
import type { PreWeekLog, WinProbLog } from "./predictions";
import type { CareerLog } from "./career";
import type { ConsistencyPool } from "./espnLive";
import { resolveTeam } from "./team";

/**
 * Parsed data files, kept for the life of the server process.
 *
 * Every page is rendered per request (the team cookie makes them dynamic), and the
 * layout and the page each call `loadLeague()` — so a click used to read and JSON.parse
 * the whole export twice before anything was sent. Now the file is parsed once and
 * reused until its modified time changes: on Vercel the data ships with the deployment
 * and never changes, and locally a fresh export is picked up on the next request.
 *
 * The cached object is SHARED across requests, so callers must not mutate it — copy
 * before sorting (`[...rows].sort(...)`), as every page already does.
 */
const jsonCache = new Map<string, { mtimeMs: number; value: Promise<unknown> }>();

async function readJson<T>(file: string): Promise<T> {
  const { mtimeMs } = await stat(file);
  const hit = jsonCache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.value as Promise<T>;
  const value = readFile(file, "utf8").then((s) => JSON.parse(s) as T);
  jsonCache.set(file, { mtimeMs, value });
  // A failed read must not stick: drop it so the next request tries again.
  value.catch(() => jsonCache.delete(file));
  return value;
}

const dataFile = (name: string) => path.join(process.cwd(), "public", "data", name);

/**
 * Server-side league snapshot. Read at render time so every page ships with real data in
 * the HTML — no loading spinner for the first paint, and no client fetch to see anything.
 */
export async function loadLeague(): Promise<LeagueData> {
  const raw = await readJson<LeagueData>(dataFile("league.json"));
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
    return await readJson<BoxScores>(dataFile("boxscores.json"));
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
    return await readJson<PreWeekLog>(dataFile("predictions.json"));
  } catch {
    return null;
  }
}

/**
 * The win-probability log (scripts/build_data.py record_winprob_reading): one reading of
 * every matchup per data refresh, for the week's win-probability chart. Append-only like
 * the forecast log. Null until the first refresh has written it.
 */
export async function loadWinProbLog(): Promise<WinProbLog | null> {
  try {
    return await readJson<WinProbLog>(dataFile("winprob-log.json"));
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
    return await readJson<CareerLog>(dataFile("career.json"));
  } catch {
    return null;
  }
}

/**
 * The league-wide game-to-game spread baseline, from scripts/build_consistency.mjs.
 *
 * Its own file for the same reason career.json is: built by a separate script off ~290
 * ESPN game logs, and fixed now the season is over. Only the Agent reads it, and only to
 * turn a bare "± 7.1" into a percentile. Null until that script has been run.
 */
export async function loadConsistency(): Promise<ConsistencyPool | null> {
  try {
    return await readJson<ConsistencyPool>(dataFile("consistency.json"));
  } catch {
    return null;
  }
}

/** One team's week-0 power ranking (see loadWeek0). */
export interface Week0Rank {
  teamId: number;
  teamName: string;
  /** Whole-roster 9-cat value: the Value Power Rankings' "Total Value". */
  value: number;
  place: number;
}

/**
 * WEEK 0 of the power rankings: the Value Power Rankings as they stood before the first
 * game, snapshotted ONCE into public/data/power-week0.json (owner, 2026-10-20) so it stays
 * fixed while the live values move. Week 1's movement is measured from it. Null when the
 * file is missing — the pages then simply have no week 0.
 */
export async function loadWeek0(): Promise<Week0Rank[] | null> {
  try {
    const raw = await readJson<{ teams: Week0Rank[] }>(dataFile("power-week0.json"));
    return [...(raw.teams ?? [])].sort((a, b) => a.place - b.place);
  } catch {
    return null;
  }
}

/** One finished season's player pool, from public/data/archive/league-<season>.json. */
export interface ArchivedPool {
  /** ESPN's season year: 2026 = the 2025-26 season. */
  season: number;
  pool: PoolPlayer[];
}

/*
 * The fields the Player Card's percentile panel reads (lib/percentiles.ts). An archived
 * export is ~650 KB, almost all of it the parts no previous-season bar needs (matchups,
 * schedules, each row's three-season `history`), and this ships to the client.
 */
const ARCHIVE_KEYS = [
  "name", "playerId", "nbaTeam", "position", "owner", "status", "gp",
  "value", "recent", "trend", "recent15", "trend15", "fgPct", "ftPct", "tpPct",
  "PTS", "REB", "AST", "STL", "BLK", "3PM", "TO", "FGM", "FGA", "FTM", "FTA", "3PA",
  "DD", "TW", "last30", "last15",
] as const;

/**
 * Every archived season before `current`, newest first. Each season is archived by the
 * season switch (league-<season>.json), so new years appear here on their own. An empty
 * list when there is no archive — the card then offers the current season only.
 */
export async function loadArchivedPools(current: number): Promise<ArchivedPool[]> {
  const dir = path.join(process.cwd(), "public", "data", "archive");
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const seasons = names
    .map((n) => /^league-(\d{4})\.json$/.exec(n)?.[1])
    .filter((s): s is string => !!s)
    .map(Number)
    .filter((s) => s < current)
    .sort((a, b) => b - a);

  const out: ArchivedPool[] = [];
  for (const season of seasons) {
    try {
      const raw = await readJson<LeagueData>(path.join(dir, `league-${season}.json`));
      const pool = (raw.seasonData?.playerPool ?? []).map((p) => {
        const slim: Record<string, unknown> = {};
        for (const k of ARCHIVE_KEYS) if (k in p) slim[k] = p[k as keyof PoolPlayer];
        return slim as unknown as PoolPlayer;
      });
      if (pool.length) out.push({ season, pool });
    } catch {
      // A malformed archive drops that one season, not the page.
    }
  }
  return out;
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
