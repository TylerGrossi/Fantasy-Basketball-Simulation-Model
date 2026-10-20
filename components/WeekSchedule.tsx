"use client";

import { useEffect, useMemo, useState } from "react";
import type { LeagueData, PlayerRow } from "@/lib/league";
import { playerStatus } from "@/lib/playerPool";
import PlayerLink from "./PlayerLink";

/**
 * The matchup week as a player x day grid — ESPN's "Schedule" view — with the question
 * ESPN's grid leaves to you answered underneath: on which days do more of your players
 * have games than you have starting spots?
 *
 * Who loses the start on such a day follows the projection's own rule (engine/data.py
 * `_accumulate_counted_games_by_day`): the top N healthy players by points per game play,
 * the rest sit. So the greyed cells here are exactly the games the projections already
 * leave out — the "(1)" beside a GL of 3 on the other tables.
 */

const ET = "America/New_York";
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function WeekSchedule({
  league,
  sides,
}: {
  league: LeagueData;
  /** Your side first; the toggle switches between them. */
  sides: Array<{ label: string; players: PlayerRow[] }>;
}) {
  const sched = league.weekSchedule;
  const [which, setWhich] = useState(0);
  // Today in Eastern time, set after mount: the server's clock and the browser's can
  // straddle midnight, and a hydration mismatch over a highlight is not worth it.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(new Date().toLocaleDateString("en-CA", { timeZone: ET }));
  }, []);

  const days = useMemo(() => (sched ? dayRange(sched.start, sched.end) : []), [sched]);
  // Starting spots: every roster slot that is not Bench or IR. 10 in this league.
  const slots =
    (league.rosterSlots ?? []).filter((s) => s !== "Bench" && s !== "IR").length || 10;
  const ptsIdx = league.stats.indexOf("PTS");

  const side = sides[which] ?? sides[0];
  const grid = useMemo(() => {
    if (!sched || !side) return null;
    const players = [...side.players].sort(
      (a, b) => (b.avg[ptsIdx] ?? 0) - (a.avg[ptsIdx] ?? 0)
    );
    const healthy = (p: PlayerRow) => !p.injured && playerStatus(p.status)[1] !== "out";
    const gameOf = (p: PlayerRow, d: string) => sched.teams[p.nbaTeam]?.[d] ?? null;

    // Per day: who has a game, and of the healthy ones, who would start.
    const perDay = days.map((d) => {
      const playing = players.filter((p) => gameOf(p, d) && healthy(p));
      const starts = new Set(playing.slice(0, slots).map((p) => p.name));
      return { d, count: playing.length, starts };
    });
    return { players, perDay, gameOf, healthy };
  }, [sched, side, days, slots, ptsIdx]);

  if (!sched || !grid) {
    return (
      <p className="caption">
        No schedule for this week in the export yet — it appears after the next data
        refresh.
      </p>
    );
  }

  const overDays = grid.perDay.filter((x) => x.count > slots);

  return (
    <div className="ws">
      {sides.length > 1 && (
        <div className="ws-toggle" role="tablist">
          {sides.map((s, i) => (
            <button
              key={s.label}
              type="button"
              role="tab"
              aria-selected={i === which}
              className={`chip${i === which ? " chip-on" : ""}`}
              onClick={() => setWhich(i)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      <p className="ws-sum">
        {overDays.length === 0 ? (
          <>Every day fits: no more than {slots} healthy players with games on any day.</>
        ) : (
          <>
            <b>
              {overDays.length} day{overDays.length > 1 ? "s" : ""} over the {slots} starting
              spots
            </b>{" "}
            ({overDays.map((x) => `${dayLabel(x.d)} ${x.count}`).join(", ")}). Greyed games are
            the ones that would sit — the lowest scorers by points per game.
          </>
        )}
      </p>

      <div className="table-scroll">
        <table className="sheet ws-table">
          <thead>
            <tr>
              <th>Player</th>
              {days.map((d) => (
                <th
                  key={d}
                  className={`ws-day${d === today ? " ws-today" : ""}${
                    today && d < today ? " ws-past" : ""
                  }`}
                >
                  {dayLabel(d)}
                </th>
              ))}
              <th className="num">Games</th>
            </tr>
          </thead>
          <tbody>
            {grid.players.map((p) => {
              const [code, sev] = playerStatus(p.status);
              const n = days.filter((d) => grid.gameOf(p, d)).length;
              return (
                <tr key={p.name}>
                  <td className="ws-player">
                    <PlayerLink name={p.name} />
                    <span className="ws-team">
                      {p.nbaTeam}
                      {code && <span className={`ws-st ${sev}`}> {code}</span>}
                    </span>
                  </td>
                  {grid.perDay.map(({ d, starts }) => {
                    const g = grid.gameOf(p, d);
                    const sits = !!g && grid.healthy(p) && !starts.has(p.name);
                    const out = !!g && !grid.healthy(p);
                    return (
                      <td
                        key={d}
                        className={`ws-cell${g ? " ws-game" : ""}${sits ? " ws-sits" : ""}${
                          out ? " ws-out" : ""
                        }${d === today ? " ws-today" : ""}${today && d < today ? " ws-past" : ""}`}
                        title={
                          sits
                            ? `${p.name} has a game but more players than starting spots — the lowest scorers sit`
                            : out
                              ? `${p.name} is ${code || "out"}`
                              : undefined
                        }
                      >
                        {g ?? "—"}
                      </td>
                    );
                  })}
                  <td className="num">{n}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="ws-foot-l">Players with games</td>
              {grid.perDay.map(({ d, count }) => (
                <td
                  key={d}
                  className={`ws-count${count > slots ? " ws-over" : ""}${
                    d === today ? " ws-today" : ""
                  }`}
                >
                  {count}/{slots}
                </td>
              ))}
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** Inclusive list of ISO dates from start to end. */
function dayRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (d <= last && out.length < 21) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** "Tue 10/20". */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${DOW[d.getUTCDay()]} ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
