"use client";

import { useMemo } from "react";
import { AcquisitionLine, CategorySheet, tally } from "./BoxScoreSheet";
import type { AcquisitionSummary, LeagueData, Matchup } from "@/lib/league";
import { useLiveTotals } from "@/lib/useLiveTotals";
import LiveBadge from "./LiveBadge";

interface Props {
  league: LeagueData;
  matchup: Matchup;
  isHome: boolean;
  teamId: number;
  /** false = freeze on the snapshot, never fetch (?demo=1). */
  live?: boolean;
  youName: string;
  oppName: string;
  youAcq?: AcquisitionSummary;
  oppAcq?: AcquisitionSummary;
}

/**
 * The "Matchup" panel for the CURRENT week: ESPN's own box-score head-to-head, live.
 *
 * Deliberately just the board + category sheet + acquisition line — the model (win
 * probability, score distribution, category-by-category projection) lives on /matchup,
 * which this page does not touch. `CategorySheet`/`AcquisitionLine` are shared with the
 * completed-week recap (WeekRecap.tsx) so the two never drift into different column sets;
 * only the DATA differs — this component's vectors come from `useLiveTotals`, recap's
 * from a static export.
 */
export default function Scoreboard({
  league,
  matchup,
  isHome,
  teamId,
  live: liveEnabled = true,
  youName,
  oppName,
  youAcq,
  oppAcq,
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

  const rec = useMemo(() => tally(league, live.you, live.opp), [league, live.you, live.opp]);
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

      <CategorySheet
        league={league}
        youName={youName}
        oppName={oppName}
        youVec={live.you}
        oppVec={live.opp}
      />

      <AcquisitionLine youName={youName} oppName={oppName} youAcq={youAcq} oppAcq={oppAcq} />
    </>
  );
}
