import SeasonStatsView, { type SeasonPlayer } from "@/components/SeasonStatsView";
import { loadLeague, myTeam } from "@/lib/loadLeague";

/** Every stat the table's column groups can draw from. */
const STATS = [
  "PTS", "REB", "AST", "STL", "BLK", "TO",
  "FGM", "FGA", "FTM", "FTA", "3PM", "3PA",
  "DD", "TW",
];

/** Category leaders on your roster, and the unit each is counted in. */
const LEADERS: Array<[string, string, string]> = [
  ["PTS", "Points Leader", "pts"],
  ["FGM", "FGM Leader", "fgm"],
  ["REB", "Rebounds Leader", "reb"],
  ["AST", "Assists Leader", "ast"],
  ["STL", "Steals Leader", "stl"],
  ["BLK", "Blocks Leader", "blk"],
  ["3PM", "3PM Leader", "3pm"],
  ["DD", "DD Leader", "dd"],
];

/**
 * Your roster, player by player: who carried which category, and every line behind it.
 *
 * The TEAM's own season totals are not here — they are a league-comparison number
 * (they only mean anything next to the other nine teams), so they live on /league-stats
 * where that comparison already is.
 */
export default async function Page() {
  const league = await loadLeague();
  const me = await myTeam(league);
  const ts = league.seasonData?.teamSeasonStats?.[String(me.id)];
  const standings = league.seasonData?.standings ?? [];

  if (!ts?.players?.length) {
    return (
      <>
        <h1>Season Stats</h1>
        <p className="caption">No season stats — run the data export.</p>
      </>
    );
  }

  // Two sources, deliberately merged: `ts.totals` carries FTM/FTA/3PA, which are not
  // scored categories and so are absent from `catTotals`; `catTotals` carries DD and TW,
  // which `ts.totals` has no entry for. They agree on every stat they share.
  const mine = standings.find((s) => s.teamId === me.id);
  const teamTotals: Record<string, number> = { ...(mine?.catTotals ?? {}), ...ts.totals };

  const players: SeasonPlayer[] = ts.players.map((p) => {
    const stats: Record<string, number> = {};
    for (const s of STATS) stats[s] = Number(p[s] ?? 0);
    return { name: p.name, gp: p.gp, stats };
  });

  /** Highest total in a category, and what fraction of the team's output that is. */
  const leaderIn = (stat: string) => {
    let best: SeasonPlayer | null = null;
    for (const p of players) {
      if (!best || (p.stats[stat] ?? 0) > (best.stats[stat] ?? 0)) best = p;
    }
    if (!best || !(best.stats[stat] > 0)) return null;
    const total = teamTotals[stat] ?? 0;
    return {
      name: best.name,
      value: best.stats[stat],
      share: total > 0 ? (best.stats[stat] / total) * 100 : null,
    };
  };

  return (
    <>
      <h1>Season Stats</h1>

      <h2>Top contributors</h2>
      <div className="leader-grid">
        {LEADERS.map(([stat, label, unit]) => {
          const l = leaderIn(stat);
          if (!l) return null;
          return (
            <div className="leader" key={stat}>
              <div className="eyebrow">{label}</div>
              <div className="leader-name">{l.name}</div>
              <div className="leader-detail mono">
                {Math.round(l.value).toLocaleString("en-US")} {unit}
                {l.share !== null && ` (${l.share.toFixed(1)}%)`}
              </div>
            </div>
          );
        })}
      </div>

      <h2>Player contributions</h2>
      <SeasonStatsView players={players} teamTotals={teamTotals} />
    </>
  );
}
