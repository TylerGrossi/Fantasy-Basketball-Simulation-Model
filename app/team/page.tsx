import TeamCardView, { type TeamCardData } from "@/components/TeamCardView";
import { makeValuer, VALUE_INPUTS, type StatLine } from "@/lib/percentiles";
import { allPlayStarted, type LeagueData, type PoolPlayer } from "@/lib/league";
import { bestLineup, STARTER_LAYOUT, thisSeasonOnly } from "@/lib/playerPool";
import { loadLeague, loadWeek0, myTeam } from "@/lib/loadLeague";

/**
 * TEAM CARD (owner, 2026-10-21): the Player Card's layout for a fantasy team. The left
 * rail is who the team is — record, standing, odds, moves — and its lineup by value; the
 * right panel is the 15 categories as bars, ranked against the rest of the league.
 *
 * Everything is computed here and handed down as eight small records, so the league
 * export never crosses to the browser. `?id=` opens a specific team; anything else falls
 * back to your own.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const sp = await searchParams;
  const league = await loadLeague();
  const me = await myTeam(league);
  const week0 = await loadWeek0();
  const teams = buildTeams(league, week0 ?? []);

  const asked = Number(sp.id);
  const initialId = teams.some((t) => t.id === asked) ? asked : me.id;
  // Season totals once week 1 is final (the same gate as the power rankings); before
  // that they are a night or two of games, so the bars open on roster strength.
  const seasonReady = allPlayStarted(league);

  return (
    <>
      <div className="pd-page-head">
        <h1>Team Card</h1>
      </div>
      <TeamCardView
        teams={teams}
        categories={league.categories}
        lowerIsBetter={league.lowerIsBetter}
        meId={me.id}
        initialId={initialId}
        defaultBasis={seasonReady ? "season" : "roster"}
        allPlayReady={seasonReady}
      />
    </>
  );
}

/** The ratio categories and the totals they are taken from. */
const RATIOS: Record<string, [string, string]> = {
  "FG%": ["FGM", "FGA"],
  "FT%": ["FTM", "FTA"],
  "3P%": ["3PM", "3PA"],
};

function buildTeams(
  league: LeagueData,
  week0: Array<{ teamId: number; place: number }>
): TeamCardData[] {
  const sd = league.seasonData;
  const standings = new Map((sd.standings ?? []).map((s) => [s.teamId, s]));
  const odds = new Map((sd.playoffOdds ?? []).map((o) => [o.teamId, o]));
  const power = new Map((sd.powerRankings?.teams ?? []).map((p) => [p.teamId, p]));
  const w0 = new Map(week0.map((w) => [w.teamId, w.place]));
  const pool = sd.playerPool ?? [];
  const valuer = makeValuer(pool);

  return league.teams.map((t) => {
    const st = standings.get(t.id);
    const roster = pool.filter((p) => p.owner === t.name);

    /*
     * ROSTER PER GAME: the current roster's per-game lines added up, IR excluded — what
     * the team produces on a night everyone plays. Ratios are made over attempted across
     * the roster, not an average of percentages.
     *
     * THIS SEASON'S REAL GAMES ONLY (owner, 2026-10-21), like Player Value's default:
     * each player on his actual 2026-27 line (thisSeasonOnly — not the ranking blend with
     * last season), and a player with no 2026-27 game yet left out rather than counted on
     * last season. TW is in that line now, so it is summed like any count.
     */
    const active = roster
      .filter((p) => p.lineupSlot !== "IR")
      .filter((p) => p.statSource === "current" || p.statSource === "blend")
      .map(thisSeasonOnly);
    const sum = (k: string) =>
      active.reduce((a, p) => a + (Number((p as unknown as Record<string, number>)[k]) || 0), 0);
    const rosterLine: Record<string, number | null> = {};
    for (const cat of league.categories) {
      const r = RATIOS[cat];
      if (r) {
        const att = sum(r[1]);
        rosterLine[cat] = att > 0 ? sum(r[0]) / att : null;
      } else {
        rosterLine[cat] = sum(cat);
      }
    }

    /*
     * The four VALUE rows (owner, 2026-10-21): the WHOLE roster's player values summed —
     * bench and IR included, each player's own pool `value` — because a team's Total
     * Value is ONE number site-wide: the Value Power Rankings, League Rosters and Week 0
     * all add up exactly this. (Summing the 2026-27-only lines above instead printed
     * +122.7 beside a Power Rankings +90.1.) Offence and other (DD, TW) come off each
     * line through the same valuer and defence is the remainder, so the three parts add
     * up to the total exactly. One figure for both bases — value is already a per-game
     * rating, there is no season-total version of it.
     */
    const parts = { VALUE: 0, OFF: 0, DEF: 0, OTHER: 0 };
    for (const p of roster) {
      const line: StatLine = {};
      for (const k of VALUE_INPUTS) line[k] = Number((p as unknown as Record<string, number>)[k]) || 0;
      const v = valuer(line);
      parts.VALUE += p.value;
      parts.OFF += v.off;
      parts.OTHER += v.other;
      parts.DEF += p.value - v.off - v.other;
    }
    Object.assign(rosterLine, parts);

    const totals = st?.catTotals ?? {};
    const seasonLine: Record<string, number | null> = {};
    for (const cat of league.categories) {
      const v = totals[cat];
      seasonLine[cat] = typeof v === "number" ? v : null;
    }

    Object.assign(seasonLine, parts);

    const pr = power.get(t.id);
    const o = odds.get(t.id);
    return {
      id: t.id,
      name: t.name,
      abbrev: t.abbrev || t.name.slice(0, 3).toUpperCase(),
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      standing: st?.standing ?? t.standing,
      allPlay: st
        ? { w: st.allPlayWins, l: st.allPlayLosses, t: st.allPlayTies, pct: st.allPlayPct }
        : null,
      powerRank: pr && pr.rank > 0 ? pr.rank : null,
      week0Place: w0.get(t.id) ?? null,
      playoffProb: o?.playoffProb ?? null,
      titleProb: o?.championshipProb ?? null,
      acquisitions: st?.acquisitions ?? null,
      trades: st?.trades ?? null,
      season: seasonLine,
      roster: rosterLine,
      lineup: valueLineup(roster),
    };
  });
}

/**
 * The BEST lineup by value (owner, 2026-10-21), not the slots ESPN has them in: the
 * Lineup page's `bestLineup` — the ten highest-value players who can legally be seated,
 * the best eligible one in each slot in board order, so PG holds your best point guard.
 * Then the bench by value, then IR (not eligible to start).
 */
function valueLineup(roster: PoolPlayer[]): TeamCardData["lineup"] {
  const row = (p: PoolPlayer, slot: string) => ({
    name: p.name,
    nbaTeam: p.nbaTeam,
    slot,
    value: p.value,
    status: p.status,
  });
  const ir = roster.filter((p) => p.lineupSlot === "IR");
  const active = roster.filter((p) => p.lineupSlot !== "IR");
  const starters = bestLineup(active, STARTER_LAYOUT);
  const started = new Set(starters.filter((p): p is PoolPlayer => !!p).map((p) => p.name));
  const byValue = (a: PoolPlayer, b: PoolPlayer) => b.value - a.value;
  return [
    ...starters.flatMap((p, i) => (p ? [row(p, STARTER_LAYOUT[i])] : [])),
    ...active.filter((p) => !started.has(p.name)).sort(byValue).map((p) => row(p, "Bench")),
    ...[...ir].sort(byValue).map((p) => row(p, "IR")),
  ];
}

