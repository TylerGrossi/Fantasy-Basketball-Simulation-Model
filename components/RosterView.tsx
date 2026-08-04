import type { LeagueData, PlayerRow, TeamSide } from "@/lib/league";
import PlayerLink from "./PlayerLink";

/**
 * Both rosters, with per-game averages and games left. Server-rendered — nothing here
 * changes during a matchup except games left, which comes from the scheduled rebuild.
 */

const SHOWN = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "TO", "FGM", "FGA"];

export default function RosterView({
  league,
  you,
  opp,
  youName,
  oppName,
}: {
  league: LeagueData;
  you: TeamSide;
  opp: TeamSide;
  youName: string;
  oppName: string;
}) {
  const injured = [
    ...you.players.filter((p) => p.injured).map((p) => ({ p, team: youName })),
    ...opp.players.filter((p) => p.injured).map((p) => ({ p, team: oppName })),
  ];

  return (
    <>
      <h2>{youName}</h2>
      <RosterTable league={league} players={you.players} />
      <h2>{oppName}</h2>
      <RosterTable league={league} players={opp.players} />

      <h2>Injuries</h2>
      {injured.length === 0 ? (
        <p className="caption">No injured players in this matchup.</p>
      ) : (
        <div className="table-scroll">
          <table className="sheet">
            <thead>
              <tr>
                <th>Player</th>
                <th>Team</th>
                <th>Status</th>
                <th className="num">Games left</th>
              </tr>
            </thead>
            <tbody>
              {injured.map(({ p, team }) => (
                <tr key={`${team}-${p.name}`}>
                  <td><PlayerLink name={p.name} /></td>
                  <td>{team}</td>
                  <td>{p.status || "OUT"}</td>
                  <td className="num">{p.gamesLeft}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function RosterTable({
  league,
  players,
}: {
  league: LeagueData;
  players: PlayerRow[];
}) {
  const cols = SHOWN.filter((s) => league.stats.includes(s));
  const sorted = [...players].sort((a, b) => {
    if (b.gamesLeft !== a.gamesLeft) return b.gamesLeft - a.gamesLeft;
    return b.avg[league.stats.indexOf("PTS")] - a.avg[league.stats.indexOf("PTS")];
  });

  return (
    <div className="table-scroll">
      <table className="sheet">
        <thead>
          <tr>
            <th>Player</th>
            <th>NBA</th>
            <th className="num">GL</th>
            {cols.map((c) => (
              <th key={c} className="num">
                {c}
              </th>
            ))}
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.name} className={p.injured ? "row-muted" : undefined}>
              <td><PlayerLink name={p.name} /></td>
              <td>{p.nbaTeam}</td>
              <td className="num">{p.gamesLeft}</td>
              {cols.map((c) => (
                <td key={c} className="num">
                  {p.avg[league.stats.indexOf(c)].toFixed(1)}
                </td>
              ))}
              <td>{p.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
