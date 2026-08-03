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
 * Named position SLOTS (PG/SG/SF/PF/C/G/F/UTIL) ARE enforced by the board, using
 * `eligibleSlots` — every position ESPN lists a player at, not the single default
 * `position`. That distinction is what makes enforcement safe rather than obstructive: a
 * "PG/SG" player is legal in PG, SG, G and UTIL, so the board allows every move the real
 * league would, and refuses only the ones ESPN would refuse too.
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
  // The same 9-cat score over the last 30 / 15 days, so the board can be ranked by form
  // rather than by the season. Both fall back to the season value when absent, matching
  // what the exporter does for a player with too few recent games.
  const recentOf = new Map(pool.map((p) => [p.name, p.recent]));
  const recent15Of = new Map(pool.map((p) => [p.name, p.recent15]));
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
    recent: recentOf.get(p.name) ?? valueOf.get(p.name) ?? 0,
    recent15: recent15Of.get(p.name) ?? valueOf.get(p.name) ?? 0,
    gamesLeft: p.gamesLeft,
    injured: p.injured,
    status: p.status,
    avg: p.avg,
  }));

  return (
    <>
      <h1>Lineup</h1>
      <p className="caption">
        {me.name} &mdash; drag a player into a slot (or tap a player, then a slot) to see
        what it does to your projected category totals.
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
