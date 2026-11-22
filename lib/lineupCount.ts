/**
 * Who STARTS on each remaining day, for the win probability (owner, 2026-11-03).
 *
 * The export counts a crowded day the simple way: the 10 highest-value players with a game
 * start, positions ignored. The win probability now counts the lineups that will actually
 * be set:
 *   - YOUR team: the Bench section's crowded-day recommendation (lib/crowdedDays.ts) - the
 *     legal lineup, positions checked, that wins the most expected categories;
 *   - the OPPONENT: his ESPN lineup as it stands - players in starting slots start when
 *     they have a game; a starting slot whose player has no game is filled from his bench,
 *     best by value, positions checked (what a manager does); bench players otherwise sit.
 *   - a day that is not crowded: everyone with a game starts, as before.
 *
 * Applied as a DELTA on top of the export's counts, day by day over the days a lineup can
 * still change (useMoveWindow): for each player, games started under the new rule minus
 * under the export's, then his moments are swapped with rowMoments (availability-aware),
 * the same way every other swap in the app is done. Days already locked are untouched.
 *
 * Only the win probability reads this (useProjectedSides). Streamers, the planner and the
 * crowded-day analysis run their own day-by-day lineups against the export's counts and
 * must keep that baseline, or they would apply the rule twice.
 */

import type { LeagueData, PlayerRow, TeamSide } from "./league";
import { availabilityMoments, playerRank, rowMoments } from "./league";
import { addMoments, subtractMoments, type Moments } from "./probability";
import { rosterDays } from "./streamers";
import type { CrowdedDay } from "./crowdedDays";
import { legalStarters } from "./seatRule";
import type { LineupOrder } from "./lineupOrder";

export interface Window {
  dates: string[];
  teams: Record<string, Record<string, string>>;
  slots: number;
  layout: string[];
}

const rank = (league: LeagueData, p: PlayerRow) => playerRank(p, league.stats.indexOf("PTS"));

/**
 * BENCH FILL (owner, 2026-11-21). A crowded day's starters are chosen as if everyone plays,
 * and since Will They Play covers every player each starter counts only his chance of
 * playing - so a benched player whose game would be used when a starter sits counted 0.
 * A manager swaps him in. Here, per crowded day, who plays is drawn from Will They Play
 * (BENCH_DRAWS fixed, seeded draws), the lineup is re-seated in the SAME priority (the day's
 * starters first, then the bench by value, positions checked), and each benched player's
 * share of draws in which he is seated is his chance of a counted game that day.
 * Week 4 of 2026-27: per-team counted-games miss 3.5 -> 2.5 with this (positions ignored).
 */
const BENCH_DRAWS = 200; // ~3.5pp standard error per player-day; ~20 ms per crowded day

/** His chance of playing on `date` (Will They Play), 1 with no row for that date. */
function playChance(league: LeagueData, name: string, date: string): number {
  const row = league.availability?.[name]?.find(([d]) => d === date);
  return row ? Math.min(1, Math.max(0, row[1])) : 1;
}

/** Benched players' chance of a counted game on one day: name -> P(seated and plays). */
function benchFillDay(
  league: LeagueData,
  win: Window,
  date: string,
  starters: PlayerRow[],
  bench: PlayerRow[]
): Map<string, number> {
  const out = new Map<string, number>();
  if (!bench.length || !starters.length) return out;
  const pS = starters.map((p) => playChance(league, p.name, date));
  const pB = bench.map((p) => playChance(league, p.name, date));
  if (pS.every((p) => p >= 1)) return out; // every starter plays: no spot ever opens
  // Starters keep priority over the bench (huge rank), each group in value order.
  const prio = new Map<string, number>([
    ...starters.map((p): [string, number] => [p.name, 1e6 + rank(league, p)]),
    ...bench.map((p): [string, number] => [p.name, rank(league, p)]),
  ]);
  // mulberry32 seeded by the date: identical in every browser and on every render.
  let seed = 0x6e11;
  for (let i = 0; i < date.length; i++) seed = (Math.imul(seed, 31) + date.charCodeAt(i)) | 0;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hits = new Array(bench.length).fill(0);
  for (let d = 0; d < BENCH_DRAWS; d++) {
    const sPlay = pS.map((p) => rand() < p);
    const bPlay = pB.map((p) => rand() < p);
    if (sPlay.every(Boolean)) continue; // nobody sat: the starters fill the day as set
    const ranked = [
      ...starters.filter((_, i) => sPlay[i]),
      ...bench.filter((_, i) => bPlay[i]),
    ].map((p) => ({ name: p.name, value: prio.get(p.name)! }));
    const seated = legalStarters(ranked, win.layout, league.eligibility);
    bench.forEach((p, i) => {
      if (bPlay[i] && seated.has(p.name)) hits[i]++;
    });
  }
  bench.forEach((p, i) => {
    if (hits[i]) out.set(p.name, hits[i] / BENCH_DRAWS);
  });
  return out;
}

/** Recount one side's remaining starts with `startersFor(date, playing)`. */
function recount(
  league: LeagueData,
  side: TeamSide,
  win: Window,
  ir: Set<string>,
  startersFor: (date: string, playing: PlayerRow[]) => Set<string>
): TeamSide {
  const rows = side.players.filter((p) => !ir.has(p.name));
  const days = new Map(rows.map((p) => [p.name, rosterDays(p, win)]));
  const delta = new Map<string, number>();
  const fill = new Map<string, number[]>(); // benched player -> chance of a counted game, per day
  for (const d of win.dates) {
    const playing = rows.filter((p) => days.get(p.name)!.has(d));
    if (!playing.length) continue;
    // The export's rule for this day: top `slots` by value, count only.
    const old = new Set(
      [...playing].sort((a, b) => rank(league, b) - rank(league, a)).slice(0, win.slots).map((p) => p.name)
    );
    const now = startersFor(d, playing);
    for (const p of playing) {
      const dd = (now.has(p.name) ? 1 : 0) - (old.has(p.name) ? 1 : 0);
      if (dd) delta.set(p.name, (delta.get(p.name) ?? 0) + dd);
    }
    if (league.availability) {
      const benched = playing.filter((p) => !now.has(p.name)).sort((a, b) => rank(league, b) - rank(league, a));
      const starting = playing.filter((p) => now.has(p.name));
      for (const [name, q] of benchFillDay(league, win, d, starting, benched)) {
        fill.set(name, [...(fill.get(name) ?? []), q]);
      }
    }
  }
  // A player in an IR slot today scores nothing until he is activated (an activation is
  // a planner move) - the planner and crowded days always counted it that way; the gauge
  // kept his projected games until 2026-11-09, so their "no move" and the gauge differed.
  for (const p of side.players) {
    if (ir.has(p.name) && p.gamesLeft > 0) delta.set(p.name, -p.gamesLeft);
  }
  if (!delta.size && !fill.size) return side;
  let mine: Moments = { mu: side.projMu, var: side.projVar };
  const players = side.players.map((p) => {
    const dd = delta.get(p.name);
    const q = fill.get(p.name);
    if (!dd && !q) return p;
    let row = p;
    if (dd) {
      const to = Math.max(0, p.gamesLeft + dd);
      mine = addMoments(subtractMoments(mine, rowMoments(league, p, p.gamesLeft)), rowMoments(league, p, to));
      row = { ...row, gamesLeft: to };
    }
    if (q) {
      // Each fill day is a game he plays with chance q: the same moments as a doubtful game.
      mine = addMoments(mine, availabilityMoments(p.avg, q, league.variance, league.projectionError));
      row = { ...row, benchFill: q.reduce((a, b) => a + b, 0) };
    }
    return row;
  });
  return { ...side, players, projMu: mine.mu, projVar: mine.var };
}

const legalOf = (league: LeagueData, win: Window, playing: PlayerRow[]) =>
  legalStarters(
    playing.map((p) => ({ name: p.name, value: rank(league, p) })),
    win.layout,
    league.eligibility
  );

/** Your side: the Bench recommendation on a crowded day, everyone on any other. */
export function recountYours(
  league: LeagueData,
  side: TeamSide,
  win: Window,
  ir: Set<string>,
  crowded: CrowdedDay[] | null
): TeamSide {
  const rec = new Map((crowded ?? []).map((c) => [c.date, c]));
  return recount(league, side, win, ir, (d, playing) => {
    const r = rec.get(d);
    if (r) return new Set(r.players.filter((x) => !x.recSit).map((x) => x.name));
    return legalOf(league, win, playing);
  });
}

/**
 * The opponent: his ESPN lineup. Starters with a game start; open starting spots fill from
 * his bench by value while the lineup stays legal. No live lineup (first paint, demo):
 * the legal lineup by value.
 */
export function recountTheirs(
  league: LeagueData,
  side: TeamSide,
  win: Window,
  ir: Set<string>,
  lineup: LineupOrder
): TeamSide {
  const hasLineup = lineup.size > 0;
  return recount(league, side, win, ir, (_d, playing) => {
    if (!hasLineup) return legalOf(league, win, playing);
    const isStarter = (p: PlayerRow) => {
      const label = lineup.get(p.name)?.label;
      return !!label && label !== "Bench" && label !== "IR";
    };
    const starters = playing.filter(isStarter);
    const bench = playing.filter((p) => !isStarter(p)).sort((a, b) => rank(league, b) - rank(league, a));
    // Starters first (huge rank) so the legal greedy keeps every one of them, then his
    // bench in value order fills whatever is still open.
    const ranked = [
      ...starters.map((p) => ({ name: p.name, value: 1e6 + rank(league, p) })),
      ...bench.map((p) => ({ name: p.name, value: rank(league, p) })),
    ];
    return legalStarters(ranked, win.layout, league.eligibility);
  });
}
