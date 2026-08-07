/**
 * Synthetic matchup PHASES, so the in-season views can be built and judged out of season.
 *
 * THE PROBLEM THIS SOLVES. A head-to-head week has three states and the app has to be good
 * in all of them:
 *
 *   - **pre**  — the week has not tipped off. Nothing is banked, every game is ahead of
 *                you, and the page is entirely a forecast. Widest uncertainty it will ever
 *                have; the score distribution is at its fattest.
 *   - **mid**  — some games played, some to come. The only state where banked totals and a
 *                projection are BOTH live, and the only one where a streamer or bench
 *                decision can still change the result. This is the state the app exists for.
 *   - **post** — every game played. Zero games left, therefore zero variance, therefore
 *                every probability is exactly 0% or 100%. A result, not a forecast.
 *
 * The season ended in April 2026, so **every real matchup in the export is `post`**. Left
 * alone, the pre and mid views cannot be opened at all — not to improve them, not to catch
 * a regression in them, not even to look at them. They are the majority of the app's
 * purpose and the minority of what can be seen.
 *
 * THE APPROACH. Rebuild a phase from the finished week rather than mock one up. Real
 * rosters, real per-game averages, real injuries, real variance vector, real final totals.
 * Exactly two things are assumed: how many games are still ahead, and what fraction of the
 * final totals is already banked. Everything downstream — every mu, every sigma, every
 * probability — is then computed by the same code path a live week uses, because it IS
 * that code path. A mocked payload would prove the components render; this proves the
 * maths runs.
 *
 * WHY IT MUST BE LABELLED. `current` and `projMu` in a snapshot are a matched pair
 * describing one instant. A synthetic state that leaked into a live-looking page would be
 * an impossible one — a final score sitting beside games still to play — and every derived
 * number would be quietly wrong rather than visibly wrong. So a phased page always turns
 * the live fetch OFF and always renders the banner (see `PHASE_NOTE`).
 */

import type { LeagueData, Matchup, TeamSide } from "./league";
import { playerMoments } from "./league";

export type Phase = "pre" | "mid";

/**
 * `?phase=pre|mid` — a DEVELOPER override with no link pointing at it, kept so the pre and
 * mid views can still be opened out of season. Anything else is ignored.
 *
 * There used to be a Pre-week / Mid-week / Final switcher on the page. It was removed
 * because it is not a product feature: which phase a week is in is a fact about the week,
 * not a setting, and offering it as a control invited reading a synthetic week as a live
 * one. In season the phase comes from `livePhase` and changes on its own.
 */
export function phaseFrom(v?: string): Phase | null {
  return v === "pre" || v === "mid" ? v : null;
}

/**
 * Which phase a REAL matchup is actually in, from the data alone.
 *
 * Games remaining is the deciding signal, because it is the one that changes what the page
 * can honestly say: with none left there is no variance and a probability would be
 * theatre. Between the two live states, nothing banked yet means the week has not started.
 *
 * `MatchupView` already switches itself to the recap when no games remain — this exists so
 * the surrounding copy agrees with it rather than having to be set by hand.
 */
export function livePhase(m: Matchup): Phase | "post" {
  const left = [...m.home.players, ...m.away.players]
    .reduce((a, p) => a + (p.gamesLeft || 0), 0);
  if (left === 0) return "post";
  const banked = [...m.home.current, ...m.away.current]
    .reduce((a, v) => a + (v || 0), 0);
  return banked > 0 ? "mid" : "pre";
}

interface PhaseSpec {
  /** Share of the week's games still to be played. */
  remaining: number;
  /** Share of the final totals already banked. */
  banked: number;
  label: string;
  note: string;
}

/**
 * `remaining` and `banked` are deliberately NOT forced to sum to 1.
 *
 * They describe different things — games on the schedule versus production in the book —
 * and a team is rarely exactly on pace. `mid` is set slightly ahead of pace (55% banked
 * with 45% of games left) because that is the ordinary case for the team that has played
 * the more front-loaded schedule, and a state where the two agree perfectly would hide any
 * bug that only appears when they disagree.
 */
const SPECS: Record<Phase, PhaseSpec> = {
  pre: {
    remaining: 1,
    banked: 0,
    label: "Pre-week preview",
    note:
      "nothing banked yet and a full slate ahead, so the page is pure forecast — this is " +
      "the widest the score distribution ever gets",
  },
  mid: {
    remaining: 0.45,
    banked: 0.55,
    label: "Mid-week preview",
    note:
      "roughly half the week banked with two to three games per player still to come — " +
      "the only state where a streamer or a bench call can still change the result",
  },
};

/** Games a healthy player gets in a full week. Varied so the sides are not identical. */
const FULL_WEEK_GAMES = [4, 3, 3];

/**
 * Rebuild one matchup in the given phase.
 *
 * Injured players keep zero games, exactly as in a real week — that is what makes the
 * bench and streamer pages show anything interesting, and zeroing it would quietly turn
 * every roster into a healthy one.
 */
export function phasedMatchup(
  league: LeagueData,
  m: Matchup,
  phase: Phase
): Matchup {
  const spec = SPECS[phase];

  const side = (s: TeamSide): TeamSide => {
    const players = s.players.map((p, i) => ({
      ...p,
      gamesLeft: p.injured
        ? 0
        : Math.max(0, Math.round(FULL_WEEK_GAMES[i % FULL_WEEK_GAMES.length] * spec.remaining)),
    }));

    const mu = league.stats.map(() => 0);
    const va = league.stats.map(() => 0);
    for (const p of players) {
      const pm = playerMoments(p.avg, p.gamesLeft, league.variance);
      for (let i = 0; i < mu.length; i++) {
        mu[i] += pm.mu[i];
        va[i] += pm.var[i];
      }
    }

    return {
      players,
      projMu: mu,
      projVar: va,
      current: s.current.map((v) => Math.round(v * spec.banked)),
    };
  };

  return { ...m, home: side(m.home), away: side(m.away) };
}

/** The banner copy for a phased page. Always rendered — see the header comment. */
export function phaseNote(phase: Phase): { label: string; note: string } {
  const s = SPECS[phase];
  return { label: s.label, note: s.note };
}
