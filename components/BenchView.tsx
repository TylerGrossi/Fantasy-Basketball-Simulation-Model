"use client";

import { useMemo } from "react";
import type { LeagueData, Matchup } from "@/lib/league";
import { sideMoments } from "@/lib/league";
import { analyzeBench } from "@/lib/bench";
import { useLiveSides } from "@/lib/useLiveSides";
import LiveBadge from "./LiveBadge";

interface Props {
  league: LeagueData;
  matchup: Matchup;
  isHome: boolean;
  teamId: number;
  /** false = freeze on the snapshot, never fetch (?demo=1). */
  live?: boolean;
}

export default function BenchView({
  league,
  matchup,
  isHome,
  teamId,
  live: liveEnabled = true,
}: Props) {
  // Live totals + each side's projection minus the games those totals already count.
  const { live, you, opp } = useLiveSides(league, matchup, isHome, teamId, liveEnabled);

  const youMoments = useMemo(() => sideMoments(you, live.you), [you, live.you]);
  const oppMoments = useMemo(() => sideMoments(opp, live.opp), [opp, live.opp]);

  const analysis = useMemo(
    () => analyzeBench(league, you.players, youMoments, oppMoments, live.you),
    [league, you.players, youMoments, oppMoments, live.you]
  );

  const hasGamesLeft = you.players.some((p) => p.gamesLeft > 0);

  if (!hasGamesLeft) {
    return (
      <>
        <LiveBadge {...live} generatedAt={league.generatedAt} />
        <p className="caption">
          No games remain for your roster in this matchup window, so there is nothing to
          start or sit. {league.seasonOver ? "The season is over." : ""}
        </p>
      </>
    );
  }

  const { playAll, benchAll, benchAllBetter } = analysis;
  const catsDiff = playAll.expectedCats - benchAll.expectedCats;
  const winDiff = (playAll.win - benchAll.win) * 100;

  /*
   * THE OLD (Streamlit) LAYOUT, by request (owner, 2026-10-20): one decision — play the
   * rest of the week, or sit everyone and bank what you have — then the two scenarios
   * side by side, which categories each one helps, and the per-category comparison. Same
   * numbers as before (lib/bench.ts). The folded-away "sit one player" table was removed
   * (owner, 2026-10-21).
   */
  const rows = league.categories.map((cat, i) => {
    const play = (playAll.categoryProbs[i] ?? 0) * 100;
    const bench = (benchAll.categoryProbs[i] ?? 0) * 100;
    return { cat, play, bench, diff: bench - play };
  });
  // The old thresholds: a choice "helps" a category when it moves it by over 5 points.
  const playHelps = rows.filter((r) => r.diff < -5).sort((a, b) => a.diff - b.diff);
  const benchHelps = rows.filter((r) => r.diff > 5).sort((a, b) => b.diff - a.diff);

  return (
    <>
      <LiveBadge {...live} generatedAt={league.generatedAt} />

      <div className={`bn-rec ${benchAllBetter ? "bench" : "play"}`}>
        <div className="bn-rec-h">Recommendation: {benchAllBetter ? "BENCH" : "PLAY"}</div>
        <div className="bn-rec-sub">
          Expected cats difference{" "}
          <b className="mono">
            {catsDiff >= 0 ? "+" : ""}
            {catsDiff.toFixed(2)}
          </b>
          <span className="bn-sep">|</span>
          Win % difference{" "}
          <b className="mono">
            {winDiff >= 0 ? "+" : ""}
            {winDiff.toFixed(1)}%
          </b>
          <span className="bn-note"> (play minus bench)</span>
        </div>
      </div>

      <div className="bn-scen">
        <Scenario
          kind="play"
          title="Play scenario"
          note="Everyone plays their remaining games."
          win={playAll.win}
          cats={playAll.expectedCats}
          helpsLabel="Playing helps"
          helps={playHelps.map((r) => [r.cat, -r.diff])}
        />
        <Scenario
          kind="bench"
          title="Bench scenario"
          note="Everyone sits; only what is already banked counts."
          win={benchAll.win}
          cats={benchAll.expectedCats}
          helpsLabel="Benching helps"
          helps={benchHelps.map((r) => [r.cat, r.diff])}
        />
      </div>

      <h3 className="bn-h">Category comparison (play vs bench)</h3>
      <div className="table-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th>Category</th>
              <th className="num">Play win %</th>
              <th className="num">Bench win %</th>
              <th className="num">Difference</th>
              <th>Better</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cat}>
                <td>{r.cat}</td>
                <td className="num">{r.play.toFixed(1)}%</td>
                <td className="num">{r.bench.toFixed(1)}%</td>
                <td className="num">
                  {r.diff >= 0 ? "+" : ""}
                  {r.diff.toFixed(1)}%
                </td>
                <td className={`bn-better${r.diff > 2 ? " bench" : r.diff < -2 ? " play" : ""}`}>
                  {r.diff > 2 ? "Bench" : r.diff < -2 ? "Play" : "Same"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** One scenario card: its win chance, expected cats, and the categories it helps. */
function Scenario({
  kind,
  title,
  note,
  win,
  cats,
  helpsLabel,
  helps,
}: {
  kind: "play" | "bench";
  title: string;
  note: string;
  win: number;
  cats: number;
  helpsLabel: string;
  helps: Array<[string, number]>;
}) {
  return (
    <section className={`bn-card ${kind}`}>
      <div className="bn-card-h">{title}</div>
      <div className="bn-note">{note}</div>
      <div className="bn-stats">
        <div>
          <span className="bn-l">Win probability</span>
          <span className="bn-v mono">{(win * 100).toFixed(1)}%</span>
        </div>
        <div>
          <span className="bn-l">Expected cats</span>
          <span className="bn-v mono">{cats.toFixed(2)}</span>
        </div>
      </div>
      <div className="bn-helps">
        <div className="bn-l">{helpsLabel}</div>
        {helps.length === 0 ? (
          <div className="bn-note">No category by more than 5 points.</div>
        ) : (
          helps.slice(0, 5).map(([cat, d]) => (
            <div key={cat} className="bn-help mono">
              {cat} +{d.toFixed(1)}%
            </div>
          ))
        )}
      </div>
    </section>
  );
}
