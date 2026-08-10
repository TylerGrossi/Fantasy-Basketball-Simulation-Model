import SeasonSummaryView, { type SummaryRow } from "@/components/SeasonSummaryView";
import { loadLeague, myTeam } from "@/lib/loadLeague";
import type { StandingRow } from "@/lib/league";

/**
 * Season Summary: champion, one team's headline numbers, and the final standings.
 *
 * Deliberately narrow — this is the landing page for "how did the season go", and the
 * Streamlit version it replaces was tuned to fit one 1080p screen without scrolling.
 * Per-category season totals are NOT here; they live on /league-stats, with each team's
 * rank in every category, which is the version worth reading.
 *
 * A thin server shim: it maps the standings down to the compact rows the view needs and
 * hands them over. `StandingRow` carries `catTotals` — fifteen numbers per team that this
 * page never shows — and anything passed to a client component is serialised into the
 * page payload, so the mapping is what keeps 150 unused figures out of the HTML.
 */
export default async function Page() {
  const league = await loadLeague();
  const me = await myTeam(league);
  const standings = league.seasonData?.standings ?? [];

  if (!standings.length) {
    return (
      <>
        <h1>Season</h1>
        <p className="caption">No season data — run `npm run data`.</p>
      </>
    );
  }

  const rows: SummaryRow[] = [...standings]
    .sort((a, b) => rankOf(a) - rankOf(b))
    .map((t) => ({
      teamId: t.teamId,
      teamName: t.teamName,
      rank: rankOf(t),
      record: `${t.wins}-${t.losses}-${t.ties}`,
      winPct: t.winPct,
      allPlayPct: t.allPlayPct,
      luck: t.luck,
    }));

  const yr = `${league.season - 1}–${String(league.season).slice(2)}`;

  return (
    <>
      <h1 className="ss-title">
        {yr} Season {league.seasonOver ? "Complete" : "So Far"}
      </h1>

      <div className="ss-col">
        <SeasonSummaryView
          rows={rows}
          myTeamId={me.id}
          seasonOver={league.seasonOver}
        />
      </div>
    </>
  );
}

/**
 * Where the league actually finished them. `finalStanding` is ESPN's post-bracket
 * placing; it's 0 until the playoffs resolve, so fall back to the category-record order.
 */
function rankOf(t: StandingRow): number {
  return t.finalStanding || t.standing;
}
