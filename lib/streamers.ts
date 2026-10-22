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
import { categoryProbabilities, matchupOutcome, subtractMoments, addMoments } from "./probability";

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
  /**
   * Net change in games your lineup actually plays: the pickup's started games, less the
   * dropped player's, less any starter the pickup pushes to the bench on a full day.
   * Whole games with `daily`; the old add-minus-drop count without it.
   */
  netGames: number;
}

/**
 * The days a move made now affects, and the lineup rule on each (owner, 2026-10-21).
 *
 * On a day more of your players have games than there are starting slots, the best by
 * value start and the rest sit — the same rule the projection's counted games use. Given
 * this, a swap is scored by re-running that rule over `dates` with the new roster, so a
 * pickup gets credit only for the nights he would actually start, and a starter he pushes
 * to the bench is charged.
 */
export interface DailyLineup {
  /** The days the move takes effect on, ascending (ESPN roster lock already applied). */
  dates: string[];
  /** The week's NBA schedule: team -> ISO date -> opponent. */
  teams: Record<string, Record<string, string>>;
  /** Starting slots per day. */
  slots: number;
}

export interface StreamerOptions {
  /** When true, adding does not require dropping anyone. */
  hasOpenSpot?: boolean;
  /** Players you refuse to drop, by name. */
  untouchables?: Set<string>;
  /** Cap on returned rows. Unlimited by default. */
  limit?: number;
  /** Seat the swap day by day (see DailyLineup). Without it, whole games left swap. */
  daily?: DailyLineup;
}

/** Anyone the lineup rule can seat: a roster player or a free agent. */
type Seatable = Pick<PlayerRow, "name" | "nbaTeam" | "avg" | "value"> & {
  /** The days he can play within `dates`. */
  days: Set<string>;
};

/** Started games per player over `dates`: each day, the best `slots` by value who play. */
function startedGames(players: Seatable[], dates: string[], slots: number): Map<string, number> {
  const out = new Map<string, number>(players.map((p) => [p.name, 0]));
  for (const d of dates) {
    const playing = players.filter((p) => p.days.has(d));
    if (playing.length > slots) playing.sort((a, b) => rankOf(b) - rankOf(a));
    for (const p of playing.slice(0, slots)) out.set(p.name, (out.get(p.name) ?? 0) + 1);
  }
  return out;
}

/** Value when the export carries it; points per game on an export from before it did. */
let ptsIdx = -1;
const rankOf = (p: Pick<Seatable, "avg" | "value">) =>
  typeof p.value === "number" ? p.value : (p.avg[ptsIdx] ?? 0);

/**
 * The days a roster player can play within `dates`: his team's games, unless he is hurt —
 * then only as many as his injury-aware schedule count allows, taken from the END of the
 * window (a player returning mid-week plays the late games, not the early ones).
 */
function rosterDays(p: PlayerRow, daily: DailyLineup): Set<string> {
  const team = daily.teams[p.nbaTeam];
  if (!team) return new Set();
  const all = daily.dates.filter((d) => team[d]);
  const allowed = p.nbaGamesLeft ?? p.gamesLeft;
  if (!p.injured && allowed >= all.length) return new Set(all);
  const k = Math.max(0, Math.min(all.length, Math.round(allowed)));
  return new Set(k ? all.slice(-k) : []);
}

export function analyzeStreamers(
  league: LeagueData,
  roster: PlayerRow[],
  teamMoments: Moments,
  oppMoments: Moments,
  options: StreamerOptions = {}
): { baseline: { win: number; expectedCats: number }; results: StreamerResult[] } {
  const {
    hasOpenSpot = false,
    untouchables = new Set<string>(),
    limit = Infinity,
    daily,
  } = options;
  ptsIdx = league.stats.indexOf("PTS");

  const base = matchupOutcome(league, teamMoments, oppMoments);
  const baseline = { win: base.win, expectedCats: base.expectedCats };

  // Only players who can actually be dropped, and only free agents who will play.
  const droppable = roster.filter((p) => !untouchables.has(p.name));
  const candidates = league.freeAgents.filter((fa) => fa.gamesLeft > 0);
  if (candidates.length === 0 || (droppable.length === 0 && !hasOpenSpot)) {
    return { baseline, results: [] };
  }

  // DAILY: the roster as the lineup rule sees it, and its started games with no move.
  const seated: Seatable[] = daily
    ? roster.map((p) => ({ ...p, days: rosterDays(p, daily) }))
    : [];
  const before = daily ? startedGames(seated, daily.dates, daily.slots) : null;
  const byName = new Map(roster.map((p) => [p.name, p]));

  // WHOLE-GAMES fallback: each roster player's contribution, computed once.
  const dropMoments = new Map<string, Moments>(
    droppable.map((p) => [p.name, playerMoments(p.avg, p.gamesLeft, league.variance, league.projectionError)])
  );

  const results: StreamerResult[] = [];
  for (const fa of candidates) {
    const addM = playerMoments(fa.avg, fa.gamesLeft, league.variance, league.projectionError);
    const faSeat: Seatable | null = daily
      ? {
          ...fa,
          days: new Set(daily.dates.filter((d) => daily.teams[fa.nbaTeam]?.[d])),
        }
      : null;
    let best: StreamerResult | null = null;
    let bestMine: Moments | null = null;

    const evaluate = (drop: PlayerRow | null) => {
      let mine = teamMoments;
      let netGames: number;
      if (daily && before && faSeat) {
        /*
         * Re-seat the week with the new roster and apply only what CHANGED: every player
         * whose started games moved (the pickup, the drop, a starter bumped to the bench
         * or one freed back into the lineup) adds or removes that many games of his line.
         */
        const after = startedGames(
          [...seated.filter((p) => p.name !== drop?.name), faSeat],
          daily.dates,
          daily.slots
        );
        netGames = 0;
        // From `from` started games to `to`: swap his whole moments rather than adding the
        // difference, since the projection-error term is not additive over games.
        const apply = (avg: number[], from: number, to: number) => {
          if (from === to) return;
          netGames += to - from;
          const v = league.variance;
          const pe = league.projectionError;
          mine = addMoments(
            subtractMoments(mine, playerMoments(avg, from, v, pe)),
            playerMoments(avg, to, v, pe)
          );
        };
        for (const [name, g] of before) {
          const p = byName.get(name);
          if (p) apply(p.avg, g, after.get(name) ?? 0);
        }
        apply(fa.avg, 0, after.get(fa.name) ?? 0);
      } else {
        if (drop) {
          const dm = dropMoments.get(drop.name);
          if (!dm) return;
          mine = subtractMoments(mine, dm);
        }
        mine = addMoments(mine, addM);
        netGames = fa.gamesLeft - (drop?.gamesLeft ?? 0);
      }
      // Ranked on expected categories alone — the sum of the per-category odds, which
      // the category correlation does not touch. The win chance (the correlated draw,
      // the expensive part) is taken once per free agent, for his best move, below:
      // ~1,800 full matchups per render became ~130.
      const expectedCats = categoryProbabilities(league, mine, oppMoments).reduce((a, b) => a + b, 0);
      const deltaCats = expectedCats - base.expectedCats;
      if (!best || deltaCats > best.deltaCats) {
        best = { add: fa, drop, deltaCats, deltaWinPct: 0, win: 0, netGames };
        bestMine = mine;
      }
    };

    if (hasOpenSpot) evaluate(null);
    for (const d of droppable) evaluate(d);
    if (best && bestMine) {
      const win = matchupOutcome(league, bestMine, oppMoments).win;
      results.push({ ...(best as StreamerResult), win, deltaWinPct: (win - base.win) * 100 });
    }
  }

  results.sort((a, b) => b.deltaCats - a.deltaCats);
  return { baseline, results: results.slice(0, limit) };
}

/** Sum a roster's per-player moments into a team projection. */
export function rosterMoments(
  players: PlayerRow[],
  variance: number[],
  statCount: number,
  projectionError?: number[]
): Moments {
  const mu = new Array(statCount).fill(0);
  const v = new Array(statCount).fill(0);
  for (const p of players) {
    const m = playerMoments(p.avg, p.gamesLeft, variance, projectionError);
    for (let i = 0; i < statCount; i++) {
      mu[i] += m.mu[i];
      v[i] += m.var[i];
    }
  }
  return { mu, var: v };
}
