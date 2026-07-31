import { NextResponse } from "next/server";

/**
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

let cachedMeta: StatMeta | null = null;

function statMeta(): StatMeta {
  if (cachedMeta) return cachedMeta;
  const file = path.join(process.cwd(), "public", "data", "league.json");
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(parsed?.stats) || !parsed?.statIds) {
    throw new Error("league.json is missing stats/statIds — run `npm run data`");
  }
  cachedMeta = { stats: parsed.stats, statIds: parsed.statIds };
  return cachedMeta;
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const period = Number(url.searchParams.get("period"));
  const teamId = Number(url.searchParams.get("teamId"));
  if (!Number.isFinite(period) || !Number.isFinite(teamId)) {
    return NextResponse.json(
      { error: "period and teamId are required" },
      { status: 400 }
    );
  }

  const leagueId = process.env.ESPN_LEAGUE_ID;
  const season = process.env.ESPN_SEASON_YEAR;
  const s2 = process.env.ESPN_S2?.trim();
  const swid = process.env.ESPN_SWID?.trim();
  if (!leagueId || !season) {
    return NextResponse.json(
      { error: "ESPN_LEAGUE_ID / ESPN_SEASON_YEAR not configured" },
      { status: 500 }
    );
  }

  const endpoint =
    `https://lm-api-reads.fantasy.espn.com/apis/v3/games/fba/seasons/${season}` +
    `/segments/0/leagues/${leagueId}?view=mMatchupScore&view=mScoreboard` +
    `&scoringPeriodId=0&matchupPeriodId=${period}`;

  try {
    const res = await fetch(endpoint, {
      headers: {
        accept: "application/json",
        // Private leagues need the auth cookies; public ones ignore them.
        ...(s2 && swid ? { cookie: `espn_s2=${s2}; SWID=${swid}` } : {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `ESPN returned ${res.status}` },
        { status: 502 }
      );
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
      return NextResponse.json(
        { error: `no matchup found for team ${teamId}` },
        { status: 404 }
      );
    }

    const isHome = game.home?.teamId === teamId;
    const myside = isHome ? game.home : game.away;
    const theirs = isHome ? game.away : game.home;

    const meta = statMeta();
    return NextResponse.json(
      {
        requestedPeriod: period,
        // Which ESPN matchup this actually is, so the client can be honest about it
        // rather than implying it got the period it asked for.
        matchupPeriodId: game.matchupPeriodId ?? null,
        teamId,
        oppId: theirs?.teamId ?? null,
        stats: meta.stats,
        you: vectorFrom(myside?.cumulativeScore?.scoreByStat, meta),
        opp: vectorFrom(theirs?.cumulativeScore?.scoreByStat, meta),
        fetchedAt: new Date().toISOString(),
      },
      // Small shared cache window: repeated loads within a minute reuse the response,
      // but the numbers still track games finishing through the evening.
      { headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=120" } }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "fetch failed" },
      { status: 502 }
    );
  }
}
