/**
 * Streamer analysis — every "pick up X, drop Y" scenario, evaluated in the browser.
 *
 * The Python version re-simulated the entire roster inside two nested loops, which made
 * the work O(streamers x droppables x players) full Monte Carlo draws — ~200M random
 * values for a normal league, and why the page took seconds. In the moment domain a swap
 * is just arithmetic:
 *
 *     mu'  = mu  - mu_drop  + mu_add
 *     var' = var - var_drop + var_add
 *
 * so each scenario is a handful of subtractions plus the Poisson-binomial DP. Measured at
 * ~5 microseconds per scenario, i.e. a 150-FA x 15-drop sweep is ~11ms — exhaustive and
 * instant, rather than capped at the 20 candidates the server version could afford.
 *
 * Validated against the Monte Carlo it replaces: identical top-10 pickups, worst rank
 * displacement 1 across 40 candidates, same #1 pick.
 *
 * It is also MORE reliable than the simulation for this particular job: every candidate is
 * scored against the same opponent projection, so differences reflect the players rather
 * than which candidate happened to draw a lucky week.
 */

import type { FreeAgent, LeagueData, PlayerRow } from "./league";
import { playerMoments } from "./league";
import type { Moments } from "./probability";
import { matchupOutcome, subtractMoments, addMoments } from "./probability";

export interface StreamerResult {
  /** The free agent to add. */
  add: FreeAgent;
  /** Best player to drop for them, or null when using an open roster spot. */
  drop: PlayerRow | null;
  /** Change in expected categories won vs. doing nothing. */
  deltaCats: number;
  /** Change in matchup win probability (percentage points). */
  deltaWinPct: number;
  /** Win probability after the move, 0-1. */
  win: number;
}

export interface StreamerOptions {
  /** When true, adding does not require dropping anyone. */
  hasOpenSpot?: boolean;
  /** Players you refuse to drop, by name. */
  untouchables?: Set<string>;
  /** Cap on returned rows. */
  limit?: number;
}

export function analyzeStreamers(
  league: LeagueData,
  roster: PlayerRow[],
  teamMoments: Moments,
  oppMoments: Moments,
  options: StreamerOptions = {}
): { baseline: { win: number; expectedCats: number }; results: StreamerResult[] } {
  const { hasOpenSpot = false, untouchables = new Set<string>(), limit = 40 } = options;

  const base = matchupOutcome(league, teamMoments, oppMoments);
  const baseline = { win: base.win, expectedCats: base.expectedCats };

  // Only players who can actually be dropped, and only free agents who will play.
  const droppable = roster.filter((p) => !untouchables.has(p.name));
  const candidates = league.freeAgents.filter((fa) => fa.gamesLeft > 0);
  if (candidates.length === 0 || (droppable.length === 0 && !hasOpenSpot)) {
    return { baseline, results: [] };
  }

  // Each roster player's contribution, computed once and reused across every scenario.
  const dropMoments = new Map<string, Moments>(
    droppable.map((p) => [p.name, playerMoments(p.avg, p.gamesLeft, league.variance)])
  );

  const results: StreamerResult[] = [];
  for (const fa of candidates) {
    const addM = playerMoments(fa.avg, fa.gamesLeft, league.variance);
    let best: StreamerResult | null = null;

    const evaluate = (drop: PlayerRow | null) => {
      let mine = teamMoments;
      if (drop) {
        const dm = dropMoments.get(drop.name);
        if (!dm) return;
        mine = subtractMoments(mine, dm);
      }
      mine = addMoments(mine, addM);
      const out = matchupOutcome(league, mine, oppMoments);
      const deltaCats = out.expectedCats - base.expectedCats;
      if (!best || deltaCats > best.deltaCats) {
        best = {
          add: fa,
          drop,
          deltaCats,
          deltaWinPct: (out.win - base.win) * 100,
          win: out.win,
        };
      }
    };

    if (hasOpenSpot) evaluate(null);
    for (const d of droppable) evaluate(d);
    if (best) results.push(best);
  }

  results.sort((a, b) => b.deltaCats - a.deltaCats);
  return { baseline, results: results.slice(0, limit) };
}

/** Sum a roster's per-player moments into a team projection. */
export function rosterMoments(
  players: PlayerRow[],
  variance: number[],
  statCount: number
): Moments {
  const mu = new Array(statCount).fill(0);
  const v = new Array(statCount).fill(0);
  for (const p of players) {
    const m = playerMoments(p.avg, p.gamesLeft, variance);
    for (let i = 0; i < statCount; i++) {
      mu[i] += m.mu[i];
      v[i] += m.var[i];
    }
  }
  return { mu, var: v };
}
