"use client";

import { useEffect, useMemo, useState } from "react";
import type { LeagueData, PlayerRow } from "@/lib/league";
import { playerStatus } from "@/lib/playerPool";
import { dayLabel, dayRange, etDate } from "@/lib/dates";
import { byLineup, type LineupOrder } from "@/lib/lineupOrder";
import PlayerLink from "./PlayerLink";

/**
 * The matchup week as a player x day grid — ESPN's "Schedule" view — with the question
 * ESPN's grid leaves to you answered underneath: on which days do more of your players
 * have games than you have starting spots?
 *
 * Who loses the start on such a day follows the projection's own rule (engine/data.py
 * `_accumulate_counted_games_by_day`): the top N healthy players by 9-cat VALUE play, the
 * rest sit (points per game until 2026-10-21, and still the fallback on an older export). So the greyed cells here are exactly the games the projections already
 * leave out — the "(1)" beside a GL of 3 on the other tables.
 */


export default function WeekSchedule({
  league,
  sides,
}: {
  league: LeagueData;
  /** Your side first; the toggle switches between them. */
  /** `lineup` = today's ESPN lineup (lib/lineupOrder.ts), the rows' display order. */
  sides: Array<{ label: string; players: PlayerRow[]; lineup?: LineupOrder }>;
}) {
  const sched = league.weekSchedule;
  const [which, setWhich] = useState(0);
  // Today in Eastern time, set after mount: the server's clock and the browser's can
  // straddle midnight, and a hydration mismatch over a highlight is not worth it.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(etDate());
  }, []);

  const days = useMemo(() => (sched ? dayRange(sched.start, sched.end) : []), [sched]);
  // Starting spots: every roster slot that is not Bench or IR. 10 in this league.
  const slots =
    (league.rosterSlots ?? []).filter((s) => s !== "Bench" && s !== "IR").length || 10;
  const ptsIdx = league.stats.indexOf("PTS");

  const side = sides[which] ?? sides[0];
  const grid = useMemo(() => {
    if (!sched || !side) return null;
    // By value, best first — the order starts are handed out in on a crowded day.
    const byValue = side.players.every((p) => typeof p.value === "number");
    const rank = (p: PlayerRow) => (byValue ? (p.value ?? 0) : (p.avg[ptsIdx] ?? 0));
    const players = [...side.players].sort((a, b) => rank(b) - rank(a));
    const healthy = (p: PlayerRow) => !p.injured && playerStatus(p.status)[1] !== "out";
    const gameOf = (p: PlayerRow, d: string) => sched.teams[p.nbaTeam]?.[d] ?? null;

    // Per day: who has a game, and of the healthy ones, who would start.
    const perDay = days.map((d) => {
      const playing = players.filter((p) => gameOf(p, d) && healthy(p));
      const starts = new Set(playing.slice(0, slots).map((p) => p.name));
      return { d, count: playing.length, starts };
    });
    // Rows read in today's ESPN lineup order, PG first and IR last; who STARTS on a
    // crowded day is still the value rule above. Without live slots: by value, as before.
    const shown = byLineup(side.players, side.lineup ?? new Map(), (a, b) => rank(b) - rank(a));
    return { players, shown, perDay, gameOf, healthy };
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
  const slotCol = (side?.lineup?.size ?? 0) > 0;

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
            the ones that would sit — the lowest-value players that day.
          </>
        )}
      </p>

      <div className="table-scroll">
        <table className="sheet ws-table ws-compact">
          <thead>
            <tr>
              {slotCol && <th>Slot</th>}
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
            {grid.shown.map((p) => {
              const [code, sev] = playerStatus(p.status);
              const n = days.filter((d) => grid.gameOf(p, d)).length;
              return (
                <tr key={p.name}>
                  {slotCol && <td className="slot-cell">{side.lineup?.get(p.name)?.label ?? ""}</td>}
                  <td className="ws-player">
                    {/* Name and status on one line, no team line (owner, 2026-10-29), so
                        the whole roster fits in one screen. */}
                    <PlayerLink name={p.name} />
                    {code && <span className={`ws-st ${sev}`}> {code}</span>}
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
                            ? `${p.name} has a game but more players than starting spots — the lowest-value players sit`
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
              {slotCol && <td />}
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
