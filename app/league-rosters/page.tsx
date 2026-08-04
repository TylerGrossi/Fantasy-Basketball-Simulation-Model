import LeagueRostersView from "@/components/LeagueRostersView";
import { loadLeague, trimLeague } from "@/lib/loadLeague";

/** Every team's full roster, one card per team — the league-wide ESPN-style roster view. */
export default async function Page() {
  const full = await loadLeague();
  const league = trimLeague(full, { playerPool: true, seasonTables: true });
  const pool = league.seasonData?.playerPool ?? [];

  if (!league.teams.length || !pool.length) {
    return (
      <>
        <h1>League Rosters</h1>
        <p className="caption">No league data — run the data export.</p>
      </>
    );
  }

  return (
    <>
      <h1>League Rosters</h1>
      <LeagueRostersView league={league} />
    </>
  );
}
