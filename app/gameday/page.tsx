import GameDayView from "@/components/GameDayView";
import LiveSeed from "@/components/LiveSeed";
import Scoreboard from "@/components/Scoreboard";
import { liveSeed } from "@/lib/liveMatchup";
import { periodLabel } from "@/lib/league";
import { loadBoxScores, loadLeague, myTeam, resolveMatchup, trimLeague } from "@/lib/loadLeague";

/**
 * Game Day — every NBA game tonight, live, and what it is doing to your matchup. See
 * components/GameDayView.tsx for the design and the two feeds behind it.
 *
 * `?demo=1` freezes the page on the export snapshot and skips both live fetches.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string }>;
}) {
  const sp = await searchParams;
  const demo = sp.demo === "1";
  const league = await loadLeague();
  const me = await myTeam(league);
  const r = resolveMatchup(league, me.id);

  if (league.seasonOver || !r) {
    return (
      <>
        <h1>Game Day</h1>
        <p className="caption">
          {league.seasonOver
            ? "The season is over — Game Day comes back with the first game night of the next one."
            : `No matchup found for ${me.name} in ${periodLabel(league)}.`}
        </p>
      </>
    );
  }

  /*
   * The ESPN athlete ids the page needs, and NOTHING else from the player pool — the pool
   * is the heaviest part of the export and must not cross into the client payload. The
   * matchup rosters carry names only, so ids are looked up by name here.
   */
  const pool = league.seasonData.playerPool ?? [];
  const idByName = new Map(pool.map((p) => [p.name, p.playerId]));
  const ids: Record<string, number> = {};
  for (const p of [...r.matchup.home.players, ...r.matchup.away.players]) {
    const id = idByName.get(p.name);
    if (id != null) ids[p.name] = id;
  }
  // Owner of every rostered player, by team NAME match — never by excluding a free-agent
  // marker (this export writes "FA", the type's comment says "" or "Waivers").
  const teamIdByName = new Map(league.teams.map((t) => [t.name, t.id]));
  const owners: Record<string, number> = {};
  for (const p of pool) {
    const owner = teamIdByName.get(p.owner);
    if (owner != null && p.playerId != null) owners[String(p.playerId)] = owner;
  }

  // The top of the page is Current Matchup's own scoreboard, fed exactly as that page
  // feeds it. It joins the same live poller as the view below, so it costs no extra fetch.
  const slim = trimLeague(league, { matchupTeamId: me.id });
  const byId = new Map(league.teams.map((t) => [t.id, t]));
  const abbrev = (id: number) => byId.get(id)?.abbrev || byId.get(id)?.name.slice(0, 4) || "";
  const box = await loadBoxScores();
  const currentGame = league.periodResults
    ?.find((p) => p.period === league.period)
    ?.games.find((g) => g.homeId === me.id || g.awayId === me.id);
  const lines = (id: number) => box?.periods[String(league.period)]?.[String(id)] ?? [];
  const gp = (id: number) => lines(id).reduce((a, l) => a + (l.gp || 0), 0);

  // First paint already live (LiveSeed) — see app/scoreboard/page.tsx.
  const seed = demo ? null : await liveSeed(league.period, me.id);

  return (
    <LiveSeed period={league.period} teamId={me.id} data={seed}>
      <GameDayView
        league={slim}
        matchup={r.matchup}
        isHome={r.isHome}
        teamId={me.id}
        oppId={r.oppId}
        ids={ids}
        owners={owners}
        teamAbbrevs={Object.fromEntries(league.teams.map((t) => [String(t.id), abbrev(t.id)]))}
        live={!demo}
        subtitle={`${periodLabel(league)} · ${r.youName} vs ${r.oppName}`}
        header={
          <Scoreboard
            key={league.period}
            live={!demo}
            league={slim}
            matchup={r.matchup}
            isHome={r.isHome}
            teamId={me.id}
            youName={r.youName}
            oppName={r.oppName}
            youAcq={currentGame && (r.isHome ? currentGame.homeAcq : currentGame.awayAcq)}
            oppAcq={currentGame && (r.isHome ? currentGame.awayAcq : currentGame.homeAcq)}
            youGp={gp(me.id)}
            oppGp={gp(r.oppId)}
            mineLabel={abbrev(me.id)}
            oppLabel={abbrev(r.oppId)}
          />
        }
      />
    </LiveSeed>
  );
}
