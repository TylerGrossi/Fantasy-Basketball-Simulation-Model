import PlayerValueView from "@/components/PlayerValueView";
import { loadLeague, trimLeague } from "@/lib/loadLeague";

export default async function Page() {
  const league = await loadLeague();
  // Only what this page's client component needs — see trimLeague.
  const slim = trimLeague(league, { playerPool: true });
  return (
    <>
      <h1>Player Value</h1>
      <p className="caption">
        Every rostered player and the top free agents, ranked by 9-cat value.
      </p>
      <PlayerValueView league={slim} />
    </>
  );
}
