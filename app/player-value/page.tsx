import PlayerValueView from "@/components/PlayerValueView";
import { loadArchivedPools, loadLeague, trimLeague } from "@/lib/loadLeague";

export default async function Page() {
  const league = await loadLeague();
  // Only what this page's client component needs — see trimLeague.
  const slim = trimLeague(league, { playerPool: true });
  // Past seasons for the Season filter — the same slimmed pools the Player Card uses.
  const archives = await loadArchivedPools(league.season);
  return (
    <>
      <h1>Player Value</h1>
      <PlayerValueView league={slim} archives={archives} />
    </>
  );
}
