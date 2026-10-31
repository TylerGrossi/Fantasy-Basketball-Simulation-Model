import { loadLeague } from "@/lib/loadLeague";
import { buildSeasonContext } from "@/lib/playoffOdds";
import RecentMovesView from "@/components/RecentMovesView";

/**
 * League-wide transaction feed — ESPN's "Recent Activity": every add, drop, waiver
 * claim, and trade, newest first, with team/player/move-type/date filters. Baked into
 * the season export (`recentMoves` in `scripts/build_data.py`) rather than fetched
 * live — like the rest of the season-wide pages, it only needs to be as fresh as the
 * last `npm run data` run, and doing it that way keeps the page a plain server
 * component (filtering happens client-side over the ~150 exported rows).
 */
export default async function Page() {
  const league = await loadLeague();
  const moves = league.seasonData?.recentMoves ?? [];

  /**
   * Join each move to the player's 9-cat value, so the feed can be judged and not just
   * read — dropping a +13 is a different story from dropping a −2.
   *
   * Done HERE rather than in the export: the value already ships in `playerPool`, and
   * writing it into `recentMoves` too would be the same number in two places, free to
   * drift the moment one is regenerated without the other.
   *
   * Only the joined rows cross to the client, never the pool itself (see trimLeague's
   * note about payload size). `null` for the handful of players who have since left the
   * pool entirely — 12 of 838 rows — which the column prints as a dash.
   */
  const valueOf = new Map(
    (league.seasonData?.playerPool ?? []).map((p) => [p.name, p.value])
  );
  const rows = moves.map((m) => ({ ...m, value: valueOf.get(m.player) ?? null }));

  // This matchup's "acquisitions used of allowed", per team NAME — ESPN's own counter,
  // from the current period's results. Absent for a team the export could not resolve.
  const nameOf = new Map(league.teams.map((t) => [t.id, t.name]));
  const week: Record<string, { used: number; max: number }> = {};
  for (const g of league.periodResults?.find((p) => p.period === league.period)?.games ?? []) {
    if (g.homeAcq) week[nameOf.get(g.homeId) ?? ""] = g.homeAcq;
    if (g.awayAcq) week[nameOf.get(g.awayId) ?? ""] = g.awayAcq;
  }

  /*
   * What each swap does to its team's playoff / title odds (lib/playoffOdds.ts, the same
   * simulation as the Streamers table). Only the players these moves touch cross to the
   * client, plus every roster and the remaining schedule — not the pool.
   */
  const ctx = league.teams.length
    ? buildSeasonContext(league, league.teams[0].id, new Set(moves.map((m) => m.player)))
    : null;
  const odds = ctx
    ? {
        ctx,
        teamIds: Object.fromEntries(league.teams.map((t) => [t.name, t.id])),
        meta: {
          stats: league.stats,
          categories: league.categories,
          lowerIsBetter: league.lowerIsBetter,
          variance: league.variance,
          projectionError: league.projectionError,
        },
      }
    : null;

  if (!rows.length) {
    return (
      <>
        <h1>Recent Moves</h1>
        <p className="caption">No recent activity — run the data export.</p>
      </>
    );
  }

  return (
    <>
      <h1>Recent Moves</h1>
      <RecentMovesView
        rows={rows}
        week={week}
        teams={league.teams.map((t) => t.name)}
        odds={odds}
      />
    </>
  );
}
