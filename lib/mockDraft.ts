/**
 * Mock draft engine for the Draft Guide: bots, their picks, and the post-draft grade.
 *
 * Design notes from the market research (2026-10-19):
 *   - FantasyPros' Draft Wizard bots draft off a random mix of expert sheets and ADP;
 *     FantasyBoss adds positional need. The most common complaint about sims is that
 *     every bot drafts the SAME list, so you practise against identical robots. So bots
 *     here have PERSONALITIES, and every pick carries noise.
 *   - The room being practised for is an ESPN room, and ESPN drafters (and every
 *     autodrafter) follow ESPN's list. So most bots draft by ESPN ADP: that is the market
 *     the value columns are trying to beat, and a mock against it shows whether the
 *     "ESPN low, others high" players really fall.
 *   - Basketball Monster grades a category draft by projected category standings, not by
 *     a single number — so the grade is each team's per-category total, ranked, and your
 *     category record against every other team.
 *
 * Deterministic per (seed, pick): undoing a pick and re-running the bots reproduces the
 * same room, so an undo is a real "what if I had taken him instead".
 */

import type { DraftRow } from "./projection";

export type Personality = "adp" | "expert" | "sharp";
export type MockStyle = "espn" | "mixed" | "experts";

export interface MockPick {
  pick: number;
  slot: number;
  playerId: number;
}

export interface MockState {
  active: boolean;
  slot: number;
  style: MockStyle;
  speedMs: number;
  seed: number;
  picks: MockPick[];
}

/**
 * HOUSE BIAS — deliberately backend-only (owner's call: no control or label on the page).
 * This league's managers reach for Knicks ("they always go earlier in our drafts"), so
 * every bot multiplies a Knick's rank by FAN_BOOST: 0.6 = drafted about 40% earlier
 * (raised from 0.75 at the owner's request, 2026-10-19). Measured over 30 mocks at 0.6:
 * Brunson 15 -> 10, Bridges 56 -> 36, Anunoby 72 -> 45, Hart 93 -> 64.
 * Edit here to change it; 1 turns it off.
 */
export const FAN_TEAMS = ["NYK"];
export const FAN_BOOST = 0.6;

export function houseBias(r: DraftRow): number {
  return FAN_TEAMS.includes(r.nbaTeam) ? FAN_BOOST : 1;
}

export const PERSONALITY_LABEL: Record<Personality, string> = {
  adp: "ESPN rank",
  expert: "Experts",
  sharp: "Sharp",
};

/**
 * Which personality each bot slot plays. "mixed" is weighted toward ADP because a real
 * ESPN room is: most managers draft from ESPN's queue, a couple read the experts, and
 * there is usually one who knows the categories.
 */
export function personalityFor(slot: number, style: MockStyle): Personality {
  if (style === "espn") return "adp";
  if (style === "experts") return "expert";
  // Owner (2026-10-19): auto picks should look like ESPN's rank. So even the mixed room
  // is six ESPN-rank bots to one expert and one sharp.
  const cycle: Personality[] = ["adp", "adp", "expert", "adp", "adp", "sharp", "adp", "adp"];
  return cycle[(slot - 1) % cycle.length];
}

/** mulberry32 — small, fast, seedable. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  const u = Math.max(1e-9, r());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}

/**
 * The list each personality drafts from. The "adp" personality is ESPN's own ROTO rank —
 * the order ESPN's autopick and default queue use — with ADP only as a fallback for the
 * few players ESPN has not ranked. (It drafted by ADP until the owner asked for auto
 * picks that track ESPN's rank; the id is kept so saved mocks still load.)
 */
function listRank(r: DraftRow, p: Personality): number {
  if (p === "sharp") return r.rank;
  if (p === "expert") return r.fpRank ?? r.adp ?? r.espnRank ?? 400;
  return r.espnRank ?? r.adp ?? 400;
}

const isBig = (r: DraftRow) => r.eligibleSlots.includes("C");
const isGuard = (r: DraftRow) => r.eligibleSlots.some((s) => s === "PG" || s === "SG");

/**
 * One bot pick. Score = the personality's rank x lognormal noise (about +-10%), nudged
 * by roster need: a bot with no centre by the middle rounds reaches for one, a bot
 * already heavy at one position drifts away from it, and an injured player slides.
 */
export function botPick(
  available: DraftRow[],
  roster: DraftRow[],
  personality: Personality,
  round: number,
  seed: number,
  pick: number,
  /** House bias: a rank multiplier per player (fan teams < 1). Applied BEFORE the
   *  candidate cut, so a Knick ranked 30 slots down can still be reached for. */
  bias: (r: DraftRow) => number = houseBias
): DraftRow | null {
  if (!available.length) return null;
  const r = rng(seed * 7919 + pick * 104729);
  const rankOf = (p: DraftRow) => listRank(p, personality) * bias(p);
  const pool = [...available].sort((a, b) => rankOf(a) - rankOf(b)).slice(0, 24);
  const bigs = roster.filter(isBig).length;
  const guards = roster.filter(isGuard).length;
  let best: DraftRow | null = null;
  let bestScore = Infinity;
  for (const p of pool) {
    let s = rankOf(p) * Math.exp(0.1 * gauss(r));
    if (round >= 6 && bigs === 0 && isBig(p)) s *= 0.8;
    if (bigs >= 4 && isBig(p) && !isGuard(p)) s *= 1.25;
    if (guards >= 6 && isGuard(p) && !isBig(p)) s *= 1.2;
    if (/OUT|INJURY_RESERVE/.test(p.status)) s *= 1.2;
    if (s < bestScore) {
      bestScore = s;
      best = p;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ grading */

export interface TeamGrade {
  slot: number;
  totals: Record<string, number>;
  /** Category rank among all teams, 1 = best. */
  catRank: Record<string, number>;
  /** All-play category record against every other team. */
  wins: number;
  losses: number;
  ties: number;
  pct: number;
  place: number;
}

/**
 * Projected standings from per-category z totals. z already carries the sign for
 * lower-is-better categories and the volume weighting for percentages, so a higher
 * total is always better and totals add across a roster.
 */
export function gradeTeams(
  rosters: Map<number, DraftRow[]>,
  categories: string[],
  weights: Record<string, number> = {}
): TeamGrade[] {
  const teams: TeamGrade[] = [...rosters.entries()].map(([slot, rows]) => {
    const totals: Record<string, number> = {};
    for (const c of categories) totals[c] = rows.reduce((a, r) => a + (r.z[c] ?? 0), 0);
    return { slot, totals, catRank: {}, wins: 0, losses: 0, ties: 0, pct: 0, place: 0 };
  });
  for (const c of categories) {
    const sorted = [...teams].sort((a, b) => b.totals[c] - a.totals[c]);
    sorted.forEach((t, i) => (t.catRank[c] = i + 1));
  }
  for (const a of teams) {
    for (const b of teams) {
      if (a === b) continue;
      for (const c of categories) {
        // Weighted like the board: a x0.25 category is a quarter of a win, x2 is two.
        const w = weights[c] ?? 1;
        if (w === 0) continue;
        const d = a.totals[c] - b.totals[c];
        if (Math.abs(d) < 1e-9) a.ties += w;
        else if (d > 0) a.wins += w;
        else a.losses += w;
      }
    }
    const n = a.wins + a.losses + a.ties;
    a.pct = n ? (a.wins + a.ties / 2) / n : 0;
  }
  [...teams].sort((a, b) => b.pct - a.pct).forEach((t, i) => (t.place = i + 1));
  return teams.sort((a, b) => a.slot - b.slot);
}

export function letterFor(place: number, teams: number): string {
  const f = (place - 1) / Math.max(1, teams - 1);
  if (f <= 0) return "A+";
  if (f <= 0.15) return "A";
  if (f <= 0.3) return "B+";
  if (f <= 0.45) return "B";
  if (f <= 0.6) return "C+";
  if (f <= 0.75) return "C";
  if (f < 1) return "D";
  return "F";
}
