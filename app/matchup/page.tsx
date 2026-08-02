import MatchupView from "@/components/MatchupView";
import type { Tape, TapeSide } from "@/components/MatchupView";
import { playerMoments } from "@/lib/league";
import type { LeagueData, Matchup, StandingRow, TeamSide } from "@/lib/league";
import { loadLeague, myTeam, resolveMatchup, trimLeague } from "@/lib/loadLeague";

/**
 * Rebuild a MID-WEEK state from the completed week, so the live simulation UI can be
 * seen out of season.
 *
 * The season is over, so every real matchup has zero games left — which means zero
 * variance, and every probability collapses to 0% or 100%. That is correct but shows
 * nothing about how the page looks when it matters.
 *
 * This is a genuine simulation, not mocked numbers: real rosters, real per-game averages,
 * real variances. Only two things are assumed — that some games remain, and that the
 * banked totals are partway to the final. It is clearly labelled in the UI, because a
 * synthetic state must never be mistakable for live data.
 */
const PREVIEW_BANKED = 0.55; // fraction of the final totals treated as already played

function midweekMatchup(league: LeagueData, m: Matchup): Matchup {
  const side = (s: TeamSide): TeamSide => {
    // Healthy players get games left; injured ones stay out, as in a real week.
    const players = s.players.map((p, i) => ({
      ...p,
      gamesLeft: p.injured ? 0 : (i % 3 === 0 ? 3 : 2),
    }));

    const mu = league.stats.map(() => 0);
    const va = league.stats.map(() => 0);
    for (const p of players) {
      const pm = playerMoments(p.avg, p.gamesLeft, league.variance);
      for (let i = 0; i < mu.length; i++) {
        mu[i] += pm.mu[i];
        va[i] += pm.var[i];
      }
    }
    return {
      players,
      projMu: mu,
      projVar: va,
      current: s.current.map((v) => Math.round(v * PREVIEW_BANKED)),
    };
  };
  return { ...m, home: side(m.home), away: side(m.away) };
}

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
/**
 * The two teams' seasons, side by side, for the completed-matchup recap.
 *
 * Built HERE rather than in the client component: the alternative is
 * `trimLeague(..., { seasonTables: true })`, which ships standings, power rankings, every
 * team's schedule AND teamSeasonStats into the page payload for the sake of a dozen
 * numbers. This is those dozen numbers.
 *
 * Returns null when the season tables are missing, so the recap simply omits the section
 * rather than rendering a table of dashes.
 */
function buildTape(
  league: LeagueData,
  youId: number,
  oppId: number
): Tape | null {
  const standings = league.seasonData?.standings ?? [];
  const ranks = league.seasonData?.powerRankings?.teams ?? [];
  const schedules = league.seasonData?.schedules ?? {};
  if (!standings.length) return null;

  const youRow = standings.find((t) => t.teamId === youId);
  const oppRow = standings.find((t) => t.teamId === oppId);
  if (!youRow || !oppRow) return null;

  const side = (s: StandingRow, otherName: string): TapeSide => {
    const teamId = s.teamId;
    const rows = schedules[String(teamId)] ?? [];

    /*
     * Form BEFORE this matchup — which cannot be found by period number. The app calls
     * this period 23; the schedule calls the same playoff round 22 (a round spans two
     * scoring periods — see AGENTS.md). Matching on the period would leave this very
     * matchup sitting in its own run-up. So find the last row against this opponent and
     * take what came before it.
     */
    const norm = otherName.trim().toLowerCase();
    let here = -1;
    rows.forEach((r, i) => {
      if ((r.opponent ?? "").trim().toLowerCase().includes(norm)) here = i;
    });
    const prior = here >= 0 ? rows.slice(0, here) : rows.slice(0, -1);

    return {
      name: s.teamName.trim(),
      record: `${s.wins}-${s.losses}-${s.ties}`,
      winPct: s.winPct,
      allPlayPct: s.allPlayPct,
      luck: s.luck,
      powerRank: ranks.find((t) => t.teamId === teamId)?.rank ?? null,
      finish: s.finalStanding || s.standing,
      form: prior.slice(-5).map((r) => r.result),
    };
  };

  return {
    you: side(youRow, oppRow.teamName),
    opp: side(oppRow, youRow.teamName),
  };
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string; preview?: string }>;
}) {
  const sp = await searchParams;
  const demo = sp.demo === "1";
  const preview = sp.preview === "midweek";
  const league = await loadLeague();
  const me = await myTeam(league);
  const r = resolveMatchup(league, me.id);

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
  return (
    <>
      <h1>Matchup</h1>
      <p className="caption">
        {preview
          ? "Mid-week preview — a simulated in-progress state."
          : league.seasonOver
            ? "Final result — how the matchup finished, category by category."
            : `Projected to the end of period ${league.period}.`}
      </p>
      {preview && (
        <p className="notice">
          <strong>Simulated, not live.</strong> The season is over, so every real matchup
          has zero games left — and with no games left there is no variance. This rebuilds
          an in-progress week from the real rosters and averages ({Math.round(PREVIEW_BANKED * 100)}%
          of the final totals banked, 2–3 games still to play) so the live projection UI has
          something to show. <a href="/matchup">Back to the real result</a>.
        </p>
      )}
      <MatchupView
        live={!demo && !preview}
        simulated={preview}
        league={slim}
        matchup={preview ? midweekMatchup(league, r.matchup) : r.matchup}
        isHome={r.isHome}
        teamId={me.id}
        youName={r.youName}
        oppName={r.oppName}
        tape={buildTape(league, me.id, r.isHome ? r.matchup.awayId : r.matchup.homeId)}
      />
    </>
  );
}
