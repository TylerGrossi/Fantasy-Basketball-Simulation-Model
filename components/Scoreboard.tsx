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
      <div className="sb-hero">
        <span className="sb-name">{youName}</span>
        <span className="sb-score">
          <span className="sb-score-main">
            {rec.win}-{rec.loss}-{rec.tie}
          </span>
          <span className="sb-score-sub">
            {rec.loss}-{rec.win}-{rec.tie}
          </span>
        </span>
        <span className="sb-name sb-name-right">{oppName}</span>
      </div>

      <LiveBadge {...live} generatedAt={league.generatedAt} />

      {hasGamesLeft ? (
        <WinProbabilityGauge percent={outcome.win * 100} />
      ) : (
        <p className="caption">
          Final result — no games remain in this matchup, so these are the finished
          category totals.
        </p>
      )}

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
              <div className="sb-track">
                <div className="sb-half sb-half-left">
                  {r.margin < 0 && (
                    <div className="sb-bar sb-bar-opp" style={{ width: `${r.width}%` }} />
                  )}
                </div>
                <div className="sb-axis" />
                <div className="sb-half sb-half-right">
                  {r.margin > 0 && (
                    <div className="sb-bar sb-bar-you" style={{ width: `${r.width}%` }} />
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
