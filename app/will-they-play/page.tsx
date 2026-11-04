import WillTheyPlayView from "@/components/WillTheyPlayView";
import { loadAvailability, loadLeague, myTeam } from "@/lib/loadLeague";

/**
 * Will They Play (owner, 2026-11-03): each player's chance of playing, from the injury
 * report models in scripts/injury/. Reads public/data/availability.json only — the page
 * carries no league data beyond the team name.
 */
export default async function Page() {
  const [league, data] = await Promise.all([loadLeague(), loadAvailability()]);
  const me = await myTeam(league);
  return (
    <>
      <h1>Will They Play</h1>
      <WillTheyPlayView data={data} myTeamName={me.name} />
    </>
  );
}
