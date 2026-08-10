import MatchupView from "@/components/MatchupView";
import PhaseBanner from "@/components/PhaseBanner";
import { livePhase, phaseFrom, phasedMatchup } from "@/lib/matchupPhase";
import { loadLeague, loadPredictions, myTeam, resolveMatchup, trimLeague } from "@/lib/loadLeague";
import { forecastFor } from "@/lib/predictions";

/**
 * The SIMULATION view — win probability, score distribution, category analysis and the
 * detailed per-category projections. Deliberately about the model, not the raw numbers:
 * the week's actual totals (and past weeks) live on the Scoreboard tab.
 *
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
  searchParams: Promise<{ demo?: string; phase?: string }>;
}) {
  const sp = await searchParams;
  const demo = sp.demo === "1";
  // A dev-only override with no UI behind it — see phaseFrom.
  const override = phaseFrom(sp.phase);
  const league = await loadLeague();
  const me = await myTeam(league);
  const r = resolveMatchup(league, me.id);
  // What the model said before this week was played, if it was logged at the time.
  // Null for every week predating the forecast log — see lib/predictions.ts.
  const forecast = forecastFor(await loadPredictions(), league, league.period, me.id);

  if (!r) {
    return (
      <>
        <h1>Matchup</h1>
        <p className="caption">No matchup found for {me.name} in period {league.period}.</p>
      </>
    );
  }

  // Only what this page's client component needs — see trimLeague.
  const slim = trimLeague(league, { matchupTeamId: me.id });
  // Same helper the scoreboard page uses: the team's own abbrev, or the first few letters
  // of its name when ESPN has none.
  const byId = new Map(league.teams.map((t) => [t.id, t]));
  const abbrev = (id: number) =>
    byId.get(id)?.abbrev || byId.get(id)?.name.slice(0, 4) || "";
  const matchup = override ? phasedMatchup(league, r.matchup, override) : r.matchup;
  // The real state of the week, which moves pre -> mid -> final on its own as games
  // are played. Nothing selects it; it is read off the matchup.
  const phase = override ?? livePhase(matchup);
  return (
    <>
      <h1>Matchup</h1>
      {/* The phase caption was removed: the panels below state the week's state
          themselves, and on a phone it was a line of prose between the title and the
          number you came for. PhaseBanner still calls out the dev-only simulated week,
          which is the one case nothing else on the page announces. */}
      <PhaseBanner phase={override} />
      <MatchupView
        live={!demo && !override}
        simulated={!!override}
        league={slim}
        matchup={matchup}
        isHome={r.isHome}
        teamId={me.id}
        youName={r.youName}
        oppName={r.oppName}
        // Abbreviations for the Final totals table's column headers — see the prop's note
        // in MatchupView. Falls back to a name slice when a team has no abbrev set, so the
        // column always has a short label rather than an empty one.
        youAbbrev={abbrev(me.id)}
        oppAbbrev={abbrev(r.oppId)}
        forecast={forecast}
      />
    </>
  );
}
