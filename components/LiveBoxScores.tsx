"use client";

import type { BoxLine } from "@/lib/loadLeague";
import type { StatVector } from "@/lib/probability";
import { useLiveTotals } from "@/lib/useLiveTotals";
import { PlayerBoxTable } from "./PlayerBoxTable";

/**
 * The Box Score tab on Current Matchup, LIVE (2026-10-20): each player's matchup-to-date
 * line from ESPN, games in progress included, refreshed with the scoreboard. It shares
 * the scoreboard's poller (lib/useLiveTotals), so it costs no extra request.
 *
 * Paints from the exported lines first, then swaps in the live ones when they land.
 */
export default function LiveBoxScores({
  period,
  teamId,
  live = true,
  stats,
  youName,
  oppName,
  snapshotYou,
  snapshotOpp,
  youLines,
  oppLines,
}: {
  period: number;
  teamId: number;
  live?: boolean;
  stats: string[];
  youName: string;
  oppName: string;
  /** The scoreboard's snapshot vectors — only used to key the shared poller's first paint. */
  snapshotYou: StatVector;
  snapshotOpp: StatVector;
  /** Exported lines, shown until the live ones arrive. */
  youLines: BoxLine[];
  oppLines: BoxLine[];
}) {
  const totals = useLiveTotals(period, teamId, snapshotYou, snapshotOpp, live);
  const mine = totals.youLines ?? youLines;
  const theirs = totals.oppLines ?? oppLines;

  if (!mine.length && !theirs.length) {
    return (
      <p className="caption">
        No box score yet — player lines appear here as soon as this week&rsquo;s games
        start.
      </p>
    );
  }
  return (
    <>
      <PlayerBoxTable title={`${youName} box score`} stats={stats} lines={mine} />
      <PlayerBoxTable title={`${oppName} box score`} stats={stats} lines={theirs} />
    </>
  );
}
