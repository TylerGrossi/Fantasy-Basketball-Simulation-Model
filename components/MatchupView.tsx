"use client";

import { useMemo } from "react";
import type { LeagueData, Matchup } from "@/lib/league";
import {
  categoryValue,
  formatValue,
  scoreboardRows,
  categoryRecord,
  sideMoments,
} from "@/lib/league";
import { matchupOutcome, projectionPercentile } from "@/lib/probability";
import { useLiveTotals } from "@/lib/useLiveTotals";
import LiveBadge from "./LiveBadge";
import WinProbabilityGauge from "./WinProbabilityGauge";
import CategoryAnalysis from "./CategoryAnalysis";
import ScoreDistribution from "./ScoreDistribution";

interface Props {
  league: LeagueData;
  matchup: Matchup;
  isHome: boolean;
  teamId: number;
  /** false = freeze on the snapshot, never fetch (?demo=1). */
  live?: boolean;
  /** Numbers are synthetic (mid-week preview) — disclosed in the badge. */
  simulated?: boolean;
  youName: string;
  oppName: string;
}

const RATIO_PAIRS: Record<string, [string, string]> = {
  "FG%": ["FGM", "FGA"],
  "FT%": ["FTM", "FTA"],
  "3P%": ["3PM", "3PA"],
};

export default function MatchupView({
  league,
  matchup,
  isHome,
  teamId,
  live: liveEnabled = true,
  simulated = false,
  youName,
  oppName,
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

  const youMoments = useMemo(() => sideMoments(you, live.you), [you, live.you]);
  const oppMoments = useMemo(() => sideMoments(opp, live.opp), [opp, live.opp]);

  const hasGamesLeft =
    you.projVar.some((v) => v > 0) || opp.projVar.some((v) => v > 0);

  // Every number below is derived here, in the browser, in microseconds. There is no
  // "run simulation" step and no server round trip.
  const outcome = useMemo(
    () => matchupOutcome(league, youMoments, oppMoments),
    [league, youMoments, oppMoments]
  );

  const yourGames = you.players.reduce((a, p) => a + p.gamesLeft, 0);
  const oppGames = opp.players.reduce((a, p) => a + p.gamesLeft, 0);

  const mostLikely = outcome.distribution.reduce(
    (best, p, k) => (p > best.p ? { k, p } : best),
    { k: 0, p: -1 }
  );
  const nCats = league.categories.length;

  if (!hasGamesLeft) {
    // No games remain: probability would be theatre. Show the finished result instead —
    // the same choice the Streamlit app makes for completed weeks.
    const rows = scoreboardRows(league, live.you, live.opp);
    const rec = categoryRecord(rows);
    return (
      <>
        <Header youName={youName} oppName={oppName} />
        <LiveBadge simulated={simulated} {...live} generatedAt={league.generatedAt} />
        <div className="metrics">
          <Metric label="Final" value={`${rec.win}-${rec.loss}-${rec.tie}`} />
          <Metric label="Categories won" value={String(rec.win)} />
          <Metric label="Your games left" value="0" />
          <Metric label="Opp games left" value="0" />
        </div>
        <p className="caption">
          This matchup is complete — no games remain, so these are final totals rather
          than a projection.
        </p>
        <h2>Category results</h2>
        <CategoryAnalysis
          categories={league.categories}
          probs={rows.map((r) => (r.youWins ? 1 : r.oppWins ? 0 : 0.5))}
        />
      </>
    );
  }

  return (
    <>
      <Header youName={youName} oppName={oppName} />
      <LiveBadge simulated={simulated} {...live} generatedAt={league.generatedAt} />

      <div className="metrics">
        <Metric
          label="Expected cats"
          value={outcome.expectedCats.toFixed(1)}
          delta={`${(outcome.expectedCats - nCats / 2).toFixed(1)} vs even`}
          good={outcome.expectedCats >= nCats / 2}
        />
        <Metric label="Most likely" value={`${mostLikely.k}-${nCats - mostLikely.k}`} />
        <Metric label="Your games left" value={String(yourGames)} />
        <Metric label="Opp games left" value={String(oppGames)} />
      </div>

      <div className="two-up">
        <div>
          <h2>Win probability</h2>
          <WinProbabilityGauge percent={outcome.win * 100} />
        </div>
        <div>
          <h2>Score distribution</h2>
          <ScoreDistribution distribution={outcome.distribution} total={nCats} />
        </div>
      </div>

      <h2>Category analysis</h2>
      <CategoryAnalysis categories={league.categories} probs={outcome.categoryProbs} />

      <h2>Detailed projections</h2>
      <ProjectionTable
        league={league}
        probs={outcome.categoryProbs}
        youMu={youMoments.mu}
        youVar={youMoments.var}
        oppMu={oppMoments.mu}
        oppVar={oppMoments.var}
      />
      <p className="caption">
        Projections are end-of-matchup totals. The interval is the 10th–90th percentile,
        computed exactly from the projection rather than sampled.
      </p>
    </>
  );
}

function Header({ youName, oppName }: { youName: string; oppName: string }) {
  return (
    <div className="sb-hero">
      <span className="sb-name">{youName}</span>
      <span className="sb-name sb-name-right">{oppName}</span>
    </div>
  );
}

function Metric({
  label,
  value,
  delta,
  good,
}: {
  label: string;
  value: string;
  delta?: string;
  good?: boolean;
}) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div className="metric-value mono">{value}</div>
      {delta && (
        <div
          className="metric-delta mono"
          style={{ color: good ? "var(--good)" : "var(--bad)" }}
        >
          {delta}
        </div>
      )}
    </div>
  );
}

/** Projected totals + exact 10th/90th percentile bounds per category. */
function ProjectionTable({
  league,
  probs,
  youMu,
  youVar,
  oppMu,
  oppVar,
}: {
  league: LeagueData;
  probs: number[];
  youMu: number[];
  youVar: number[];
  oppMu: number[];
  oppVar: number[];
}) {
  const idx = (s: string) => league.stats.indexOf(s);

  function moments(cat: string, mu: number[], v: number[]): [number, number] {
    const pair = RATIO_PAIRS[cat];
    if (pair) {
      const a = mu[idx(pair[0])];
      const b = mu[idx(pair[1])];
      if (b <= 0) return [0, 0];
      const r = a / b;
      const varr =
        r * r *
        (v[idx(pair[0])] / Math.max(a * a, 1e-12) +
          v[idx(pair[1])] / Math.max(b * b, 1e-12));
      return [r, Math.sqrt(Math.max(varr, 0))];
    }
    const i = idx(cat);
    return [mu[i], Math.sqrt(Math.max(v[i], 0))];
  }

  return (
    <div className="table-scroll">
      <table className="sheet">
        <thead>
          <tr>
            <th>Category</th>
            <th className="num">You win %</th>
            <th className="num">Your proj</th>
            <th className="num">Opp proj</th>
            <th className="num">Your 10–90%</th>
            <th className="num">Opp 10–90%</th>
            <th>Swing</th>
          </tr>
        </thead>
        <tbody>
          {league.categories.map((cat, i) => {
            const [ym, ys] = moments(cat, youMu, youVar);
            const [om, os] = moments(cat, oppMu, oppVar);
            const p = probs[i] * 100;
            const swing = Math.abs(p - (100 - p)) <= 15;
            const fmt = (v: number) => formatValue(cat, v);
            return (
              <tr key={cat}>
                <td>{cat}</td>
                <td className="num">{p.toFixed(0)}%</td>
                <td className="num">{fmt(ym)}</td>
                <td className="num">{fmt(om)}</td>
                <td className="num">
                  {fmt(projectionPercentile(ym, ys, 0.1))} –{" "}
                  {fmt(projectionPercentile(ym, ys, 0.9))}
                </td>
                <td className="num">
                  {fmt(projectionPercentile(om, os, 0.1))} –{" "}
                  {fmt(projectionPercentile(om, os, 0.9))}
                </td>
                <td>{swing ? <span className="tag">SWING</span> : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
