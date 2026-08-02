import SettingsView from "@/components/SettingsView";
import { loadLeague, trimLeague } from "@/lib/loadLeague";

export default async function Page() {
  const league = await loadLeague();
  // Only what this page's client component needs — see trimLeague.
  const slim = trimLeague(league, {});
  // Counted from the FULL league and passed as a number. The panel used to count
  // `slim.seasonData.playerPool`, which trimLeague had just emptied — so a 289-player
  // export reported "Players in pool: 0". Shipping the pool to fix it would put 100 KB
  // into a page that shows one integer.
  const poolSize = league.seasonData.playerPool?.length ?? 0;
  return (
    <>
      <h1>Settings</h1>
      <p className="caption">
        Stored in this browser. ESPN credentials stay server-side and are never shown here.
      </p>
      <SettingsView league={slim} poolSize={poolSize} />
    </>
  );
}
