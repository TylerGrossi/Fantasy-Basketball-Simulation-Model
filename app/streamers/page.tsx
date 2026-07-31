import StreamersView from "@/components/StreamersView";
import { loadLeague, myTeam, resolveMatchup } from "@/lib/loadLeague";

/**
 * `?demo=1` freezes the page on the build-time snapshot and skips the live fetch.
 *
 * Useful in the offseason to see the live projection UI, but it also prevents a real
 * failure mode: `current` and `projMu` in the snapshot are a matched pair describing one
 * moment. Fetching live totals replaces `current` but not the projection, so against a
 * hand-made or stale snapshot you can get an impossible state (the final score alongside
 * games still to play) and every derived number becomes nonsense.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const demo = (await searchParams).demo === "1";
  const league = await loadLeague();
  const me = myTeam(league);
  const r = resolveMatchup(league, me.id);

  if (!r) {
    return (
      <>
        <h1>Streamers</h1>
        <p className="caption">No matchup found for {me.name}.</p>
      </>
    );
  }

  return (
    <>
      <h1>Streamers</h1>
      <p className="caption">
        Every free agent scored against every legal drop, ranked by how much they move
        your expected category total.
      </p>
      <StreamersView
        live={!demo}
        league={league}
        matchup={r.matchup}
        isHome={r.isHome}
        teamId={me.id}
      />
    </>
  );
}
