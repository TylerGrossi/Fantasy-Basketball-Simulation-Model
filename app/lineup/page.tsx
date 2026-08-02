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
 * Named position SLOTS (PG/SG/SF/PF/C/UTIL) are still deliberately not enforced — ESPN
 * players are multi-eligible and a grid that picked one slot per player would block
 * moves that are legal in the real league. What the board DOES show, via
 * `eligibleSlots`, is every position a player is eligible for ("PG/SG"), which is real
 * information without pretending there is one right slot for them. The cap on how many
 * can start is real; which ten is up to you.
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
  const eligOf = new Map(pool.map((p) => [p.name, p.eligibleSlots]));
  const valueOf = new Map(pool.map((p) => [p.name, p.value]));
  const pidOf = new Map(pool.map((p) => [p.name, p.playerId]));

  const players: LineupPlayer[] = you.players.map((p) => ({
    name: p.name,
    nbaTeam: p.nbaTeam,
    playerId: pidOf.get(p.name) ?? null,
    position: posOf.get(p.name) ?? "",
    // Falls back to the single position when the export predates eligibleSlots, or
    // when a player (e.g. a recent add) isn't in the pool export at all.
    eligibleSlots: eligOf.get(p.name)?.length
      ? eligOf.get(p.name)!
      : posOf.get(p.name)
        ? [posOf.get(p.name)!]
        : [],
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
        {me.name} &mdash; drag a player onto the other board (or click Start / Bench) to
        see what it does to your projected category totals.
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
