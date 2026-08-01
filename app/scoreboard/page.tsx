import Scoreboard from "@/components/Scoreboard";
import WeekSelect from "@/components/WeekSelect";
import { periodLabel } from "@/lib/league";
import type { Matchup } from "@/lib/league";
import { loadLeague, myTeam, resolveMatchup, trimLeague } from "@/lib/loadLeague";

/**
 * The week's NUMBERS — this week live, or any completed week via `?period=`. The
 * simulation analytics (win probability, distributions, projections) are the Matchup tab.
 *
 * Every week renders through the SAME <Scoreboard>. A finished week is not a different
 * kind of page, it is the same board with zero games left: the totals become final and
 * the projection terms go to zero. Building a separate "past week" layout was the wrong
 * call — switching weeks should change the data, not the view.
 *
 * `?demo=1` freezes the page on the build-time snapshot and skips the live fetch.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string; period?: string }>;
}) {
  const sp = await searchParams;
  const demo = sp.demo === "1";
  const league = await loadLeague();
  const me = await myTeam(league);

  const weeks = weekOptions(league, me.id);
  const asked = Number(sp.period);
  const isPast =
    sp.period != null && Number.isFinite(asked) && asked !== league.period;

  const slim = trimLeague(league, { matchupTeamId: me.id });
  const byId = new Map(league.teams.map((t) => [t.id, t]));

  // ---- a completed week: same board, historical totals, no live fetch ----
  if (isPast) {
    const game = league.periodResults
      ?.find((p) => p.period === asked)
      ?.games.find((g) => g.homeId === me.id || g.awayId === me.id);

    if (!game) {
      return (
        <>
          <WeekSelect weeks={weeks} selected={asked} current={league.period} />
          <p className="notice">
            No result recorded for matchup {asked} — it was a bye, or the export predates
            it. Re-run <code>npm run data</code>.
          </p>
        </>
      );
    }

    // A finished week has no games remaining, so the projection terms are zero and
    // `current` carries the whole story. That is exactly the shape Scoreboard expects.
    const zero = league.stats.map(() => 0);
    const side = (current: number[]) => ({
      players: [],
      projMu: zero,
      projVar: zero,
      current,
    });
    const matchup: Matchup = {
      homeId: game.homeId,
      awayId: game.awayId,
      home: side(game.home),
      away: side(game.away),
    };
    const isHome = game.homeId === me.id;
    const oppId = isHome ? game.awayId : game.homeId;

    return (
      <>
        <WeekSelect weeks={weeks} selected={asked} current={league.period} />
        <Scoreboard
          /* Remount when the week changes. useLiveTotals seeds its totals with
             useState(snapshot), which only applies on mount — without a changing key
             React reuses the instance and the previous week's numbers stick. */
          key={asked}
          live={false}
          league={slim}
          matchup={matchup}
          isHome={isHome}
          teamId={me.id}
          youName={byId.get(me.id)?.name ?? "Your team"}
          oppName={byId.get(oppId)?.name ?? "Opponent"}
        />
      </>
    );
  }

  // ---- the current week ----
  const r = resolveMatchup(league, me.id);
  if (!r) {
    return (
      <>
        <h1>Scoreboard</h1>
        <p className="caption">
          No matchup found for {me.name} in period {league.period}.
        </p>
      </>
    );
  }

  return (
    <>
      <WeekSelect weeks={weeks} selected={league.period} current={league.period} />
      <Scoreboard
        key={league.period}
        live={!demo}
        league={slim}
        matchup={r.matchup}
        isHome={r.isHome}
        teamId={me.id}
        youName={r.youName}
        oppName={r.oppName}
      />
    </>
  );
}

/**
 * The weeks this team actually played, newest last.
 *
 * Driven by the SCHEDULE, not by the exported box scores. ESPN has scoring periods a team
 * has no matchup in — period 21 sits between the two playoff rounds and showed up as a
 * phantom week when the list came from `periodResults`. The schedule is the authoritative
 * list of "weeks you played", so it decides; the results only have to exist for it.
 */
function weekOptions(
  league: Awaited<ReturnType<typeof loadLeague>>,
  teamId: number
): { period: number; label: string }[] {
  const played = new Set(
    (league.periodResults ?? [])
      .filter((p) => p.games.some((g) => g.homeId === teamId || g.awayId === teamId))
      .map((p) => p.period)
  );

  const rows = league.seasonData?.schedules?.[String(teamId)] ?? [];
  const out = rows
    .filter((r) => played.has(r.period) && r.period !== league.period)
    // "Playoff Round 1 (Mar 09 - Mar 22)" -> "Playoff Round 1"
    .map((r) => ({
      period: r.period,
      label: (r.matchup || `Matchup ${r.period}`).replace(/\s*\(.*\)\s*$/, ""),
    }));

  // A playoff round spans two scoring periods, so the CURRENT period and the schedule's
  // row for the same round are one matchup under two numbers ("Playoff Round 2" / period
  // 22 vs "Playoffs · Round 2" / period 23). Listing both offers the same week twice —
  // keep the current period, since that is the one with live data.
  const currentLabel = periodLabel(league);
  const round = (s: string) => s.match(/round\s*(\d+)/i)?.[1] ?? null;
  const currentRound = round(currentLabel);
  const deduped = currentRound
    ? out.filter((o) => round(o.label) !== currentRound)
    : out;

  deduped.push({ period: league.period, label: currentLabel });
  return deduped.sort((a, b) => a.period - b.period);
}
