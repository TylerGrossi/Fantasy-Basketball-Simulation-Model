import PlayerCardView from "@/components/PlayerCardView";
import { loadLeague, trimLeague } from "@/lib/loadLeague";

export default async function Page() {
  const league = await loadLeague();
  // Only what this page's client component needs — see trimLeague.
  const slim = trimLeague(league, { playerPool: true });
  return (
    <>
      <h1>Player Card</h1>
      <p className="caption">Search any player and see their full profile.</p>
      <PlayerCardView league={slim} />
    </>
  );
}
