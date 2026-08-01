import TradeView from "@/components/TradeView";
import { loadLeague, myTeam, trimLeague } from "@/lib/loadLeague";

export default async function Page() {
  const league = await loadLeague();
  const me = await myTeam(league);
  // Only what this page's client component needs — see trimLeague.
  const slim = trimLeague(league, { playerPool: true });
  return (
    <>
      <h1>Trade Simulator</h1>
      <p className="caption">
        Pick who goes out and who comes in. Value and the category swing update instantly.
      </p>
      <TradeView league={slim} myTeamName={me.name} />
    </>
  );
}
