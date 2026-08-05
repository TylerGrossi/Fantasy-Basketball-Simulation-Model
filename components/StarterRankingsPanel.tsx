"use client";

import { useMemo, useState } from "react";
import type { PoolPlayer } from "@/lib/league";
import { starterRankings } from "@/lib/playerPool";
import StarterRankingsView from "./StarterRankingsView";
import StrengthByPosition from "./StrengthByPosition";

/**
 * Starter Rankings, plus a team picker: a small "Total Value" leaderboard (the sum of
 * each team's ten starters' 9-cat value) sits to the left of the bar chart, and clicking
 * a row swaps whose starters the chart shows. A client component because the click has
 * to repaint the chart without a page navigation — `starterRankings()` is cheap enough
 * (a handful of array sorts over ~300 players) to recompute per click rather than
 * precomputing all ten teams up front.
 */
export default function StarterRankingsPanel({
  pool,
  teamNames,
  defaultTeam,
}: {
  pool: PoolPlayer[];
  teamNames: string[];
  defaultTeam: string;
}) {
  const [selected, setSelected] = useState(defaultTeam);

  /**
   * Whole-roster value, bench included — deliberately the SAME figure the League Rosters
   * page prints per team. It used to sum only the starting ten, which read as a bug: the
   * same team under the same "Total Value" heading came to +38.5 here and +35.9 there
   * (bench players carry negative value, so a starters-only total is the higher number).
   * One statistic, one number, both pages.
   */
  const valueRows = useMemo(() => {
    const totals = new Map<string, number>();
    for (const p of pool) {
      if (!p.owner) continue;
      totals.set(p.owner, (totals.get(p.owner) ?? 0) + (p.value ?? 0));
    }
    return teamNames
      .map((name) => ({ name, total: totals.get(name) ?? 0 }))
      .sort((a, b) => b.total - a.total);
  }, [pool, teamNames]);

  const ranks = useMemo(() => starterRankings(pool, selected), [pool, selected]);

  return (
    <div className="sr-panel">
      <div className="table-scroll sr-value-wrap">
        <table className="sheet sr-value-table">
          <thead>
            <tr>
              <th className="num">Rank</th>
              <th>Team</th>
              <th className="num">Total Value</th>
            </tr>
          </thead>
          <tbody>
            {valueRows.map((r, i) => (
              <tr
                key={r.name}
                className={`row-link${r.name === selected ? " sr-value-active" : ""}`}
                onClick={() => setSelected(r.name)}
              >
                <td className="num">{i + 1}</td>
                <td>
                  <button type="button" className="sr-value-team-btn row-link-a">
                    {r.name}
                  </button>
                </td>
                <td className="num">
                  {r.total >= 0 ? "+" : ""}
                  {r.total.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <StarterRankingsView team={selected} ranks={ranks} />
      <StrengthByPosition ranks={ranks} />
    </div>
  );
}
