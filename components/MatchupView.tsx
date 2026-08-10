"use client";

import { useMemo, type ReactNode } from "react";
import type { LeagueData, Matchup } from "@/lib/league";
import {
  categoryValue,
  formatValue,
  scoreboardRows,
  categoryRecord,
  sideMoments,
} from "@/lib/league";
import { matchupOutcome, projectionPercentile } from "@/lib/probability";
import { gradeForecast, type Forecast } from "@/lib/predictions";
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
  /**
   * What the model said about this week BEFORE it was played, if it was logged. Null for
   * every week that predates the forecast log — which is all of them until a season runs
   * with the recorder in place. See lib/predictions.ts.
   */
  forecast?: Forecast | null;
  youName: string;
  oppName: string;
  /**
   * Team abbreviations, for the FINAL TOTALS table's two value columns.
   *
   * Full names are right in the header block above, where they identify the two teams and
   * have the width to do it. In the table they are column labels over a number, and
   * "Hustle and Hart" as a heading forces the five-column table wider than a phone —
   * "HAH" says the same thing to anyone reading their own league's scoreboard.
   */
  youAbbrev?: string;
  oppAbbrev?: string;
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
  youAbbrev,
  oppAbbrev,
  forecast = null,
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
    return (
      <Recap
        league={league}
        youName={youName}
        oppName={oppName}
        youAbbrev={youAbbrev}
        oppAbbrev={oppAbbrev}
        youVec={live.you}
        oppVec={live.opp}
        forecast={forecast}
        badge={
          <LiveBadge simulated={simulated} {...live} generatedAt={league.generatedAt} />
        }
      />
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

/**
 * The completed-matchup view: what happened, not what might.
 *
 * Everything the live view leads with — win probability, the score distribution, the
 * projection table — is meaningless once the week is over: there is one outcome and it
 * already happened. So this is a different page, not the live one with the numbers
 * frozen. Games-left tiles are gone (always 0), and the final record appears ONCE
 * rather than as both "Final 10-5-0" and "Categories won 10", which said the same
 * thing twice. The live view above is untouched.
 */
function Recap({
  league,
  youName,
  oppName,
  youAbbrev,
  oppAbbrev,
  youVec,
  oppVec,
  badge,
  forecast,
}: {
  league: LeagueData;
  youName: string;
  oppName: string;
  youAbbrev?: string;
  oppAbbrev?: string;
  youVec: number[];
  oppVec: number[];
  badge: ReactNode;
  /** The pre-week forecast, if one was logged. Null for weeks that predate the log. */
  forecast: Forecast | null;
}) {
  const rows = scoreboardRows(league, youVec, oppVec);
  const rec = categoryRecord(rows);

  const won = rec.win > rec.loss;
  const tied = rec.win === rec.loss;
  const margin = rec.win - rec.loss;

  // The two facts the strip below cannot be read for at a glance: the category you took
  // by the widest relative margin, and the one that came closest to flipping the result.
  const wins = rows.filter((r) => r.youWins);
  const best = wins.length
    ? wins.reduce((a, b) => (b.margin > a.margin ? b : a))
    : null;
  const decided = rows.filter((r) => r.margin !== 0);
  const closest = decided.length
    ? decided.reduce((a, b) => (Math.abs(b.margin) < Math.abs(a.margin) ? b : a))
    : null;

  return (
    <>
      <Header youName={youName} oppName={oppName} />
      {badge}

      <div className="metrics">
        <Metric
          label="Result"
          value={tied ? "Tied" : won ? "Won" : "Lost"}
          tone={tied ? undefined : won}
          delta={`${rec.win}-${rec.loss}-${rec.tie}`}
        />
        <Metric
          label="Margin"
          value={`${margin > 0 ? "+" : ""}${margin}`}
          delta={`of ${league.categories.length} categories`}
        />
        <Metric
          label="Biggest edge"
          value={best ? best.cat : "—"}
          delta={best ? best.marginStr : undefined}
          good
        />
        <Metric
          label="Closest call"
          value={closest ? closest.cat : "—"}
          delta={closest ? closest.marginStr : undefined}
          good={closest ? closest.margin > 0 : undefined}
        />
      </div>

      {forecast && (
        <PreGameForecast
          forecast={forecast}
          won={won}
          tied={tied}
          rec={rec}
          nCats={league.categories.length}
        />
      )}

      <h2>Final totals</h2>
      <div className="table-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th>Category</th>
              <th className="num">{youAbbrev || youName}</th>
              <th className="num">{oppAbbrev || oppName}</th>
              <th className="num">Margin</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.cat}>
                <td>{r.cat}</td>
                <td className={`num ${r.youWins ? "sb-win" : "sb-lose"}`}>{r.youStr}</td>
                <td className={`num ${r.oppWins ? "sb-win" : "sb-lose"}`}>{r.oppStr}</td>
                <td
                  className="num"
                  style={{
                    color:
                      r.margin === 0
                        ? "var(--ink-3)"
                        : r.margin > 0
                          ? "var(--good)"
                          : "var(--bad)",
                  }}
                >
                  {r.marginStr}
                </td>
                <td>{r.youWins ? "Won" : r.oppWins ? "Lost" : "Tied"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  tone,
}: {
  label: string;
  value: string;
  delta?: string;
  /** Colours the delta line. */
  good?: boolean;
  /** Colours the VALUE itself — true good, false bad, omitted for neutral. */
  tone?: boolean;
}) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div
        className="metric-value mono"
        style={
          tone === undefined
            ? undefined
            : { color: tone ? "var(--good)" : "var(--bad)" }
        }
      >
        {value}
      </div>
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

/**
 * The PRE-GAME forecast, shown on the finished matchup: the same gauge and score
 * distribution the live view leads with, drawn from the moments logged before the week
 * started — then the result placed next to them.
 *
 * The point is the COMPARISON. Alone, a finished result tells you what happened and a
 * forecast tells you what was expected; together they tell you whether the model
 * understood the matchup, which is the only way anyone should decide how much to trust it
 * next week. So the distribution keeps its full shape rather than collapsing to a single
 * number — the actual result landing in a fat part of the curve means something quite
 * different from it landing in the tail, and that is invisible in "70%".
 *
 * A SINGLE WEEK CANNOT MAKE A MODEL RIGHT OR WRONG. A 70% forecast that loses is not an
 * error, it is the 30% happening, and a page that stamped "WRONG" on it would teach the
 * reader to misread probability. The verdict is therefore stated quietly and the caption
 * says plainly that the number worth trusting is the hit rate across a season.
 */
function PreGameForecast({
  forecast,
  won,
  tied,
  rec,
  nCats,
}: {
  forecast: Forecast;
  won: boolean;
  tied: boolean;
  rec: { win: number; loss: number; tie: number };
  nCats: number;
}) {
  const { favoured, right } = gradeForecast(forecast, won, tied);
  // Expected minus actual, in categories — the SIZE of the miss, which says far more than
  // whether the coin landed the favoured way.
  const missed = rec.win - forecast.expected;

  return (
    <section className="fc">
      <h2 className="fc-h">Pre-game win probability</h2>

      <div className="two-up">
        <div>
          <h3 className="fc-sub-h">Win probability</h3>
          <WinProbabilityGauge percent={forecast.win * 100} />
        </div>
        <div>
          <h3 className="fc-sub-h">Score distribution</h3>
          <ScoreDistribution distribution={forecast.distribution} total={nCats} />
        </div>
      </div>

      <div className="fc-row">
        <div className="fc-cell">
          <span className="eyebrow">Forecast</span>
          <span className="fc-v mono">{(forecast.win * 100).toFixed(0)}%</span>
          <span className="fc-sub mono">to win · {forecast.expected.toFixed(1)} cats</span>
        </div>
        <div className="fc-cell">
          <span className="eyebrow">Actual</span>
          <span className="fc-v mono">{tied ? "Tied" : won ? "Won" : "Lost"}</span>
          <span className="fc-sub mono">
            {rec.win}-{rec.loss}-{rec.tie}
          </span>
        </div>
        <div className="fc-cell">
          <span className="eyebrow">Off by</span>
          <span className="fc-v mono">
            {missed >= 0 ? "+" : ""}
            {missed.toFixed(1)}
          </span>
          <span className="fc-sub mono">categories vs expected</span>
        </div>
        <div className="fc-cell">
          <span className="eyebrow">Called it</span>
          <span
            className="fc-v"
            style={{
              color:
                right == null ? "var(--ink-3)" : right ? "var(--good)" : "var(--bad)",
            }}
          >
            {right == null ? "—" : right ? "Yes" : "No"}
          </span>
          <span className="fc-sub mono">
            {favoured === "even"
              ? "called it a coin flip"
              : favoured === "you"
                ? "favoured you"
                : "favoured them"}
          </span>
        </div>
      </div>

      <p className="caption fc-note">
        Logged before a game of this week was played, and never recalculated since. One
        week decides nothing either way — a 70% forecast that loses is the 30% happening,
        not a mistake. What is worth reading is the hit rate across a whole season.
      </p>
    </section>
  );
}
