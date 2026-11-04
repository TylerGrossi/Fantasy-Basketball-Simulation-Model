/**
 * Crowded days — who to sit when not everyone with a game can start (owner, 2026-11-03).
 *
 * A day is crowded when your players with a game cannot all be seated in a LEGAL lineup:
 * more of them than starting slots, or too many at one position (four centres on a
 * ten-game night — C, and the three UTILs, hold only four, and the guards' slots cannot
 * take a centre). Positions come from ESPN's eligible slots; the slots are the league's
 * own (PG, SG, SF, PF, C, G, F, UTIL x3). G takes either guard, F either forward, UTIL
 * anyone — the rule in lib/playerPool.ts.
 *
 * The default is what you would do by hand: best by season VALUE first, each taken only
 * while everyone taken can still be seated (optimal for "most value that fits" — see
 * bestLineup in lib/playerPool.ts). Value is a season-long 9-cat ranking, so on a given
 * night it can sit the wrong player: a low-value big who is the only thing keeping you
 * ahead in BLK, while a higher-value scorer adds points you were winning anyway and shots
 * that drag a close FG%. This answers the question for THIS matchup.
 *
 * METHOD. The projection is first re-based so EVERY remaining day uses its legal default
 * lineup (the page's projection is count-only and can start an illegal lineup). Then each
 * crowded day is scored on its own, the other days held at that default: every legal way
 * of choosing who starts (as many as can legally start) is tried, and each is scored with
 * the Streamers arithmetic — swap each affected player's whole moments from his default
 * started games to the new count. The best by expected categories is the recommendation.
 *
 * Per player, "one game" is what that night's game is worth to you: expected categories
 * (and win chance) with him in the lineup that night minus without him, everyone else as
 * the recommended lineup has them. It can be NEGATIVE: in a category league a game can
 * hurt (FG%, FT%, TO) more than it helps. "Swap" is the best ONE-FOR-ONE change to his
 * call that keeps the lineup legal - bench a starter for one of the sits, or start a sit
 * in place of a starter - and what it costs; none at all means the call is locked.
 *
 * Limits: days are scored independently (a choice on Thursday does not re-score Saturday;
 * the interaction is second order). A player with no known positions (a pickup newer than
 * the export) can only fill UTIL. Days come from `useMoveWindow`, so today drops out once
 * the first game of the day tips off.
 */

import type { LeagueData, PlayerRow } from "./league";
import { rowMoments } from "./league";
import type { Moments } from "./probability";
import { addMoments, categoryProbabilities, matchupOutcome, subtractMoments } from "./probability";
import { evaluatePlan, preparePlan } from "./planner";
import { eligibleForSlot, seatable, type Slotted } from "./playerPool";

export interface CrowdedPlayer {
  name: string;
  nbaTeam: string;
  /** Season value over all 15 league categories (engine/data.py league_value): the default rule's ranking. */
  value: number;
  /** Real positions (PG..C) he is eligible at; null when unknown (a fresh pickup). */
  positions: string[] | null;
  /** His slot in the recommended lineup ("PG", "G", "UTIL"...); null when he sits. */
  slot: string | null;
  /** Sits in the default (by value, legal) lineup. */
  defaultSit: boolean;
  /** Sits in the recommended lineup. */
  recSit: boolean;
  /** Expected categories this game adds (recommended lineup with vs without him). */
  gameCats: number;
  /** Win chance this game adds, percentage points. */
  gameWinPct: number;
  /** Per-category effect of this game, percentage points, aligned to `categories`. */
  gameByCat: number[];
  /**
   * The best one-for-one swap that reverses his call while keeping the lineup legal: the
   * player who would trade places with him, and what it costs against the
   * recommendation (cats always <= 0; near zero is a coin flip). Null when no legal
   * swap exists - the call is locked by positions.
   */
  swapWith: string | null;
  swapCats: number | null;
  swapWinPct: number | null;
}

export interface CrowdedDay {
  date: string;
  playing: number;
  slots: number;
  /** Most that can start legally (below `slots` when positions bind). */
  canStart: number;
  /** How many must sit. */
  sit: number;
  players: CrowdedPlayer[];
  recCats: number;
  recWin: number;
  defaultCats: number;
  defaultWin: number;
  /** True when the recommendation differs from the default lineup. */
  changed: boolean;
}

export interface CrowdedContext {
  league: LeagueData;
  roster: PlayerRow[];
  teamMoments: Moments;
  oppMoments: Moments;
  dates: string[];
  teams: Record<string, Record<string, string>>;
  slots: number;
  ir?: Set<string>;
  /** Starting slots in order ("PG", ..., "UTIL"). Absent = count-only cap. */
  layout?: string[];
  /** Name -> ESPN eligible slots. A starter missing here can only play UTIL. */
  eligibility?: Record<string, string[]>;
}

const POSITIONS = new Set(["PG", "SG", "SF", "PF", "C"]);

/** All k-subsets of [0, n). n is at most a roster (13), k a handful — a few hundred. */
function combinations(n: number, k: number): number[][] {
  const out: number[][] = [];
  const cur: number[] = [];
  const go = (start: number) => {
    if (cur.length === k) {
      out.push(cur.slice());
      return;
    }
    for (let i = start; i <= n - (k - cur.length); i++) {
      cur.push(i);
      go(i + 1);
      cur.pop();
    }
  };
  go(0);
  return out;
}

const sumCats = (p: number[]) => p.reduce((a, b) => a + b, 0);

export function analyzeCrowdedDays(ctx: CrowdedContext): CrowdedDay[] {
  const { league } = ctx;
  const prep = preparePlan({
    league,
    roster: ctx.roster,
    pool: [],
    teamMoments: ctx.teamMoments,
    oppMoments: ctx.oppMoments,
    dates: ctx.dates,
    teams: ctx.teams,
    slots: ctx.slots,
    openSpots: 0,
    ir: ctx.ir,
  });
  const base = evaluatePlan(prep, []);
  const byName = new Map(ctx.roster.map((p) => [p.name, p]));

  // No layout: every slot is UTIL, i.e. the count-only cap.
  // Positions need BOTH the layout and the eligibility map; without the map every player
  // would fit only UTIL and a ten-man night would read as three starters.
  const positional = !!ctx.layout?.length && !!ctx.eligibility;
  const layout = positional ? ctx.layout! : Array<string>(ctx.slots).fill("UTIL");
  const slotted = (name: string): Slotted => ({
    eligibleSlots: positional ? (ctx.eligibility?.[name] ?? []) : ["UTIL"],
    position: "",
  });
  const legal = (rows: { name: string }[], idx: Iterable<number>) => {
    const ps = [...idx].map((i) => slotted(rows[i].name));
    return seatable(ps, layout) === ps.length;
  };

  // 1. Each day's DEFAULT lineup: best by value first, taken only while everyone taken
  //    can still be seated.
  const days = ctx.dates.map((date) => {
    const rows = base.rows.filter((r) => r.playing.has(date));
    const order = rows.map((_, i) => i).sort((a, b) => rows[b].value - rows[a].value);
    const defStart = new Set<number>();
    for (const i of order) {
      if (legal(rows, [...defStart, i])) defStart.add(i);
    }
    return { date, rows, defStart };
  });

  // 2. Re-base the projection on those legal lineups, so each day below is scored with
  //    the OTHER days as they could actually be set.
  const started = new Map<string, number>(base.rows.map((r) => [r.name, 0]));
  for (const d of days) {
    for (const i of d.defStart) started.set(d.rows[i].name, (started.get(d.rows[i].name) ?? 0) + 1);
  }
  let baseMoments = prep.teamMoments;
  for (const r of base.rows) {
    const p = byName.get(r.name);
    const to = started.get(r.name) ?? 0;
    if (!p || to === r.baseStarted) continue;
    baseMoments = addMoments(
      subtractMoments(baseMoments, rowMoments(league, p, r.baseStarted)),
      rowMoments(league, p, to)
    );
  }

  const out: CrowdedDay[] = [];
  for (const { date, rows, defStart } of days) {
    if (defStart.size === rows.length) continue; // everyone fits
    const k = rows.length - defStart.size;
    const all = rows.map((_, i) => i);
    const complement = (sit: Set<number>) => new Set(all.filter((i) => !sit.has(i)));

    // Projection with this day's lineup `starting` (indices into rows): each player whose
    // start moves off the default gets his whole moments swapped.
    const momentsFor = (starting: Set<number>): Moments => {
      let m = baseMoments;
      rows.forEach((r, i) => {
        const was = defStart.has(i);
        const now = starting.has(i);
        if (was === now) return;
        const p = byName.get(r.name);
        if (!p) return;
        const from = started.get(r.name) ?? 0;
        m = addMoments(
          subtractMoments(m, rowMoments(league, p, from)),
          rowMoments(league, p, from + (now ? 1 : -1))
        );
      });
      return m;
    };
    const catsFor = (starting: Set<number>) =>
      sumCats(categoryProbabilities(league, momentsFor(starting), ctx.oppMoments));

    // Start from the default so a tie keeps it: change only for a real gain.
    let best = { sit: all.filter((i) => !defStart.has(i)), cats: catsFor(defStart) };
    for (const sit of combinations(rows.length, k)) {
      const s = new Set(sit);
      const starting = complement(s);
      if (!legal(rows, starting)) continue;
      const cats = catsFor(starting);
      if (cats > best.cats + 1e-9) best = { sit, cats };
    }
    const recSit = new Set(best.sit);
    const recStart = complement(recSit);
    const rec = matchupOutcome(league, momentsFor(recStart), ctx.oppMoments);
    const def = matchupOutcome(league, momentsFor(defStart), ctx.oppMoments);
    const slotOf = seatLineup(rows, [...recStart], layout, slotted);

    // Every legal one-for-one swap: starter t to the bench, sit s into the lineup.
    const swaps: { t: number; s: number; cats: number }[] = [];
    for (const t of recStart) {
      for (const s of recSit) {
        const lineup = new Set(recStart);
        lineup.delete(t);
        lineup.add(s);
        if (legal(rows, lineup)) swaps.push({ t, s, cats: catsFor(lineup) });
      }
    }

    const players: CrowdedPlayer[] = rows.map((r, i) => {
      const withHim = new Set(recStart).add(i);
      const without = new Set(recStart);
      without.delete(i);
      const a = matchupOutcome(league, momentsFor(withHim), ctx.oppMoments);
      const b = matchupOutcome(league, momentsFor(without), ctx.oppMoments);
      const sat = recSit.has(i);
      let swap: { t: number; s: number; cats: number } | null = null;
      for (const w of swaps) {
        if ((sat ? w.s : w.t) !== i) continue;
        if (!swap || w.cats > swap.cats) swap = w;
      }
      let swapWinPct: number | null = null;
      if (swap) {
        const lineup = new Set(recStart);
        lineup.delete(swap.t);
        lineup.add(swap.s);
        swapWinPct = (matchupOutcome(league, momentsFor(lineup), ctx.oppMoments).win - rec.win) * 100;
      }
      const elig = ctx.eligibility?.[r.name];
      return {
        name: r.name,
        nbaTeam: r.nbaTeam,
        value: r.value,
        positions: elig ? elig.filter((x) => POSITIONS.has(x)) : null,
        slot: slotOf.get(i) ?? null,
        defaultSit: !defStart.has(i),
        recSit: recSit.has(i),
        gameCats: a.expectedCats - b.expectedCats,
        gameWinPct: (a.win - b.win) * 100,
        gameByCat: a.categoryProbs.map((x, c) => (x - b.categoryProbs[c]) * 100),
        swapWith: swap ? rows[sat ? swap.t : swap.s].name : null,
        swapCats: swap ? Math.min(0, swap.cats - best.cats) : null,
        swapWinPct,
      };
    });
    // Starters in lineup-slot order (as you would set them in ESPN), then the sits,
    // the closest call first.
    const slotRank = (p: CrowdedPlayer) => (p.slot ? layout.indexOf(p.slot) : layout.length);
    const flip = (p: CrowdedPlayer) => p.swapCats ?? -Infinity;
    players.sort((a, b) =>
      a.recSit !== b.recSit
        ? a.recSit
          ? 1
          : -1
        : a.recSit
          ? flip(b) - flip(a)
          : slotRank(a) - slotRank(b) || b.value - a.value
    );

    out.push({
      date,
      playing: rows.length,
      slots: ctx.slots,
      canStart: defStart.size,
      sit: k,
      players,
      recCats: rec.expectedCats,
      recWin: rec.win,
      defaultCats: def.expectedCats,
      defaultWin: def.win,
      changed: [...recStart].some((i) => !defStart.has(i)),
    });
  }
  return out;
}

// The legal by-value lineup lives in lib/seatRule.ts (shared with Streamers and the planner).
export { legalStarters } from "./seatRule";

/**
 * Who goes in which slot, for setting the lineup in ESPN: best by value into the earliest
 * slot he fits, but only while everyone left can still fill the slots after it (the
 * second pass of bestLineup in lib/playerPool.ts).
 */
function seatLineup(
  rows: { name: string; value: number }[],
  starters: number[],
  layout: string[],
  slotted: (name: string) => Slotted
): Map<number, string> {
  const out = new Map<number, string>();
  const left = [...starters].sort((a, b) => rows[b].value - rows[a].value);
  for (let si = 0; si < layout.length; si++) {
    for (let k = 0; k < left.length; k++) {
      if (!eligibleForSlot(slotted(rows[left[k]].name), layout[si])) continue;
      const rest = left.filter((_, j) => j !== k);
      if (seatable(rest.map((i) => slotted(rows[i].name)), layout.slice(si + 1)) === rest.length) {
        out.set(left[k], layout[si]);
        left.splice(k, 1);
        break;
      }
    }
  }
  return out;
}
