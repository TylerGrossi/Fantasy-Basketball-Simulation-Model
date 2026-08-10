import SeasonStatsView, { type SeasonPlayer } from "@/components/SeasonStatsView";
import { loadLeague, myTeam } from "@/lib/loadLeague";

/** Every stat the table's column groups can draw from. */
const STATS = [
  "PTS", "REB", "AST", "STL", "BLK", "TO",
  "FGM", "FGA", "FTM", "FTA", "3PM", "3PA",
  "DD", "TW",
];

/**
 * Your roster, player by player: who carried which category, and every line behind it.
 *
 * The TEAM's own season totals are not here — they are a league-comparison number
 * (they only mean anything next to the other nine teams), so they live on /league-stats
 * where that comparison already is.
 */
export default async function Page() {
  const league = await loadLeague();
  const me = await myTeam(league);
  const ts = league.seasonData?.teamSeasonStats?.[String(me.id)];
  const standings = league.seasonData?.standings ?? [];

  if (!ts?.players?.length) {
    return (
      <>
        <h1>Season Stats</h1>
        <p className="caption">No season stats — run the data export.</p>
      </>
    );
  }

  // Two sources, deliberately merged: `ts.totals` carries FTM/FTA/3PA, which are not
  // scored categories and so are absent from `catTotals`; `catTotals` carries DD and TW,
  // which `ts.totals` has no entry for. They agree on every stat they share.
  const mine = standings.find((s) => s.teamId === me.id);
  const teamTotals: Record<string, number> = { ...(mine?.catTotals ?? {}), ...ts.totals };

  const players: SeasonPlayer[] = ts.players.map((p) => {
    const stats: Record<string, number> = {};
    for (const s of STATS) stats[s] = Number(p[s] ?? 0);
    return { name: p.name, gp: p.gp, stats };
  });

  /*
   * There is no separate "top contributors" block. It was a grid of KPI cards, one per
   * category, and it restated what the table below it already held — eight cards carrying
   * three names, since the same two players led most categories. The table marks its own
   * column leaders in bold instead (see SeasonStatsView), the way a reference table has
   * always done it: one place to look, and it follows the sort and unit toggles for free.
   */
  return (
    <>
      <h1>Season Stats</h1>

      <h2>Player contributions</h2>
      <SeasonStatsView players={players} teamTotals={teamTotals} />
    </>
  );
}
