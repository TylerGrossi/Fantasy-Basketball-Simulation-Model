import LineupView, { type LineupPlayer } from "@/components/LineupView";
import { loadLeague, myTeam, resolveMatchup } from "@/lib/loadLeague";

/** ESPN starts ten; everyone past that is bench. */
const STARTER_SLOTS = 10;

/**
 * Lineup optimiser — who to start, and what it does to your category totals.
 *
 * The roster's per-game averages come from the matchup export; the POSITION comes from
 * the player pool, which is the only place it exists. They are joined by name here, on
 * the server, so the client component gets one flat list and no lookup table.
 *
 * Slot eligibility is deliberately NOT enforced. ESPN lists players as multi-eligible
 * ("PG, SG") and the export carries a single position, so a slot grid built on it would
 * block moves that are legal in the real league — worse than not having slots. The cap
 * on how many can start is real; which ten is up to you.
 */
export default async function Page() {
  const league = await loadLeague();
  const me = await myTeam(league);
  const r = resolveMatchup(league, me.id);

  if (!r) {
    return (
      <>
        <h1>Lineup</h1>
        <p className="caption">No roster found for {me.name}.</p>
      </>
    );
  }

  const you = r.isHome ? r.matchup.home : r.matchup.away;
  const pool = league.seasonData?.playerPool ?? [];
  const posOf = new Map(pool.map((p) => [p.name, p.position]));
  const valueOf = new Map(pool.map((p) => [p.name, p.value]));

  const players: LineupPlayer[] = you.players.map((p) => ({
    name: p.name,
    nbaTeam: p.nbaTeam,
    position: posOf.get(p.name) ?? "",
    value: valueOf.get(p.name) ?? 0,
    gamesLeft: p.gamesLeft,
    injured: p.injured,
    status: p.status,
    avg: p.avg,
  }));

  return (
    <>
      <h1>Lineup</h1>
      <p className="caption">
        {me.name} &mdash; move players between starters and bench to see what it does to
        your projected category totals.
      </p>
      <LineupView
        players={players}
        stats={league.stats}
        categories={league.categories}
        lowerIsBetter={league.lowerIsBetter}
        slots={STARTER_SLOTS}
      />
    </>
  );
}
