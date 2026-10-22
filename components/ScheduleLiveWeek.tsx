"use client";

import { winPctText, type LeagueData, type Matchup } from "@/lib/league";
import { useLiveWin } from "@/lib/useLiveSides";

/**
 * The CURRENT week's row on the Schedule, live: the most likely final score and the
 * chance to win, from `useLiveWin` — the one live number Current Matchup, League Home and
 * Game Day show — instead of the export's snapshot, which read as a different (stale)
 * figure from every other page (owner, 2026-10-21).
 *
 * `cells` renders the desktop table's two cells; `mobile` the phone row's preview text.
 */
export default function ScheduleLiveWeek({
  league,
  matchup,
  isHome,
  teamId,
  variant,
}: {
  league: LeagueData;
  matchup: Matchup;
  isHome: boolean;
  teamId: number;
  variant: "cells" | "mobile";
}) {
  const { outcome } = useLiveWin(league, matchup, isHome, teamId);
  if (variant === "mobile") return <>{winPctText(outcome.win)} win</>;

  // The peak of the categories-won distribution: distribution[k] = P(win exactly k).
  const n = outcome.categoryProbs.length;
  const k = outcome.distribution.reduce((best, p, i, d) => (p > d[best] ? i : best), 0);
  return (
    <>
      <td className="num sched-proj">
        <span className="sched-proj-tag">proj</span>
        {k}-{n - k}
      </td>
      <td
        className="num"
        style={{ fontWeight: 700, color: outcome.win >= 0.5 ? "var(--good)" : "var(--bad)" }}
      >
        {winPctText(outcome.win)}
      </td>
    </>
  );
}
