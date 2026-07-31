/**
 * Bench / start-sit analysis.
 *
 * In a category league more production is not always better: a high-volume, low-efficiency
 * player can cost you FG% or TO while adding points you were already winning comfortably.
 * The question is whether any given player's remaining games help or hurt.
 *
 * The Streamlit version answered only the all-or-nothing form ("bench the whole roster
 * today?"). Since a swap is just moment subtraction, the far more actionable PER-PLAYER
 * form costs nothing extra — one evaluation per player, microseconds each.
 *
 * Semantics, stated precisely because it is easy to misread: "benching" here means the
 * player sits out ALL of their remaining games in this matchup window, not just today.
 * The exported data carries games-left over the whole window, not a per-day schedule.
 */

import type { LeagueData, PlayerRow } from "./league";
import { playerMoments } from "./league";
import type { Moments } from "./probability";
import { matchupOutcome, subtractMoments } from "./probability";

export interface BenchPlayerImpact {
  player: PlayerRow;
  /** Change in expected categories if this player sits the rest of the matchup. */
  deltaCats: number;
  deltaWinPct: number;
  /** True when sitting them IMPROVES your position. */
  hurts: boolean;
}

export interface BenchAnalysis {
  playAll: { win: number; expectedCats: number };
  /** Everyone sits: only what is already banked counts. */
  benchAll: { win: number; expectedCats: number };
  benchAllBetter: boolean;
  perPlayer: BenchPlayerImpact[];
}

export function analyzeBench(
  league: LeagueData,
  players: PlayerRow[],
  teamMoments: Moments,
  oppMoments: Moments,
  currentTotals: number[]
): BenchAnalysis {
  const play = matchupOutcome(league, teamMoments, oppMoments);

  // Bench everyone: the banked totals with no remaining production, so no uncertainty
  // on our side at all.
  const benchMoments: Moments = {
    mu: currentTotals.slice(),
    var: currentTotals.map(() => 0),
  };
  const bench = matchupOutcome(league, benchMoments, oppMoments);

  const perPlayer: BenchPlayerImpact[] = players
    .filter((p) => p.gamesLeft > 0)
    .map((p) => {
      const pm = playerMoments(p.avg, p.gamesLeft, league.variance);
      const out = matchupOutcome(league, subtractMoments(teamMoments, pm), oppMoments);
      const deltaCats = out.expectedCats - play.expectedCats;
      return {
        player: p,
        deltaCats,
        deltaWinPct: (out.win - play.win) * 100,
        hurts: deltaCats > 0,
      };
    });

  // Biggest gain from sitting first — those are the ones worth a second look.
  perPlayer.sort((a, b) => b.deltaCats - a.deltaCats);

  return {
    playAll: { win: play.win, expectedCats: play.expectedCats },
    benchAll: { win: bench.win, expectedCats: bench.expectedCats },
    benchAllBetter: bench.expectedCats > play.expectedCats,
    perPlayer,
  };
}
