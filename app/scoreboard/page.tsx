import { PlayerBoxTable } from "@/components/BoxScoreSheet";
import Scoreboard from "@/components/Scoreboard";
import ScoreboardTabs from "@/components/ScoreboardTabs";
import { buildWeekRecap } from "@/components/WeekRecap";
import WeekSelect from "@/components/WeekSelect";
import { periodLabel } from "@/lib/league";
import {
  loadBoxScores,
  loadLeague,
  myTeam,
  resolveMatchup,
  trimLeague,
} from "@/lib/loadLeague";

/**
 * THE week page. One picker, three states, decided by which week you choose:
 *
 *   past     a RECAP — ESPN's own box-score layout: the head-to-head category sheet, the
 *            acquisition line, and a per-player table for each side
 *   current  the same layout, LIVE — banked totals fetched fresh, projections untouched
 *   future   a PREVIEW — nothing is banked yet, so it is projection only
 *
 * Every state renders through the SAME three panels (your box score / the head-to-head /
 * their box score) via `ScoreboardTabs` — a mobile segmented control, a continuous stacked
 * page on desktop. The model (win probability, score distribution, per-category
 * projection) lives on /matchup and this page does not touch it — that split was a
 * deliberate call: this page is what a raw ESPN box score shows, /matchup is what the
 * simulation adds on top of it.
 *
 * `?demo=1` freezes the page on the build-time snapshot and skips the live fetch.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string; period?: string; game?: string }>;
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
  const abbrev = (id: number) => byId.get(id)?.abbrev || byId.get(id)?.name.slice(0, 4) || "";

  // ---- a completed week: the recap ----
  if (isPast && asked < league.period) {
    // Which game the strip has selected. Validated against the teams that actually
    // played this period, so a stale or hand-edited `?game=` falls back to your own
    // matchup instead of rendering an empty recap.
    const played = (league.periodResults ?? [])
      .find((p) => p.period === asked)
      ?.games.flatMap((g) => [g.homeId, g.awayId]);
    const wanted = Number(sp.game);
    const focusId =
      Number.isFinite(wanted) && played?.includes(wanted) ? wanted : me.id;

    const recap = buildWeekRecap({
      league, period: asked, teamId: focusId, myTeamId: me.id,
      box: await loadBoxScores(),
    });

    if (!recap) {
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

    return (
      <>
        <WeekSelect weeks={weeks} selected={asked} current={league.period} />
        <ScoreboardTabs
          // The tabs name the SELECTED game's two teams, which are only your own when
          // the strip is on your matchup.
          key={focusId}
          mineLabel={abbrev(focusId)}
          oppLabel={abbrev(recap.oppId)}
          board={recap.board}
          mine={recap.mine}
          matchup={recap.matchup}
          opp={recap.opp}
        />
      </>
    );
  }

  // ---- a week that has not started: projection only, nothing banked ----
  if (isPast && asked > league.period) {
    return (
      <>
        <WeekSelect weeks={weeks} selected={asked} current={league.period} />
        <p className="notice">
          {periodLabel(league, asked)} hasn&rsquo;t started. Projections appear once the
          export covers it — the snapshot only carries rosters and games left for the
          CURRENT period.
        </p>
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

  // Same box lines / acquisition data the recap uses, for THIS period — populated because
  // the exporter always includes the currently-active period even when the schedule table
  // only logs the first half of a playoff round under it (see build_period_results).
  const box = await loadBoxScores();
  const currentGame = league.periodResults
    ?.find((p) => p.period === league.period)
    ?.games.find((g) => g.homeId === me.id || g.awayId === me.id);
  const youAcq = currentGame && (r.isHome ? currentGame.homeAcq : currentGame.awayAcq);
  const oppAcq = currentGame && (r.isHome ? currentGame.awayAcq : currentGame.homeAcq);
  const lines = (id: number) => box?.periods[String(league.period)]?.[String(id)] ?? [];
  const gp = (id: number) => lines(id).reduce((a, l) => a + (l.gp || 0), 0);

  return (
    <>
      <WeekSelect weeks={weeks} selected={league.period} current={league.period} />
      {/* Unlike the recap above, the live week composes the tabs from INSIDE `Scoreboard`
          — the board renders twice (above the tabs on mobile, in the panel on desktop) and
          both copies have to come from its one `useLiveTotals`. The box tables are still
          built here, on the server, and handed down. */}
      <Scoreboard
        key={league.period}
        live={!demo}
        league={slim}
        matchup={r.matchup}
        isHome={r.isHome}
        teamId={me.id}
        youName={r.youName}
        oppName={r.oppName}
        youAcq={youAcq}
        oppAcq={oppAcq}
        youGp={gp(me.id)}
        oppGp={gp(r.oppId)}
        mineLabel={abbrev(me.id)}
        oppLabel={abbrev(r.oppId)}
        mine={
          <PlayerBoxTable
            title={`${r.youName} box score`}
            stats={box?.stats ?? league.stats}
            lines={lines(me.id)}
          />
        }
        opp={
          <PlayerBoxTable
            title={`${r.oppName} box score`}
            stats={box?.stats ?? league.stats}
            lines={lines(r.oppId)}
          />
        }
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
    // Named by periodLabel, NOT by the export's own `matchup` string. The export carries
    // ESPN's wording with a date range ("Playoff Round 1 (Mar 09 - Mar 22)"), and mixing
    // it with the app's naming for the current period is what put "Playoff Round 1" and
    // "Playoffs · Round 2" in the same menu.
    .map((r) => ({ period: r.period, label: periodLabel(league, r.period) }));

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
