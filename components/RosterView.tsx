import { scheduledGames, type LeagueData, type PlayerRow, type TeamSide } from "@/lib/league";
import { byLineup, type LineupOrder } from "@/lib/lineupOrder";
import GamesLeftCell from "./GamesLeftCell";
import PlayerLink from "./PlayerLink";

/**
 * Both rosters, with per-game averages and games left. Rendered through LiveRosterView,
 * which hands it today's ESPN rosters (pickups and drops) on top of the export.
 */

const SHOWN = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "TO", "FGM", "FGA"];

export default function RosterView({
  league,
  you,
  opp,
  youName,
  oppName,
  youLineup,
  oppLineup,
}: {
  league: LeagueData;
  you: TeamSide;
  opp: TeamSide;
  youName: string;
  oppName: string;
  /** Today's ESPN lineup per side (lib/lineupOrder.ts); empty = no live slots yet. */
  youLineup?: LineupOrder;
  oppLineup?: LineupOrder;
}) {
  const injured = [
    ...you.players.filter((p) => p.injured).map((p) => ({ p, team: youName })),
    ...opp.players.filter((p) => p.injured).map((p) => ({ p, team: oppName })),
  ];

  return (
    <>
      <h2>{youName}</h2>
      <RosterTable league={league} players={you.players} lineup={youLineup} />
      <h2>{oppName}</h2>
      <RosterTable league={league} players={opp.players} lineup={oppLineup} />

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
                  <td>{statusText(p.status || "OUT")}</td>
                  <GamesLeftCell player={p} />
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
  lineup = new Map(),
}: {
  league: LeagueData;
  players: PlayerRow[];
  lineup?: LineupOrder;
}) {
  const cols = SHOWN.filter((s) => league.stats.includes(s));
  // Today's ESPN lineup, PG first and IR last; before live slots arrive (or for anyone
  // ESPN has not slotted), most games left then points per game, as before.
  const sorted = byLineup(players, lineup, (a, b) => {
    const gl = scheduledGames(b) - scheduledGames(a);
    if (gl !== 0) return gl;
    return b.avg[league.stats.indexOf("PTS")] - a.avg[league.stats.indexOf("PTS")];
  });
  const slots = lineup.size > 0;

  return (
    <div className="table-scroll">
      <table className="sheet">
        <thead>
          <tr>
            {slots && <th>Slot</th>}
            <th>Player</th>
            <th>NBA</th>
            <th className="num">GL</th>
            {/* 9-cat value (the same number that decides who sits on a crowded day). */}
            <th className="num" title="9-cat value: standard deviations above a replacement-level player">
              Value
            </th>
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
              {slots && <td className="slot-cell">{lineup.get(p.name)?.label ?? ""}</td>}
              <td><PlayerLink name={p.name} /></td>
              <td>{p.nbaTeam}</td>
              <GamesLeftCell player={p} />
              <td
                className="num"
                style={{
                  color: (p.value ?? 0) > 0 ? "var(--good)" : (p.value ?? 0) < 0 ? "var(--bad)" : undefined,
                }}
              >
                {typeof p.value === "number" ? `${p.value > 0 ? "+" : ""}${p.value.toFixed(1)}` : "—"}
              </td>
              {cols.map((c) => (
                <td key={c} className="num">
                  {p.avg[league.stats.indexOf(c)].toFixed(1)}
                </td>
              ))}
              <td>{statusText(p.status)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * ESPN's status as words: "DAY_TO_DAY" -> "Day to Day". ACTIVE stays as ESPN writes it
 * (owner's call) — only the underscored enums read as raw data.
 */
function statusText(raw: string): string {
  if (!raw || raw === "ACTIVE") return raw;
  return raw
    .toLowerCase()
    .split("_")
    .map((w, i) => (i > 0 && w === "to" ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
