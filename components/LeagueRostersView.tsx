"use client";

import { useMemo, useState } from "react";
import type { LeagueData, PoolPlayer, Team } from "@/lib/league";
import {
  headshotUrl,
  playerStatus,
  VALUE_BASES,
  VALUE_COL,
  type ValueBasis,
} from "@/lib/playerPool";
import FilterBar from "./FilterBar";
import PlayerLink from "./PlayerLink";
import StatusBadge from "./StatusBadge";

/**
 * Every team's roster, one card per team, laid out the way ESPN's league-wide roster page
 * is: SLOT / PLAYER / ACQ, one row per roster SPOT — so an unfilled IR shows as "Empty"
 * rather than silently shortening the card. The extra column is VALUE, this app's 9-cat
 * z-score, which ESPN has no equivalent of.
 *
 * Two orderings, and they are deliberately different:
 *  - CARDS are ranked by the roster's total value, best team first (the owner's call —
 *    the page is a value board, not a standings repeat).
 *  - ROWS inside a card follow the SLOT layout, because that is what makes the Slot
 *    column mean anything; ranking rows by value would leave the slot labels in a
 *    scrambled order that reads as a bug.
 *
 * Nothing is greyed out. Injury is carried by the badge next to the name, exactly as ESPN
 * does it — dimming a whole row buries the value figure that the page exists to show.
 */

/** Fallback when the export predates `rosterSlots`. This league's actual shape. */
const DEFAULT_SLOTS = [
  "PG", "SG", "SF", "PF", "C", "G", "F",
  "UTIL", "UTIL", "UTIL",
  "Bench", "Bench", "Bench",
  "IR", "IR", "IR",
];

/** Base positions only, backcourt -> frontcourt — ESPN's "PG, SG" subline. */
const POSITION_ORDER = ["PG", "SG", "SF", "PF", "C"];

function positions(p: PoolPlayer): string {
  const raw = p.eligibleSlots?.length ? p.eligibleSlots : p.position ? [p.position] : [];
  const clean = Array.from(
    new Set(raw.map((s) => s.trim().toUpperCase()).filter((s) => POSITION_ORDER.includes(s)))
  );
  clean.sort((a, b) => POSITION_ORDER.indexOf(a) - POSITION_ORDER.indexOf(b));
  return clean.join(", ");
}

/** The "show everything" option in the team picker. Not a team name, so it cannot collide. */
const ALL_TEAMS = "__all__";

export default function LeagueRostersView({
  league,
  myTeam,
}: {
  league: LeagueData;
  /** Your own team's name — the picker's default, so the page opens on your roster. */
  myTeam?: string;
}) {
  const pool = league.seasonData?.playerPool ?? [];
  const standings = league.seasonData?.standings ?? [];
  const recordByTeam = new Map(standings.map((s) => [s.teamId, s]));
  const layout = league.rosterSlots?.length ? league.rosterSlots : DEFAULT_SLOTS;

  /*
   * ONE TEAM AT A TIME, defaulting to yours — ON A PHONE ONLY.
   *
   * Ten cards of sixteen rows is 160 rows of continuous scroll on a 390px screen, and nine
   * of them are somebody else's roster. The picker makes the page answer "who is on this
   * team" directly; "All teams" restores the full board for anyone using it that way.
   *
   * A laptop has no such problem: `.lr-cols` is a two-column grid there, so the board is
   * five rows of two cards that you SCAN, and scanning ten rosters at once is the entire
   * point of a league-wide roster page. The desktop tree below is that board, unfiltered
   * and on the season value column — see the `.only-app` / `.only-web` block in
   * globals.css. Both filter controls are inside the phone tree, because both exist to
   * cut something down that is only too big there.
   */
  const [team, setTeam] = useState<string>(myTeam || ALL_TEAMS);
  /*
   * WHICH VALUE. The pool carries three — season, last 30 days, last 15 — and a roster
   * board is read differently depending on which: the season column says who drafted well,
   * the 15-day column says who is hot right now. Same control as Player Value uses, so the
   * word "Regular" means the same thing on both pages.
   */
  const [basis, setBasis] = useState<ValueBasis>("Regular");
  const valueCol = VALUE_COL[basis];

  const byOwner = new Map<string, PoolPlayer[]>();
  for (const p of pool) {
    if (!p.owner) continue;
    const list = byOwner.get(p.owner) ?? [];
    list.push(p);
    byOwner.set(p.owner, list);
  }

  /*
   * Ranked over EVERY team, then filtered — so the rank on a card is that team's place in
   * the league, not its place among whatever the picker left showing. Filtering first
   * would make every selected team "1st".
   */
  const rank = (col: "value" | "recent" | "recent15") =>
    league.teams
      .map((t) => {
        const players = byOwner.get(t.name) ?? [];
        return {
          team: t,
          players,
          total: players.reduce((a, p) => a + (p[col] ?? 0), 0),
        };
      })
      .sort((a, b) => b.total - a.total)
      .map((c, i) => ({ ...c, rank: i + 1 }));

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const ranked = useMemo(() => rank(valueCol), [league.teams, pool, valueCol]);
  /* The desktop board is always on the SEASON column — it has no basis control, so there
     is nothing to say which of the three it is showing, and a value board with an unstated
     basis is a board you can misread. When the phone control is on Season (its default)
     this is the same array; `useMemo` on both keeps the extra pass off every re-render. */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rankedSeason = useMemo(() => rank("value"), [league.teams, pool]);

  const shown = team === ALL_TEAMS ? ranked : ranked.filter((c) => c.team.name === team);

  const card = (
    c: { team: Team; players: PoolPlayer[]; total: number },
    col: "value" | "recent" | "recent15"
  ) => (
    <RosterCard
      key={c.team.id}
      team={c.team}
      players={c.players}
      total={c.total}
      valueCol={col}
      layout={layout}
      record={recordByTeam.get(c.team.id)}
    />
  );

  return (
    <>
      {/* PHONE: pick a team, pick a basis, read one card. */}
      <div className="only-app">
        <FilterBar className="controls">
          <div className="ms lr-f-team">
            <div className="ms-label">Team</div>
            <select
              className="field field-select"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              aria-label="Team"
            >
              {/* Ranked order, so the picker reads as the value board it is filtering. */}
              {ranked.map((c) => (
                <option key={c.team.id} value={c.team.name}>
                  {c.rank}. {c.team.name}
                </option>
              ))}
              <option value={ALL_TEAMS}>All teams</option>
            </select>
          </div>
          <div className="ms lr-f-basis">
            <div className="ms-label">Value</div>
            <select
              className="field field-select"
              value={basis}
              onChange={(e) => setBasis(e.target.value as ValueBasis)}
              aria-label="Value basis"
            >
              {VALUE_BASES.map((b) => (
                <option key={b} value={b}>
                  {b === "Regular" ? "Season" : b}
                </option>
              ))}
            </select>
          </div>
        </FilterBar>

        <div className="lr-cols">{shown.map((c) => card(c, valueCol))}</div>
      </div>

      {/* LAPTOP: every roster, best team first, no controls. */}
      <div className="only-web">
        <div className="lr-cols">{rankedSeason.map((c) => card(c, "value"))}</div>
      </div>
    </>
  );
}

/**
 * Fill the slot layout from the roster.
 *
 * Each player goes in the slot ESPN itself reports for them (`lineupSlot`), best-valued
 * first within a label — with three UTIL and three Bench spots, the order inside a label
 * is otherwise arbitrary.
 *
 * A label can OVERFLOW its layout count: two teams in this league carry a fourth bench
 * player. The extra row is emitted alongside the other Bench rows rather than tacked onto
 * the end of the card, so the slot column stays in blocks — a lone "Bench" row printed
 * below the IR rows reads as a rendering bug. Labels the layout doesn't mention at all
 * (older export, unused slot) still go last, because there is nowhere else for them; a
 * board that silently drops a player would be worse than one with a trailing row.
 */
function fillSlots(players: PoolPlayer[], layout: string[]) {
  const pending = new Map<string, PoolPlayer[]>();
  for (const p of [...players].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))) {
    const key = p.lineupSlot || "";
    const list = pending.get(key) ?? [];
    list.push(p);
    pending.set(key, list);
  }

  const counts = new Map<string, number>();
  for (const slot of layout) counts.set(slot, (counts.get(slot) ?? 0) + 1);

  const rows: Array<{ slot: string; player?: PoolPlayer }> = [];
  const seen = new Set<string>();
  for (const slot of layout) {
    if (seen.has(slot)) continue;
    seen.add(slot);
    const held = pending.get(slot) ?? [];
    // Every spot the layout defines, plus any extra the roster actually holds.
    const n = Math.max(counts.get(slot) ?? 0, held.length);
    for (let i = 0; i < n; i++) rows.push({ slot, player: held[i] });
    pending.delete(slot);
  }

  const leftover: Array<{ slot: string; player: PoolPlayer }> = [];
  for (const [slot, list] of pending) {
    for (const player of list) leftover.push({ slot: slot || "—", player });
  }
  leftover.sort((a, b) => (b.player.value ?? 0) - (a.player.value ?? 0));

  return [...rows, ...leftover];
}

function RosterCard({
  team,
  players,
  total,
  valueCol,
  layout,
  record,
}: {
  team: Team;
  players: PoolPlayer[];
  total: number;
  /** Which of the pool's three value columns the picker selected. */
  valueCol: "value" | "recent" | "recent15";
  layout: string[];
  record?: { wins: number; losses: number; ties: number };
}) {
  const wins = record?.wins ?? team.wins;
  const losses = record?.losses ?? team.losses;
  const ties = record?.ties ?? team.ties;
  const rows = fillSlots(players, layout);

  return (
    <section className="lr-card">
      {/* No rank here: the team picker already reads "2. VJ Maxx", so the card would be
          repeating the one thing you just selected it by. Back to the original row. */}
      <header className="lr-card-h">
        <h2 className="lr-team">{team.name}</h2>
        <span className="lr-record mono">
          ({wins}-{losses}
          {ties ? `-${ties}` : ""})
        </span>
        <span className="lr-total mono">
          {total >= 0 ? "+" : ""}
          {total.toFixed(1)}
        </span>
      </header>
      <div className="table-scroll">
        <table className="sheet lr-table">
          <thead>
            <tr>
              <th className="lr-slot-h">Slot</th>
              <th>Player</th>
              <th className="lr-acq-h">Acq</th>
              <th className="num">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ slot, player }, i) => (
              <tr key={player ? player.name : `${slot}-${i}`}>
                <td className="lr-slot-tag">{slot}</td>
                <td>
                  {player ? (
                    <span className="lr-player">
                      <Shot id={player.playerId} />
                      <span className="lr-player-t">
                        <span className="lr-player-n">
                          <PlayerLink name={player.name} className="lr-link" />
                          <StatusBadge status={player.status} />
                        </span>
                        <span className="lr-player-sub">
                          {player.nbaTeam}
                          {positions(player) && ` ${positions(player)}`}
                        </span>
                      </span>
                    </span>
                  ) : (
                    <span className="lr-player">
                      <span className="lr-shot lr-shot-blank" />
                      <span className="lr-empty">Empty</span>
                    </span>
                  )}
                </td>
                <td className="lr-acq">{player?.acquisitionType || ""}</td>
                <td className="num">
                  {player
                    ? `${(player[valueCol] ?? 0) >= 0 ? "+" : ""}${(player[valueCol] ?? 0).toFixed(1)}`
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Shot({ id }: { id: number | null }) {
  const url = headshotUrl(id);
  return url ? (
    <span className="lr-shot" style={{ backgroundImage: `url('${url}')` }} />
  ) : (
    <span className="lr-shot lr-shot-blank" />
  );
}

/** ESPN's small red mark next to an unavailable player. Never dims the row. */
