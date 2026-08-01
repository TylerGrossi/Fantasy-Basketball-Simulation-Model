import BenchView from "@/components/BenchView";
import { loadLeague, myTeam, resolveMatchup, trimLeague } from "@/lib/loadLeague";

/** `?demo=1` freezes the snapshot and skips the live fetch — see app/page.tsx. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const demo = (await searchParams).demo === "1";
  const league = await loadLeague();
  const me = await myTeam(league);
  const r = resolveMatchup(league, me.id);

  if (!r) {
    return (
      <>
        <h1>Bench</h1>
        <p className="caption">No matchup found for {me.name}.</p>
      </>
    );
  }

  // Only what this page's client component needs — see trimLeague.
  const slim = trimLeague(league, { matchupTeamId: me.id });
  return (
    <>
      <h1>Bench</h1>
      <p className="caption">
        Whether your remaining production actually helps. In a category league more
        volume can cost you percentages and turnovers.
      </p>
      <BenchView
        live={!demo}
        league={slim}
        matchup={r.matchup}
        isHome={r.isHome}
        teamId={me.id}
      />
    </>
  );
}
