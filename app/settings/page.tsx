import SettingsView from "@/components/SettingsView";
import { loadLeague, trimLeague } from "@/lib/loadLeague";

export default async function Page() {
  const league = await loadLeague();
  // Only what this page's client component needs — see trimLeague.
  const slim = trimLeague(league, {});
  return (
    <>
      <h1>Settings</h1>
      <p className="caption">
        Stored in this browser. ESPN credentials stay server-side and are never shown here.
      </p>
      <SettingsView league={slim} />
    </>
  );
}
