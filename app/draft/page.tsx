import DraftBoardView from "@/components/DraftBoardView";
import { loadLeague } from "@/lib/loadLeague";
import { scorableCategories } from "@/lib/playerPool";
import { draftablePoolSize, projectPool } from "@/lib/projection";

/**
 * The draft guide for next season.
 *
 * The projection runs HERE, on the server, not in the browser: it is a fixed function of
 * the export, so recomputing it per visitor would be waste, and the pool it reads is
 * bigger than the lines it produces. Only the projected lines cross to the client, which
 * then re-scores them on every filter and punt change (`scoreProjections`) — the same
 * slow-tier / fast-tier split the rest of the app uses.
 *
 * Note this page deliberately does NOT call `trimLeague`: it never hands the client a
 * `LeagueData` at all, just an array of projections, so there is nothing to trim.
 */
export default async function Page() {
  const league = await loadLeague();
  const pool = league.seasonData.playerPool ?? [];
  const lines = projectPool(pool);

  // The league's OWN categories, not the conventional nine. This league scores fifteen
  // — including the volume categories FGA and 3PA, which changes who is valuable in it —
  // so ranking a draft board for it on 9-cat would be ranking a game nobody here plays.
  // The nine are still offered as an alternate basis in the view.
  const leagueCats = scorableCategories(league.categories);

  const nextSeason = `${league.season}-${String((league.season + 1) % 100).padStart(2, "0")}`;

  return (
    <>
      <h1>Draft Guide</h1>
      <p className="caption">
        A tiered board for the {nextSeason} draft, ranked on projected production rather
        than last season&rsquo;s box score.
      </p>
      {lines.length === 0 ? (
        <p className="caption">No player pool data — run the data export.</p>
      ) : (
        <DraftBoardView
          lines={lines}
          leagueCats={leagueCats}
          lowerIsBetter={league.lowerIsBetter}
          poolSize={draftablePoolSize(league.teams.length || 10)}
          season={league.season}
        />
      )}
    </>
  );
}
