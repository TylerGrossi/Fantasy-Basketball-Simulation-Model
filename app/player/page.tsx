import PlayerCardView from "@/components/PlayerCardView";
import { loadArchivedPools, loadLeague, trimLeague } from "@/lib/loadLeague";

/**
 * `?name=` opens the card on a specific player — the target of every `<PlayerLink>` in
 * the app. Validated against the pool HERE rather than in the client component, so a
 * stale bookmark or a hand-edited URL falls back to the default player instead of
 * rendering an empty card.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ name?: string }>;
}) {
  const sp = await searchParams;
  const league = await loadLeague();
  // Only what this page's client component needs — see trimLeague.
  const trimmed = trimLeague(league, { playerPool: true });
  // Each row's three-season `history` is 72 KB of the pool's 195 KB, and nothing on the
  // card reads it (only the projection model and the Agent do, both server-side). It was
  // being serialised into every card's page for nothing.
  const pool = (trimmed.seasonData.playerPool ?? []).map(({ history: _h, ...p }) => p);
  const slim = { ...trimmed, seasonData: { ...trimmed.seasonData, playerPool: pool } };
  // Past seasons for the percentile panel's season picker.
  const archives = await loadArchivedPools(league.season);
  const asked = sp.name?.trim();
  const initialName = asked && pool.some((p) => p.name === asked) ? asked : undefined;

  return (
    <>
      {/* Desktop-only chrome. On a phone the card itself leads with the player's
          headshot and name, which says what the page is far better than a title and a
          sentence of instructions — and buys back the vertical space they cost. */}
      <div className="pd-page-head">
        <h1>Player Card</h1>
        <p className="caption">Search any player and see their full profile.</p>
      </div>
      <PlayerCardView league={slim} archives={archives} initialName={initialName} />
    </>
  );
}
