import CheatSheetView from "@/components/CheatSheetView";
import { loadLeague, myTeam } from "@/lib/loadLeague";

/**
 * Draft-style cheat sheet — one ranked column per position, your roster and a
 * comparison group shaded down the list.
 *
 * Only the player pool crosses to the client: the columns are built from `name`,
 * `nbaTeam`, `eligibleSlots`, `owner`, `status` and `value`, and nothing else on the
 * page needs a matchup, a schedule or a season table.
 */
export default async function Page() {
  const league = await loadLeague();
  const me = await myTeam(league);
  const pool = league.seasonData?.playerPool ?? [];

  if (!pool.length) {
    return (
      <>
        <h1>Cheat Sheets</h1>
        <p className="caption">No player pool data — run <code>npm run data</code>.</p>
      </>
    );
  }

  // Ordered as the standings are, so the picker reads like the rest of the app. Built
  // from the TEAM list rather than from the pool's `owner` strings, which would drop a
  // team that happens to roster nobody in the pool.
  const teams = league.teams.map((t) => t.name);

  return (
    <>
      <h1>Cheat Sheets</h1>
      <CheatSheetView pool={pool} teams={teams} myTeam={me.name} />
    </>
  );
}
