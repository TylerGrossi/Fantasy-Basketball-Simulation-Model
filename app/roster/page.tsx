import RosterView from "@/components/RosterView";
import { loadLeague, myTeam, resolveMatchup } from "@/lib/loadLeague";

export default async function Page() {
  const league = await loadLeague();
  const me = myTeam(league);
  const r = resolveMatchup(league, me.id);

  if (!r) {
    return (
      <>
        <h1>Rosters</h1>
        <p className="caption">No matchup found for {me.name}.</p>
      </>
    );
  }

  const you = r.isHome ? r.matchup.home : r.matchup.away;
  const opp = r.isHome ? r.matchup.away : r.matchup.home;

  return (
    <>
      <h1>Rosters</h1>
      <p className="caption">
        Per-game averages (season blended with last 30 days) and games remaining.
      </p>
      <RosterView
        league={league}
        you={you}
        opp={opp}
        youName={r.youName}
        oppName={r.oppName}
      />
    </>
  );
}
