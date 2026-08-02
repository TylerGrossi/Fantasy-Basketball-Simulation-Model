"use client";

import { useMemo } from "react";
import type { LeagueData, Matchup } from "@/lib/league";
import { categoryRecord, scoreboardRows, winProbability } from "@/lib/league";
import { useLiveTotals } from "@/lib/useLiveTotals";
import LiveBadge from "./LiveBadge";
import WinProbabilityGauge from "./WinProbabilityGauge";

interface Props {
  league: LeagueData;
  matchup: Matchup;
  isHome: boolean;
  teamId: number;
  /** false = freeze on the snapshot, never fetch (?demo=1). */
  live?: boolean;
  youName: string;
  oppName: string;
}

export default function Scoreboard({
  league,
  matchup,
  isHome,
  teamId,
  live: liveEnabled = true,
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

  const rows = useMemo(
    () => scoreboardRows(league, live.you, live.opp),
    [league, live.you, live.opp]
  );
  const rec = categoryRecord(rows);
  const outcome = useMemo(
    () => winProbability(league, you, opp, live.you, live.opp),
    [league, you, opp, live.you, live.opp]
  );
  const hasGamesLeft =
    you.projVar.some((v) => v > 0) || opp.projVar.some((v) => v > 0);

  return (
    <>
      {/*
        One line per side, the way a scoreboard reads: name, score, status, score, name.
        The record used to print twice (10-5-0 and its mirror 5-10-0) — the same fact
        stated backwards. Each side now owns its own number, so the mirror is the layout
        rather than a second string, and the leader is the one at full strength.
      */}
      <div className="board">
        <div className="board-side">
          <span className="board-team board-you">{youName}</span>
        </div>
        <div className={`board-score ${rec.win >= rec.loss ? "sb-win" : "sb-lose"}`}>
          {rec.win}
        </div>
        {/*
          Ties are a third outcome, not a third score. A tied category belongs to
          neither side, so it is held out of both numbers and stated once underneath —
          10 and 5 plus "1 tie" accounts for all 15 categories. Hidden when there are
          none, which is the usual case, rather than printing a dead "-0".
        */}
        <div className="board-center">
          <span className="board-status">{hasGamesLeft ? "In progress" : "Final"}</span>
          {rec.tie > 0 && (
            <span className="board-ties">
              {rec.tie} {rec.tie === 1 ? "tie" : "ties"}
            </span>
          )}
        </div>
        <div className={`board-score ${rec.loss >= rec.win ? "sb-win" : "sb-lose"}`}>
          {rec.loss}
        </div>
        <div className="board-side board-side-right">
          <span className="board-team board-opp">{oppName}</span>
        </div>
      </div>

      <LiveBadge {...live} generatedAt={league.generatedAt} />

      {/* Nothing stands in for the gauge once the matchup is done — the board says
          FINAL and the rows are self-evidently the finished totals. */}
      {hasGamesLeft && <WinProbabilityGauge percent={outcome.win * 100} />}

      <div>
        {rows.map((r) => (
          <div className="sb-row" key={r.cat}>
            <div className={`sb-val ${r.youWins ? "sb-win" : "sb-lose"}`}>{r.youStr}</div>
            <div className="sb-mid">
              <div className="sb-label">
                <span className="sb-cat">{r.cat}</span>
                <span
                  className="sb-margin"
                  style={{
                    color:
                      r.margin === 0
                        ? "var(--ink-3)"
                        : r.margin > 0
                          ? "var(--cobalt)"
                          : "var(--clay)",
                  }}
                >
                  {r.marginStr}
                </span>
              </div>
              {/*
                The bar grows toward the side that WINS the category — your lead points
                left, at your own number, and the opponent's points right at theirs. The
                first version had it backwards: your number sat on the left while the bar
                for a category you were winning shot right, across the opponent's name,
                which reads as them leading.
              */}
              <div className="sb-track">
                <div className="sb-half sb-half-left">
                  {r.margin > 0 && (
                    <div className="sb-bar sb-bar-you" style={{ width: `${r.width}%` }} />
                  )}
                </div>
                <div className="sb-axis" />
                <div className="sb-half sb-half-right">
                  {r.margin < 0 && (
                    <div className="sb-bar sb-bar-opp" style={{ width: `${r.width}%` }} />
                  )}
                </div>
              </div>
            </div>
            <div className={`sb-val sb-val-right ${r.oppWins ? "sb-win" : "sb-lose"}`}>
              {r.oppStr}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
