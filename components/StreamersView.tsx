"use client";

import { useEffect, useMemo, useState } from "react";
import type { AcquisitionSummary, LeagueData, Matchup } from "@/lib/league";
import { sideMoments } from "@/lib/league";
import { analyzeStreamers } from "@/lib/streamers";
import { dayLabel, etDate } from "@/lib/dates";
import { useLiveSides } from "@/lib/useLiveSides";
import { useSettings } from "@/lib/useSettings";
import LiveBadge from "./LiveBadge";
import PlayerLink from "./PlayerLink";
import FilterBar from "./FilterBar";
import SortableTable, { type SortCol, type SortRow } from "./SortableTable";

interface Props {
  league: LeagueData;
  matchup: Matchup;
  isHome: boolean;
  teamId: number;
  /** false = freeze on the snapshot, never fetch (?demo=1). */
  live?: boolean;
  /**
   * This matchup's acquisitions, used of allowed — ESPN's "Matchup Acquisition Limit",
   * one per day of the matchup (6 in a six-day week, 7 in a normal one). Absent when the
   * export could not work it out.
   */
  acq?: AcquisitionSummary;
}

const SHOWN = ["PTS", "REB", "AST", "3PM", "STL", "BLK"];

const STREAMER_COLS: SortCol[] = [
  { key: "rank", label: "#", num: true },
  { key: "add", label: "Add" },
  { key: "nba", label: "NBA" },
  { key: "gl", label: "GL", num: true },
  { key: "netGames", label: "Δ Games", num: true },
  { key: "games", label: "Games" },
  { key: "deltaCats", label: "Δ Cats", num: true },
  { key: "deltaWin", label: "Δ Win %", num: true },
  { key: "drop", label: "Drop" },
  ...SHOWN.map((s) => ({ key: s, label: s, num: true })),
];

export default function StreamersView({
  league,
  matchup,
  isHome,
  teamId,
  live: liveEnabled = true,
  acq,
}: Props) {
  // Live totals + each side's projection minus the games those totals already count.
  const { live, you, opp } = useLiveSides(league, matchup, isHome, teamId, liveEnabled);
  // Persisted in localStorage so protected players and the open-spot flag survive a
  // reload — in the Streamlit version these lived in server session state and were lost
  // whenever the host spun down.
  const [settings, updateSettings] = useSettings();
  const openSpot = settings.hasOpenSpot;
  const untouchable = useMemo(
    () => new Set(settings.untouchables),
    [settings.untouchables]
  );

  const youMoments = useMemo(() => sideMoments(you, live.you), [you, live.you]);
  const oppMoments = useMemo(() => sideMoments(opp, live.opp), [opp, live.opp]);

  // Today in Eastern time, set after mount (same reason as WeekSchedule: the server's
  // clock and the browser's can straddle midnight). Until then every date in the week
  // shows; after, only the ones a pickup could still play — the dates GL is counting.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => {
    setToday(etDate());
  }, []);
  /*
   * ESPN'S ROSTER LOCK (owner, 2026-10-21). This league's rosterLocktimeType is
   * FIRSTGAME_SCORINGPERIOD: once the first NBA game of the day tips off, adds and drops
   * made that day take effect the NEXT day, whoever's game it is. (Lineup moves lock per
   * game — that is a different setting, and not what an add is subject to.)
   *
   * So the day is locked as soon as any game today has started (live NBA scoreboard:
   * `gameLeft` below 1 for some team). Unknown — no live data yet — counts as unlocked.
   */
  const rosterLocked =
    !!today && !!live.gameLeft && Object.values(live.gameLeft).some((left) => left < 1);
  /*
   * The games a pickup made NOW could still play: later days, plus today's only while
   * the day is unlocked. Before the first tip-off no game today has started, so every
   * game today is still addable.
   */
  const gameDates = (nbaTeam: string): string[] =>
    Object.keys(league.weekSchedule?.teams[nbaTeam] ?? {})
      .filter((d) => !today || d > today || (d === today && !rosterLocked))
      .sort();
  const pickupLeague = useMemo(() => {
    if (!today || !league.weekSchedule) return league;
    return {
      ...league,
      freeAgents: league.freeAgents.map((fa) =>
        league.weekSchedule!.teams[fa.nbaTeam]
          ? { ...fa, gamesLeft: Math.min(fa.gamesLeft, gameDates(fa.nbaTeam).length) }
          : fa
      ),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [league, today, rosterLocked]);
  /*
   * The days a move made now affects, for the day-by-day lineup (lib/streamers.ts
   * DailyLineup): the rest of the week, starting today while the roster is unlocked and
   * tomorrow once it is. The lock holds the DROP too — dropped after tip-off, he is still
   * yours for today — which falls out of leaving today off the list.
   */
  const daily = useMemo(() => {
    const sched = league.weekSchedule;
    if (!sched) return undefined;
    const dates = new Set<string>();
    for (const team of Object.values(sched.teams)) for (const d of Object.keys(team)) dates.add(d);
    const affected = [...dates]
      .filter((d) => !today || d > today || (d === today && !rosterLocked))
      .sort();
    const slots =
      (league.rosterSlots ?? []).filter((s) => s !== "Bench" && s !== "IR").length || 10;
    return { dates: affected, teams: sched.teams, slots };
  }, [league.weekSchedule, league.rosterSlots, today, rosterLocked]);

  // Recomputed on every toggle, in milliseconds, with no server round trip. This is the
  // whole point of moving the maths client-side.
  const { baseline, results } = useMemo(
    () =>
      analyzeStreamers(pickupLeague, you.players, youMoments, oppMoments, {
        hasOpenSpot: openSpot,
        untouchables: untouchable,
        daily,
      }),
    [pickupLeague, you.players, youMoments, oppMoments, openSpot, untouchable, daily]
  );
  const addsLeft = acq ? Math.max(0, acq.max - acq.used) : null;

  const anyGamesLeft = pickupLeague.freeAgents.some((f) => f.gamesLeft > 0);

  function toggleUntouchable(name: string) {
    const next = new Set(settings.untouchables);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    updateSettings({ untouchables: [...next] });
  }

  return (
    <>
      <LiveBadge {...live} generatedAt={league.generatedAt} />

      {!anyGamesLeft ? (
        <p className="caption">
          No free agent has games remaining in this matchup window, so there is nothing to
          stream. {league.seasonOver ? "The season is over." : ""}
        </p>
      ) : (
        <>
          <FilterBar className="controls">
            <label className="check">
              <input
                type="checkbox"
                checked={openSpot}
                onChange={(e) => updateSettings({ hasOpenSpot: e.target.checked })}
              />
              I have an open roster spot
            </label>
            <span className="caption" style={{ margin: 0 }}>
              Baseline: {baseline.expectedCats.toFixed(1)} expected cats ·{" "}
              {(baseline.win * 100).toFixed(0)}% win
            </span>
            {acq && (
              <span
                className="caption"
                style={{ margin: 0, color: addsLeft === 0 ? "var(--bad)" : undefined }}
              >
                Adds: {acq.used} of {acq.max} used this week
                {addsLeft === 0 ? " — none left" : ""}
              </span>
            )}
            {rosterLocked && (
              <span className="caption" style={{ margin: 0 }}>
                Today&rsquo;s games have started, so a move made now counts from tomorrow.
              </span>
            )}
          </FilterBar>

          {/* About ten rows tall, scrolling inside itself (owner, 2026-10-20): the full
              candidate list made this section the longest on the one-page matchup. The
              header row stays pinned while the rows scroll under it. Sortable on every
              column; opens on Δ Cats, the order analyzeStreamers ranks by, and # keeps
              that rank whatever the current sort. */}
          <SortableTable
            scrollClassName="st-scroll"
            defaultKey="deltaCats"
            cols={STREAMER_COLS}
            rows={results.map((r, i): SortRow => {
              // Net games your lineup gains — the count the Δ Cats maths used: the
              // pickup's started games, less the drop's and any starter he benches.
              const netGames = r.netGames;
              const signed = (v: number, dp: number) => `${v >= 0 ? "+" : ""}${v.toFixed(dp)}`;
              const iso = gameDates(r.add.nbaTeam);
              const dates = iso.map(dayLabel).join(" · ") || "-";
              return {
                id: r.add.name,
                cells: {
                  rank: { sort: i + 1, text: String(i + 1) },
                  add: { sort: r.add.name, text: r.add.name, node: <PlayerLink name={r.add.name} /> },
                  nba: { sort: r.add.nbaTeam, text: r.add.nbaTeam },
                  gl: { sort: r.add.gamesLeft, text: String(r.add.gamesLeft) },
                  netGames: {
                    sort: netGames,
                    // Whole games with the day-by-day lineup; one decimal only on the
                    // fallback (no week schedule), where a drop's games can be fractional.
                    text: `${netGames > 0 ? "+" : ""}${
                      Number.isInteger(netGames) ? netGames : netGames.toFixed(1)
                    }`,
                    color: netGames > 0 ? "var(--good)" : netGames < 0 ? "var(--bad)" : "var(--ink-3)",
                  },
                  games: {
                    // By the dates themselves (earliest schedule first), not the
                    // "Wed 10/21" labels, which would sort by weekday name.
                    sort: iso.join(" ") || "~",
                    text: dates,
                    node: <span style={{ whiteSpace: "nowrap" }}>{dates}</span>,
                  },
                  deltaCats: {
                    sort: r.deltaCats,
                    text: signed(r.deltaCats, 2),
                    color: r.deltaCats > 0 ? "var(--good)" : "var(--ink-3)",
                    node: r.deltaCats > 0 ? <strong>{signed(r.deltaCats, 2)}</strong> : undefined,
                  },
                  deltaWin: {
                    sort: r.deltaWinPct,
                    text: signed(r.deltaWinPct, 1),
                    color: r.deltaWinPct > 0 ? "var(--good)" : "var(--ink-3)",
                  },
                  drop: {
                    sort: r.drop?.name ?? "",
                    text: r.drop?.name ?? "open spot",
                    node: r.drop ? undefined : <em>open spot</em>,
                  },
                  ...Object.fromEntries(
                    SHOWN.map((s) => {
                      const v = r.add.avg[league.stats.indexOf(s)];
                      return [s, { sort: v, text: v.toFixed(1) }];
                    })
                  ),
                },
              };
            })}
          />

          <h2>Protect from dropping</h2>
          <p className="caption">
            Click a player to exclude them from drop suggestions. Recalculates instantly.
          </p>
          <div className="chips">
            {you.players.map((p) => (
              <button
                key={p.name}
                type="button"
                className={`chip ${untouchable.has(p.name) ? "chip-on" : ""}`}
                onClick={() => toggleUntouchable(p.name)}
                aria-pressed={untouchable.has(p.name)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}
