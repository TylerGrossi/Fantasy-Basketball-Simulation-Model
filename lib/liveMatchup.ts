import { etDate } from "@/lib/dates";
import { SITE_TO_FANTASY } from "@/lib/gameday";

/**
 * lib/liveMatchup.ts — server only (it reads the ESPN cookies from the environment).
 *
 * The LIVE half of the two-tier data split: current banked category totals for one
 * matchup. Everything else (player averages, games left, variances) comes from the
 * cached league.json, and the browser just adds these numbers to it.
 *
 * This talks to ESPN's fantasy API directly rather than going through the Python
 * espn-api package, so the function is a few KB of TypeScript with no Python runtime,
 * no numpy, and effectively no cold start. It is network-bound, not CPU-bound, which
 * keeps it well inside Vercel Hobby's Active-CPU allowance.
 *
 * Auth: ESPN_S2 / ESPN_SWID are private-league cookies and must stay server-side. They
 * are read from the environment - never bundled into the client.
 */

/**
 * Stat order AND ESPN's numeric ids both come from the generated league.json, which
 * derives them from espn-api's own STATS_MAP (see espn_stat_ids in build_data.py).
 *
 * They are deliberately NOT hardcoded here. A wrong id does not error - it reads as a
 * column of zeros, which silently turns a category loss into a tie. That is exactly what
 * happened when TW was guessed as 38 (it is 43; 38 is triple-doubles) and the scoreboard
 * read 10-4-1 instead of 10-5-0.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

interface StatMeta {
  stats: string[];
  statIds: Record<string, number>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cachedLeague: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function leagueFile(): any {
  if (cachedLeague) return cachedLeague;
  const file = path.join(process.cwd(), "public", "data", "league.json");
  cachedLeague = JSON.parse(readFileSync(file, "utf8"));
  return cachedLeague;
}

function statMeta(): StatMeta {
  const parsed = leagueFile();
  if (!Array.isArray(parsed?.stats) || !parsed?.statIds) {
    throw new Error("league.json is missing stats/statIds — run `npm run data`");
  }
  return { stats: parsed.stats, statIds: parsed.statIds };
}

/** Statuses that mean UNAVAILABLE (config.INJURED_STATUSES) — the export's `injured`. */
const INJURED = new Set(["OUT", "INJURY_RESERVE", "SSPD"]);

/**
 * Projection rows for players on a side's LIVE ESPN roster that the export does not have
 * on that team — a pickup or trade since the last scheduled export (owner, 2026-10-27:
 * "this should be live and should be updated as soon as I add him"). The browser drops
 * players who have left (lib/liveAdjust.ts `liveRoster`) on its own, but cannot project
 * an arrival without his line, and only the server holds the whole export. Looked up in
 * the waiver pool first (same shape and value scale as a roster row), then the other
 * teams' rosters (a trade), then the season player pool, whose games left come from the
 * week's NBA schedule. A name found in none of them is left out: there is nothing to
 * project him from.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addedRows(teamId: number | null | undefined, side: any): any[] {
  const lg = leagueFile();
  const today: string[] = (side?.rosterForCurrentScoringPeriod?.entries ?? []).map((e: any) =>
    String(e?.playerPoolEntry?.player?.fullName ?? "")
  );
  const sides = (lg.matchups ?? []).flatMap((m: any) => [
    { id: m.homeId, side: m.home },
    { id: m.awayId, side: m.away },
  ]);
  const mine = new Set<string>(
    (sides.find((s: any) => s.id === teamId)?.side?.players ?? []).map((p: any) => p.name)
  );
  const out = [];
  for (const name of today) {
    if (!name || mine.has(name)) continue;
    const fa = (lg.freeAgents ?? []).find((f: any) => f.name === name);
    const traded = sides
      .flatMap((s: any) => s.side?.players ?? [])
      .find((p: any) => p.name === name);
    const pool = (lg.seasonData?.playerPool ?? []).find((p: any) => p.name === name);
    if (traded) {
      out.push(traded);
    } else if (fa) {
      out.push({
        ...fa,
        nbaGamesLeft: fa.gamesLeft,
        injured: INJURED.has(String(fa.status ?? "").toUpperCase()),
      });
    } else if (pool) {
      const games = Object.keys(lg.weekSchedule?.teams?.[pool.nbaTeam] ?? {}).length;
      const injured = INJURED.has(String(pool.status ?? "").toUpperCase());
      out.push({
        name,
        nbaTeam: pool.nbaTeam,
        gamesLeft: injured ? 0 : games,
        nbaGamesLeft: injured ? 0 : games,
        avg: lg.stats.map((s: string) => Number(pool[s] ?? 0) || 0),
        status: pool.status ?? "",
        injured,
      });
    }
  }
  return out;
}

/**
 * ESPN returns each entry in `scoreByStat` as an OBJECT
 * `{ score, result, rank, ineligible }`, not a bare number. Reading it as a number
 * silently yields a scoreboard of zeros, so unwrap `.score` explicitly and tolerate both
 * shapes in case the API changes.
 */
function vectorFrom(
  totals: Record<string, unknown> | undefined,
  meta: StatMeta
): number[] {
  if (!totals) return meta.stats.map(() => 0);
  return meta.stats.map((s) => {
    const raw = totals[String(meta.statIds[s])];
    const v =
      typeof raw === "number"
        ? raw
        : typeof raw === "object" && raw !== null
          ? (raw as { score?: unknown }).score
          : undefined;
    return typeof v === "number" && Number.isFinite(v) ? v : 0;
  });
}

/** ESPN stat ids that are not scored categories but the box score shows. */
const GP_ID = "42";
const MIN_ID = "40";

/**
 * One side's player lines for the matchup, live: ESPN's `rosterForMatchupPeriod` lists
 * each player whose stats counted, with his matchup-to-date totals (statSplitTypeId 5,
 * scoringPeriodId 0). Same shape as an exported `BoxLine`, so the Box Score table reads
 * either without knowing which.
 */
function boxLines(side: any, meta: StatMeta) {
  const entries: any[] = side?.rosterForMatchupPeriod?.entries ?? [];
  return entries.map((e) => {
    const player = e?.playerPoolEntry?.player ?? {};
    const line = (player.stats ?? []).find(
      // scoringPeriodId 0 = the matchup-to-date line (verified against ESPN's response:
      // today's single-day line carries today's period id instead).
      (s: any) => s?.statSourceId === 0 && s?.statSplitTypeId === 5 && s?.scoringPeriodId === 0
    );
    const st = line?.stats ?? {};
    const gp = Number(st[GP_ID] ?? 0) || 0;
    return {
      name: String(player.fullName ?? ""),
      gp,
      min: Number(st[MIN_ID] ?? 0) || 0,
      ...(gp ? { v: meta.stats.map((s) => Number(st[String(meta.statIds[s])] ?? 0) || 0) } : {}),
    };
  });
}

/** ESPN lineup slots that do not count toward the matchup: bench and IR. */
const NON_COUNTING_SLOTS = new Set([12, 13]);

/**
 * One side's roster for TODAY's scoring period (Game Day): every player, whether his
 * lineup slot COUNTS, and — once his game is under way or finished — his single-day line
 * and the NBA game it came from. ESPN keeps a benched player's stats on the roster entry,
 * so the slot is the only way to tell his 30 points from ones that are on the board.
 */
function todayLines(side: any, meta: StatMeta) {
  const entries: any[] = side?.rosterForCurrentScoringPeriod?.entries ?? [];
  return entries.map((e) => {
    const player = e?.playerPoolEntry?.player ?? {};
    const line = (player.stats ?? []).find(
      (s: any) =>
        s?.statSourceId === 0 && s?.statSplitTypeId === 5 && Number(s?.scoringPeriodId ?? 0) > 0
    );
    const st = line?.stats ?? {};
    return {
      name: String(player.fullName ?? ""),
      playerId: Number(player.id ?? e?.playerId) || null,
      counted: !NON_COUNTING_SLOTS.has(Number(e?.lineupSlotId)),
      // ESPN's NBA event id — the same id the NBA scoreboard uses. Empty before tip-off.
      gameId: String(line?.externalId ?? ""),
      min: Number(st[MIN_ID] ?? 0) || 0,
      v: line ? meta.stats.map((s) => Number(st[String(meta.statIds[s])] ?? 0) || 0) : null,
    };
  });
}

/**
 * How much of each team's game today is still to be played, from ESPN's NBA scoreboard:
 * 1 before tip-off, 0 once final, and in between the share of regulation left on the clock
 * (overtime counts as all but done). This is what lets the page take an IN-PROGRESS game
 * only partly out of the projection — its banked stats are in the live totals, the rest of
 * it is still to come.
 */
async function todaysGameLeft(): Promise<Record<string, number> | null> {
  try {
    const day = etDate().replaceAll("-", "");
    const res = await fetch(
      `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${day}`,
      { cache: "no-store", signal: AbortSignal.timeout(10_000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const out: Record<string, number> = {};
    for (const e of data?.events ?? []) {
      const comp = e?.competitions?.[0];
      const st = comp?.status ?? {};
      const state = st?.type?.state;
      let left = 1;
      if (state === "post") left = 0;
      else if (state === "in") {
        const period = Number(st.period) || 1;
        const clock = clockSeconds(st);
        left =
          period > 4
            ? 0.02
            : Math.max(0, Math.min(1, ((4 - period) * 720 + clock) / 2880));
      }
      for (const c of comp?.competitors ?? []) {
        const ab = String(c?.team?.abbreviation ?? "");
        if (ab) out[SITE_TO_FANTASY[ab] ?? ab] = left;
      }
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Seconds left in the current period. ESPN's numeric `clock` first; else `displayClock`,
 * which is "M:SS" for most of a period but SECONDS ONLY ("45.3") in its last minute — read
 * as minutes, that made a game look barely started for the final minute of every quarter
 * and pushed the unplayed share (and the opponent's games left) back up (2026-10-20).
 */
function clockSeconds(st: any): number {
  if (typeof st?.clock === "number" && Number.isFinite(st.clock)) return st.clock;
  const s = String(st?.displayClock ?? "0:00");
  if (s.includes(":")) {
    const [m, sec] = s.split(":").map(Number);
    return (m || 0) * 60 + (sec || 0);
  }
  return Number(s) || 0;
}

/** Names of the players on one side with a game played (GP > 0) in today's scoring period. */
function playedToday(side: any): string[] {
  const entries: any[] = side?.rosterForCurrentScoringPeriod?.entries ?? [];
  return entries
    .filter((e) =>
      (e?.playerPoolEntry?.player?.stats ?? []).some(
        // A single DAY's line (scoringPeriodId > 0), never the matchup-to-date one (0):
        // a player who played Monday is not "played today".
        (s: any) =>
          s?.statSplitTypeId === 5 &&
          Number(s?.scoringPeriodId ?? 0) > 0 &&
          Number(s?.stats?.[GP_ID] ?? 0) > 0
      )
    )
    .map((e) => String(e?.playerPoolEntry?.player?.fullName ?? ""));
}

/** The live payload as `/api/live` sends it, or an error body, with its HTTP status. */
export interface LiveMatchupResponse {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
}

/**
 * One matchup's live totals from ESPN — the whole of `/api/live`, as a function, so a
 * SERVER PAGE can call it while it renders (see LiveSeed) instead of painting the
 * export's snapshot and swapping the live numbers in a second later.
 */
export async function liveMatchup(period: number, teamId: number): Promise<LiveMatchupResponse> {
  const leagueId = process.env.ESPN_LEAGUE_ID;
  const season = process.env.ESPN_SEASON_YEAR;
  const s2 = process.env.ESPN_S2?.trim();
  const swid = process.env.ESPN_SWID?.trim();
  if (!leagueId || !season) {
    return { status: 500, body: { error: "ESPN_LEAGUE_ID / ESPN_SEASON_YEAR not configured" } };
  }

  const endpoint =
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${season}` +
    // mBoxscore adds each side's `rosterForMatchupPeriod`: per-player totals for the
    // matchup, games in progress included — the live Box Score tab.
    `/segments/0/leagues/${leagueId}?view=mMatchupScore&view=mScoreboard&view=mBoxscore` +
    // NO scoringPeriodId: ESPN then defaults to TODAY's, which is what makes it include
    // the per-player rosters (rosterForMatchupPeriod / rosterForCurrentScoringPeriod).
    // `scoringPeriodId=0` — what this used to send — silently drops both.
    `&matchupPeriodId=${period}`;

  try {
    // Started alongside the fantasy request, not after it: the two are independent.
    const gameLeftPromise = todaysGameLeft();
    const res = await fetch(endpoint, {
      headers: {
        accept: "application/json",
        // Only the matchups near this period: mBoxscore carries every roster, so without
        // the filter the response is the whole season's schedule with players attached.
        // A small window, not just [period]: the app's period can run AHEAD of ESPN's
        // matchupPeriodId (playoff rounds span two scoring periods), and the fallbacks
        // below (currentMatchupPeriod, the team's latest) need those matchups present.
        "x-fantasy-filter": JSON.stringify({
          schedule: {
            filterMatchupPeriodIds: {
              value: [period - 3, period - 2, period - 1, period].filter((p) => p >= 1),
            },
          },
        }),
        // Private leagues need the auth cookies; public ones ignore them.
        ...(s2 && swid ? { cookie: `espn_s2=${s2}; SWID=${swid}` } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return { status: 502, body: { error: `ESPN returned ${res.status}` } };
    }
    const json = await res.json();

    const schedule: any[] = Array.isArray(json?.schedule) ? json.schedule : [];
    const involvesTeam = (m: any) =>
      m?.home?.teamId === teamId || m?.away?.teamId === teamId;
    const mine = schedule.filter(involvesTeam);

    // ESPN's `matchupPeriodId` is NOT the app's period number. The app counts scoring
    // periods (playoff rounds span two), so its "period 23" is ESPN matchupPeriodId 21.
    // Resolve in order of decreasing confidence rather than failing on an exact miss:
    //   1. exact matchupPeriodId, when the caller already speaks ESPN's numbering
    //   2. the league's own currentMatchupPeriod - the right answer during the season
    //   3. the last matchup this team has - the right answer once the season is over
    const currentPeriod = json?.status?.currentMatchupPeriod;
    const game =
      mine.find((m) => m?.matchupPeriodId === period) ??
      mine.find((m) => m?.matchupPeriodId === currentPeriod) ??
      mine.reduce(
        (best: any, m: any) =>
          !best || (m?.matchupPeriodId ?? -1) > (best?.matchupPeriodId ?? -1) ? m : best,
        null
      );

    if (!game) {
      return { status: 404, body: { error: `no matchup found for team ${teamId}` } };
    }

    const isHome = game.home?.teamId === teamId;
    const myside = isHome ? game.home : game.away;
    const theirs = isHome ? game.away : game.home;

    const meta = statMeta();
    return {
      status: 200,
      body: {
          requestedPeriod: period,
          // Which ESPN matchup this actually is, so the client can be honest about it
          // rather than implying it got the period it asked for.
          matchupPeriodId: game.matchupPeriodId ?? null,
          teamId,
          oppId: theirs?.teamId ?? null,
          stats: meta.stats,
          /*
           * `cumulativeScoreLive`, not `cumulativeScore` (fixed 2026-10-20). ESPN only rolls
           * a day's games into `cumulativeScore` once that scoring period is final, so on a
           * game night it still read 0-0 while ESPN's own page showed 35 points to 13 — the
           * "live" scoreboard was really end-of-yesterday. The Live field carries the banked
           * totals PLUS games in progress. Falls back to the settled one if Live is absent.
           */
          you: vectorFrom(
            (myside?.cumulativeScoreLive ?? myside?.cumulativeScore)?.scoreByStat,
            meta
          ),
          opp: vectorFrom(
            (theirs?.cumulativeScoreLive ?? theirs?.cumulativeScore)?.scoreByStat,
            meta
          ),
          // Per-player box lines, same shape as boxscores.json (BoxLine).
          youLines: boxLines(myside, meta),
          oppLines: boxLines(theirs, meta),
          // Who has already played TODAY (game finished or under way). The page takes those
          // games out of the projection, so live totals + projection count each game once.
          // Share of each team's game TODAY still to play (1 = not started, 0 = final),
          // keyed by the fantasy data's team abbreviation. Null if the NBA scoreboard
          // could not be read; the page then falls back to `*PlayedToday`.
          gameLeft: await gameLeftPromise,
          /*
           * EVERY matchup this period, live — for League Home's scores card. The response
           * already holds all of them (the filter is by period, not team), so this costs
           * nothing extra. Totals include games in progress, like `you`/`opp`.
           */
          games: schedule
            .filter((m) => m?.matchupPeriodId === game.matchupPeriodId)
            .map((m) => ({
              homeId: m?.home?.teamId ?? null,
              awayId: m?.away?.teamId ?? null,
              home: vectorFrom(
                (m?.home?.cumulativeScoreLive ?? m?.home?.cumulativeScore)?.scoreByStat,
                meta
              ),
              away: vectorFrom(
                (m?.away?.cumulativeScoreLive ?? m?.away?.cumulativeScore)?.scoreByStat,
                meta
              ),
              homePlayedToday: playedToday(m?.home),
              awayPlayedToday: playedToday(m?.away),
            })),
          youPlayedToday: playedToday(myside),
          oppPlayedToday: playedToday(theirs),
          // Each side's single-day lines for today, with lineup slot (Game Day).
          youToday: todayLines(myside, meta),
          oppToday: todayLines(theirs, meta),
          // Players on today's roster the export does not have there yet (pickups).
          youAdded: addedRows(teamId, myside),
          oppAdded: addedRows(theirs?.teamId, theirs),
          fetchedAt: new Date().toISOString(),
      },
    };
  } catch (err) {
    return { status: 502, body: { error: err instanceof Error ? err.message : "fetch failed" } };
  }
}

/**
 * The live payload for a server page's FIRST PAINT, or null to paint the snapshot as
 * before. Capped at `ms`: a page waits on this before it can render anything, and a slow
 * ESPN must cost a stale first paint (the poller still catches up), never a hung page.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function liveSeed(period: number, teamId: number, ms = 4000): Promise<any | null> {
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));
  const live = liveMatchup(period, teamId).then((r) => (r.status === 200 ? r.body : null));
  return Promise.race([live, timeout]).catch(() => null);
}
