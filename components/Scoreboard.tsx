"use client";

import { useMemo, type ReactNode } from "react";
import { AcquisitionLine, CategorySheet, tally } from "./BoxScoreSheet";
import Board from "./Board";
import ScoreboardTabs from "./ScoreboardTabs";
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
  /** Total games played so far this period, summed from the box lines. */
  youGp?: number;
  oppGp?: number;
  /** Tab labels and the two per-player box tables, rendered upstream on the server. */
  mineLabel: string;
  oppLabel: string;
  mine: ReactNode;
  opp: ReactNode;
}

/**
 * The CURRENT week: ESPN's own box-score head-to-head, live.
 *
 * Deliberately just the board + category sheet + acquisition line — the model (win
 * probability, score distribution, category-by-category projection) lives on /matchup,
 * which this page does not touch. `CategorySheet`/`AcquisitionLine` are shared with the
 * completed-week recap (WeekRecap.tsx) so the two never drift into different column sets;
 * only the DATA differs — this component's vectors come from `useLiveTotals`, recap's
 * from a static export.
 *
 * It OWNS the three-way tab control rather than being handed to it, because the board is
 * rendered in two places (above the tabs on mobile, inside the panel on desktop) and both
 * have to come from this component's single `useLiveTotals` — two Scoreboards would mean
 * two polls of /api/live. The recap path, which has no live state, still composes
 * `ScoreboardTabs` directly from the page.
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
  youGp,
  oppGp,
  mineLabel,
  oppLabel,
  mine,
  opp,
}: Props) {
  const you = isHome ? matchup.home : matchup.away;
  const oppSide = isHome ? matchup.away : matchup.home;

  const live = useLiveTotals(
    league.period,
    teamId,
    you.current,
    oppSide.current,
    liveEnabled
  );

  const rec = useMemo(() => tally(league, live.you, live.opp), [league, live.you, live.opp]);
  const hasGamesLeft =
    you.projVar.some((v) => v > 0) || oppSide.projVar.some((v) => v > 0);

  // The same board, twice — mobile shows the copy above the tabs, desktop the one inside
  // the panel. See Board.tsx.
  const board = (
    <Board
      youName={youName}
      oppName={oppName}
      youScore={rec.win}
      oppScore={rec.loss}
      tie={rec.tie}
      status={hasGamesLeft ? "In progress" : "Final"}
    />
  );

  return (
    <ScoreboardTabs
      mineLabel={mineLabel}
      oppLabel={oppLabel}
      board={board}
      mine={mine}
      opp={opp}
      matchup={
        <>
          {/*
            One panel, not three stacked cards. On desktop the board, the per-side
            acquisition and GP figures and the category sheet are all the SAME scoreboard,
            so they share one border and one background with internal rules between them —
            separate bordered blocks read as unrelated widgets. Mobile keeps them as
            separate blocks (see the media query), where stacked cards are the right form.

            The live badge is deliberately NOT in here: it is a note about when the data
            was fetched, not part of the scoreboard, so it sits plain underneath.
          */}
          <div className="sb-panel">
            {board}

            <CategorySheet
              league={league}
              youName={youName}
              oppName={oppName}
              youVec={live.you}
              oppVec={live.opp}
            />

            {/*
              Acquisitions and games played sit UNDER the category sheet.
              They used to sit directly beneath the board, which put two lines of secondary
              detail between the score and the categories — the thing you opened the page
              for. They are a footnote about how the week was managed, not part of the
              scoreline, and a footnote belongs after the thing it annotates.
            */}
            <AcquisitionLine
              youName={youName}
              oppName={oppName}
              youAcq={youAcq}
              oppAcq={oppAcq}
              youGp={youGp}
              oppGp={oppGp}
            />
          </div>

          {/* Outside the panel, unstyled: a footnote on when the totals were fetched, not
              a band of the scoreboard. */}
          <LiveBadge {...live} generatedAt={league.generatedAt} />
        </>
      }
    />
  );
}
