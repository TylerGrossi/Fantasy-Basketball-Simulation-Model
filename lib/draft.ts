/**
 * Draft-night helpers: the shape of public/data/draft.json, snake-pick arithmetic, and the
 * VALUE maths — where ESPN's market disagrees with everyone else.
 *
 * The value idea, in one line: ESPN's rank and ADP are what an ESPN room actually drafts
 * by (the default queue, the autodraft, the list everyone stares at), so a player ESPN
 * ranks LOW while the other sources rank him HIGH is the one most likely to fall past
 * where he is worth taking. `consensusRank` is everyone-but-ESPN; `espnGap` is how far
 * ESPN's market sits behind it; `valuePct` prices one specific pick against it.
 */

import type { ProjectedLine } from "./projection";

export interface DraftLeague {
  id: number;
  season: number;
  name: string;
  teams: { id: number; name: string; abbrev: string }[];
  myTeamId: number | null;
  categories: string[];
  lowerIsBetter: string[];
  unknownStatIds: number[];
  rosterSlots: string[];
  rounds: number;
  draftType?: string;
  draftDate?: number;
  secondsPerPick?: number;
  pickOrder: number[];
}

export interface DraftData {
  generatedAt: string;
  league: DraftLeague;
  sources: Record<string, string>;
  lines: ProjectedLine[];
}

/** One pick as /api/draft reports it. */
export interface LivePick {
  pick: number;
  round: number;
  teamId: number;
  playerId: number;
}

export interface LiveDraft {
  drafted: boolean;
  inProgress: boolean;
  picks: LivePick[];
  pickOrder: number[];
  myTeamId: number | null;
  teams: { id: number; name: string; abbrev: string }[];
  fetchedAt: string;
  error?: string;
}

/** Overall pick numbers for draft slot `slot` (1-based) in a snake draft. */
export function snakePicks(slot: number, teams: number, rounds: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < rounds; r++) {
    out.push(r * teams + (r % 2 === 0 ? slot : teams - slot + 1));
  }
  return out;
}

/** Which slot (1-based) owns overall pick `pick`. */
export function slotForPick(pick: number, teams: number): number {
  const r = Math.floor((pick - 1) / teams);
  const i = (pick - 1) % teams;
  return r % 2 === 0 ? i + 1 : teams - i;
}

/** The outside sources that can feed the consensus. ESPN is deliberately not one. */
export const CONSENSUS_SOURCES = [
  { key: "board", label: "This board (your categories)" },
  { key: "fp", label: "FantasyPros ECR" },
  { key: "hb", label: "Hashtag projections (top 30, your cats)" },
  { key: "hbLast", label: "Hashtag, last season (your cats)" },
] as const;
export type SourceKey = (typeof CONSENSUS_SOURCES)[number]["key"];

export function sourceRank(
  l: ProjectedLine,
  key: SourceKey,
  boardRank: number
): number | undefined {
  if (key === "board") return boardRank;
  if (key === "fp") return l.fpRank;
  if (key === "hb") return l.hbRank;
  return l.hbLastRank;
}

/**
 * Mean of the selected non-ESPN ranks the player HAS. A source that does not list him
 * is skipped rather than counted as last, because Hashtag's free list stops at 30 —
 * absence there says nothing about player 31.
 */
export function consensusRank(
  l: ProjectedLine,
  boardRank: number,
  use: SourceKey[]
): number {
  const rs = use
    .map((k) => sourceRank(l, k, boardRank))
    .filter((r): r is number => typeof r === "number" && r > 0);
  return rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : boardRank;
}

/** What an ESPN room drafts by: ADP when there is one, else ESPN's roto rank. */
export function espnMarket(l: ProjectedLine): number | undefined {
  return l.adp && l.adp > 0 ? l.adp : l.espnRank;
}

/**
 * Value at a given pick: how much later than his consensus slot you are getting him,
 * as a share of the pick. Consensus 15 at pick 20 = +25%; consensus 30 at 20 = -50%
 * (a reach).
 */
export function valuePct(consensus: number, pick: number): number {
  return pick > 0 ? ((pick - consensus) / pick) * 100 : 0;
}

/* ------------------------------------------------------------------ recommendations */

/** Centre boost for the recommender (owner, 2026-10-19: "centres go fast and matter"). */
export const CENTER_BOOST = 0.6;
/** Once you hold this many centre-eligible players the boost switches off. */
export const CENTER_ENOUGH = 3;

export const isCenter = (r: { eligibleSlots: string[] }) => r.eligibleSlots.includes("C");

/**
 * The rank the stars and the Plan's suggestions sort by: this board's rank, with a
 * centre-eligible player's rank multiplied by CENTER_BOOST (0.6: about 40% better) until you
 * already have CENTER_ENOUGH of them. Lower is better.
 */
export function recRank(r: ProjectedLine & { rank: number }, centersHeld: number): number {
  return isCenter(r) && centersHeld < CENTER_ENOUGH ? r.rank * CENTER_BOOST : r.rank;
}

/* ------------------------------------------------------------------ lineup */

/** Which roster slots a player with these positions can fill. */
const SLOT_FITS: Record<string, (pos: string[]) => boolean> = {
  PG: (p) => p.includes("PG"),
  SG: (p) => p.includes("SG"),
  SF: (p) => p.includes("SF"),
  PF: (p) => p.includes("PF"),
  C: (p) => p.includes("C"),
  G: (p) => p.includes("PG") || p.includes("SG"),
  F: (p) => p.includes("SF") || p.includes("PF"),
  UTIL: () => true,
};

/**
 * Put a roster into the league's lineup, ESPN-style: slots filled in order with the best
 * eligible player (see the greedy pass below), never at the cost of an empty starting slot
 * (bipartite matching is the fallback), everyone else on the bench. IR slots are left out — nobody is drafted onto IR.
 */
export function buildLineup<T extends { eligibleSlots: string[] }>(
  players: T[],
  slots: string[]
): { slot: string; player: T | null }[] {
  const starters = slots.filter((s) => SLOT_FITS[s]);
  const benchCount = slots.filter((s) => s === "Bench").length;
  const owner: (number | null)[] = starters.map(() => null);
  const fits = (pi: number, si: number) => SLOT_FITS[starters[si]](players[pi].eligibleSlots);

  const tryPlace = (pi: number, seen: boolean[]): boolean => {
    for (let si = 0; si < starters.length; si++) {
      if (seen[si] || !fits(pi, si)) continue;
      seen[si] = true;
      if (owner[si] == null || tryPlace(owner[si] as number, seen)) {
        owner[si] = pi;
        return true;
      }
    }
    return false;
  };
  players.forEach((_, pi) => tryPlace(pi, starters.map(() => false)));
  const maxStarters = owner.filter((x) => x != null).length;

  // Preferred arrangement (owner, 2026-10-19: "position should be based on top value"):
  // fill the slots IN ORDER, each with the best remaining eligible player, so your best
  // PG-eligible player is the PG rather than whoever the matching happened to put there.
  // `players` arrive best-first. Used whenever it starts as many players as the matching;
  // otherwise (rare) the matching's arrangement stands, because an empty starting slot
  // costs more than a name in the "wrong" one.
  const greedy: (number | null)[] = starters.map(() => null);
  const used = new Set<number>();
  starters.forEach((slot, si) => {
    const pi = players.findIndex((p, i) => !used.has(i) && SLOT_FITS[slot](p.eligibleSlots));
    if (pi >= 0) {
      greedy[si] = pi;
      used.add(pi);
    }
  });
  if (greedy.filter((x) => x != null).length === maxStarters) {
    greedy.forEach((v, i) => (owner[i] = v));
  }

  const placed = new Set(owner.filter((x): x is number => x != null));
  const bench = players.filter((_, pi) => !placed.has(pi));
  const out: { slot: string; player: T | null }[] = starters.map((slot, si) => ({
    slot,
    player: owner[si] != null ? players[owner[si] as number] : null,
  }));
  const benchRows = Math.max(benchCount, bench.length);
  for (let i = 0; i < benchRows; i++) out.push({ slot: "Bench", player: bench[i] ?? null });
  return out;
}
