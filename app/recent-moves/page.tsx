import { loadLeague } from "@/lib/loadLeague";
import RecentMovesView from "@/components/RecentMovesView";

/**
 * League-wide transaction feed — ESPN's "Recent Activity": every add, drop, waiver
 * claim, and trade, newest first, with team/player/move-type/date filters. Baked into
 * the season export (`recentMoves` in `scripts/build_data.py`) rather than fetched
 * live — like the rest of the season-wide pages, it only needs to be as fresh as the
 * last `npm run data` run, and doing it that way keeps the page a plain server
 * component (filtering happens client-side over the ~150 exported rows).
 */
export default async function Page() {
  const league = await loadLeague();
  const rows = league.seasonData?.recentMoves ?? [];

  if (!rows.length) {
    return (
      <>
        <h1>Recent Moves</h1>
        <p className="caption">No recent activity — run the data export.</p>
      </>
    );
  }

  return (
    <>
      <h1>Recent Moves</h1>
      <p className="caption">
        The league&apos;s latest adds, drops, waiver claims, and trades, newest first.
      </p>
      <RecentMovesView rows={rows} />
    </>
  );
}
