import CompareView from "@/components/CompareView";
import { loadLeague, trimLeague } from "@/lib/loadLeague";

export default async function Page() {
  const league = await loadLeague();
  // Only what this page's client component needs — see trimLeague.
  const slim = trimLeague(league, { playerPool: true });
  return (
    <>
      <h1>Compare</h1>
      <p className="caption">Two players, category by category.</p>
      <CompareView league={slim} />
    </>
  );
}
