"use client";

import { useEffect, useMemo, useState } from "react";
import type { LeagueData, PlayerRow } from "@/lib/league";
import { playerStatus } from "@/lib/playerPool";
import { dayLabel, dayRange, etDate } from "@/lib/dates";
import { byLineup, type LineupOrder } from "@/lib/lineupOrder";
import { legalStarters, type CrowdedDay } from "@/lib/crowdedDays";
import { rosterDays } from "@/lib/streamers";
import PlayerLink from "./PlayerLink";

/**
 * The matchup week as a player x day grid — ESPN's "Schedule" view — with the question
 * ESPN's grid leaves to you answered underneath: on which days do more of your players
 * have games than you have starting spots?
 *
 * Who sits on such a day (owner, 2026-11-03) is the Bench section's call: a day is
 * crowded when not everyone with a game fits a LEGAL lineup (positions checked), and on a
 * day still to play the greyed games are the recommended sits - the lineup that wins the
 * most expected categories (lib/crowdedDays.ts). A day already played, which no lineup
 * can change, falls back to the legal by-value lineup.
 */


export default function WeekSchedule({
  league,
  sides,
  layout,
  eligibility,
}: {
  league: LeagueData;
  /** Your side first; the toggle switches between them. */
  /** `lineup` = today's ESPN lineup (lib/lineupOrder.ts), the rows' display order. */
  /** `crowded` = that side's recommendations for the days still to play. */
  sides: Array<{
    label: string;
    players: PlayerRow[];
    lineup?: LineupOrder;
    crowded?: CrowdedDay[] | null;
  }>;
  /** Starting slots in order; absent = the count-only cap. */
  layout?: string[];
  /** Name -> ESPN eligible slots. */
  eligibility?: Record<string, string[]>;
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

    // Who can play each day (owner, 2026-11-03: no out players unless expected back this
    // week). Days still to play use the projection's injury-aware schedule (rosterDays: an
    // out player gets only the games his expected return leaves him, from the END of the
    // week), and a player in an IR slot plays none. Days already played: healthy today.
    const future = days.filter((d) => !today || d >= today);
    const irNames = new Set(
      [...(side.lineup ?? new Map())].filter(([, v]) => v.label === "IR").map(([n]) => n)
    );
    const fit = new Map(
      players.map((p) => [p.name, rosterDays(p, { dates: future, teams: sched.teams })])
    );
    const canPlay = (p: PlayerRow, d: string) =>
      !!gameOf(p, d) &&
      !irNames.has(p.name) &&
      (today && d < today ? healthy(p) : !!fit.get(p.name)?.has(d));

    // Per day, who starts: the Bench recommendation where there is one (its own list of
    // who plays, so the two sections always agree), else the legal by-value lineup.
    const rec = new Map((side.crowded ?? []).map((c) => [c.date, c]));
    const cap = layout?.length ? layout : Array<string>(slots).fill("UTIL");
    const perDay = days.map((d) => {
      const r = rec.get(d);
      const playing = r
        ? new Set(r.players.map((x) => x.name))
        : new Set(players.filter((p) => canPlay(p, d)).map((p) => p.name));
      const starts = r
        ? new Set(r.players.filter((x) => !x.recSit).map((x) => x.name))
        : legalStarters(
            players.filter((p) => playing.has(p.name)).map((p) => ({ name: p.name, value: rank(p) })),
            cap,
            eligibility
          );
      return { d, count: playing.size, playing, starts, crowded: starts.size < playing.size };
    });
    // Rows read in today's ESPN lineup order, PG first and IR last; who STARTS on a
    // crowded day is still the value rule above. Without live slots: by value, as before.
    const shown = byLineup(side.players, side.lineup ?? new Map(), (a, b) => rank(b) - rank(a));
    return { players, shown, perDay, gameOf, healthy };
  }, [sched, side, days, slots, ptsIdx, layout, eligibility, today]);

  if (!sched || !grid) {
    return (
      <p className="caption">
        No schedule for this week in the export yet — it appears after the next data
        refresh.
      </p>
    );
  }

  const overDays = grid.perDay.filter((x) => x.crowded);
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
          <>Every day fits: everyone with a game can start.</>
        ) : (
          <>
            <b>
              {overDays.length} crowded day{overDays.length > 1 ? "s" : ""}
            </b>{" "}
            ({overDays.map((x) => `${dayLabel(x.d)}: ${x.count} playing, ${x.starts.size} start`).join("; ")}).
            Greyed games sit: the Bench section&apos;s pick on days still to play, positions
            checked; by value on days already played.
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
                  {grid.perDay.map(({ d, starts, playing }) => {
                    const g = grid.gameOf(p, d);
                    const sits = !!g && playing.has(p.name) && !starts.has(p.name);
                    const out = !!g && !playing.has(p.name);
                    return (
                      <td
                        key={d}
                        className={`ws-cell${g ? " ws-game" : ""}${sits ? " ws-sits" : ""}${
                          out ? " ws-out" : ""
                        }${d === today ? " ws-today" : ""}${today && d < today ? " ws-past" : ""}`}
                        title={
                          sits
                            ? `${p.name} has a game but sits - see Bench for why`
                            : out
                              ? `${p.name} is ${code || "out"} or in an IR slot that day`
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
              {grid.perDay.map(({ d, count, crowded }) => (
                <td
                  key={d}
                  className={`ws-count${crowded ? " ws-over" : ""}${
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
