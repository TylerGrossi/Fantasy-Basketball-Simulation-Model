"use client";

import { useMemo } from "react";
import type { LeagueData, Matchup } from "@/lib/league";
import { sideMoments } from "@/lib/league";
import { analyzeStreamers } from "@/lib/streamers";
import { useLiveTotals } from "@/lib/useLiveTotals";
import { useSettings } from "@/lib/useSettings";
import LiveBadge from "./LiveBadge";

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
  const you = isHome ? matchup.home : matchup.away;
  const opp = isHome ? matchup.away : matchup.home;

  const live = useLiveTotals(
    league.period,
    teamId,
    you.current,
    opp.current,
    liveEnabled
  );
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

  // Recomputed on every toggle, in milliseconds, with no server round trip. This is the
  // whole point of moving the maths client-side.
  const { baseline, results } = useMemo(
    () =>
      analyzeStreamers(league, you.players, youMoments, oppMoments, {
        hasOpenSpot: openSpot,
        untouchables: untouchable,
      }),
    [league, you.players, youMoments, oppMoments, openSpot, untouchable]
  );

  const anyGamesLeft = league.freeAgents.some((f) => f.gamesLeft > 0);

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
          <div className="controls">
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
          </div>

          <p className="caption">
            {results.length} candidates evaluated against every legal drop. Δ Cats is the
            change in expected categories won versus doing nothing.
          </p>

          <div className="table-scroll">
            <table className="sheet">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Add</th>
                  <th>NBA</th>
                  <th className="num">GL</th>
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
                    <td>{r.add.name}</td>
                    <td>{r.add.nbaTeam}</td>
                    <td className="num">{r.add.gamesLeft}</td>
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
