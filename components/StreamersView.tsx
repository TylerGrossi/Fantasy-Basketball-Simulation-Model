"use client";

import { useEffect, useMemo, useState } from "react";
import type { LeagueData, Matchup } from "@/lib/league";
import { sideMoments } from "@/lib/league";
import { analyzeStreamers } from "@/lib/streamers";
import { dayLabel, etDate } from "@/lib/dates";
import { useLiveSides } from "@/lib/useLiveSides";
import { useSettings } from "@/lib/useSettings";
import LiveBadge from "./LiveBadge";
import PlayerLink from "./PlayerLink";
import FilterBar from "./FilterBar";

interface Props {
  league: LeagueData;
  matchup: Matchup;
  isHome: boolean;
  teamId: number;
  /** false = freeze on the snapshot, never fetch (?demo=1). */
  live?: boolean;
}

const SHOWN = ["PTS", "REB", "AST", "3PM", "STL", "BLK"];

export default function StreamersView({
  league,
  matchup,
  isHome,
  teamId,
  live: liveEnabled = true,
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
   * The games a pickup made NOW could still play (2026-10-20): later days, plus today's
   * only if it has not tipped off yet (live NBA scoreboard; unknown counts as not
   * started). A game that is over or under way can no longer be added — the export's
   * count, made that morning, still included them.
   */
  const gameDates = (nbaTeam: string): string[] =>
    Object.keys(league.weekSchedule?.teams[nbaTeam] ?? {})
      .filter(
        (d) =>
          !today || d > today || (d === today && (live.gameLeft?.[nbaTeam] ?? 1) >= 1)
      )
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
  }, [league, today, live.gameLeft]);

  // Recomputed on every toggle, in milliseconds, with no server round trip. This is the
  // whole point of moving the maths client-side.
  const { baseline, results } = useMemo(
    () =>
      analyzeStreamers(pickupLeague, you.players, youMoments, oppMoments, {
        hasOpenSpot: openSpot,
        untouchables: untouchable,
      }),
    [pickupLeague, you.players, youMoments, oppMoments, openSpot, untouchable]
  );

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
          </FilterBar>

          {/* About ten rows tall, scrolling inside itself (owner, 2026-10-20): the full
              candidate list made this section the longest on the one-page matchup. The
              header row stays pinned while the rows scroll under it. */}
          <div className="table-scroll st-scroll">
            <table className="sheet">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Add</th>
                  <th>NBA</th>
                  <th className="num">GL</th>
                  <th>Games</th>
                  <th className="num">Δ Cats</th>
                  <th className="num">Δ Win %</th>
                  <th>Drop</th>
                  {SHOWN.map((s) => (
                    <th key={s} className="num">
                      {s}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={r.add.name}>
                    <td className="num">{i + 1}</td>
                    <td><PlayerLink name={r.add.name} /></td>
                    <td>{r.add.nbaTeam}</td>
                    <td className="num">{r.add.gamesLeft}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {gameDates(r.add.nbaTeam).map(dayLabel).join(" · ") || "-"}
                    </td>
                    <td
                      className="num"
                      style={{
                        color: r.deltaCats > 0 ? "var(--good)" : "var(--ink-3)",
                        fontWeight: r.deltaCats > 0 ? 700 : 400,
                      }}
                    >
                      {r.deltaCats >= 0 ? "+" : ""}
                      {r.deltaCats.toFixed(2)}
                    </td>
                    <td
                      className="num"
                      style={{ color: r.deltaWinPct > 0 ? "var(--good)" : "var(--ink-3)" }}
                    >
                      {r.deltaWinPct >= 0 ? "+" : ""}
                      {r.deltaWinPct.toFixed(1)}
                    </td>
                    <td>{r.drop ? r.drop.name : <em>open spot</em>}</td>
                    {SHOWN.map((s) => (
                      <td key={s} className="num">
                        {r.add.avg[league.stats.indexOf(s)].toFixed(1)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

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
