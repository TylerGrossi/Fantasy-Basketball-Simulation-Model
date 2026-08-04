import PlayerCardView from "@/components/PlayerCardView";
import { loadLeague, trimLeague } from "@/lib/loadLeague";

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
  const slim = trimLeague(league, { playerPool: true });
  const pool = slim.seasonData.playerPool ?? [];
  const asked = sp.name?.trim();
  const initialName = asked && pool.some((p) => p.name === asked) ? asked : undefined;

  return (
    <>
      <h1>Player Card</h1>
      <p className="caption">Search any player and see their full profile.</p>
      <PlayerCardView league={slim} initialName={initialName} />
    </>
  );
}
