/**
 * Week Planner — a sequence of adds and drops across the matchup week, scored day by day.
 *
 * Streamers answers "what is the best ONE move right now". The planner answers the
 * question the owner was answering by hand in a spreadsheet every week: given N
 * acquisitions for the matchup, WHEN should each add happen and WHO goes out for it, so
 * the lineup fills as many of its starting slots as possible on as many days as possible
 * — including chains, where a streamer added Monday is himself dropped Thursday for the
 * next one.
 *
 * MODEL. A plan is a list of moves `{date, add, drop}`. A move dated `d` happens before
 * the first tip-off on `d` (or the night before, once `d - 1` is locked): the added
 * player can play from `d`, the dropped one cannot. Every player then has a span on the
 * roster, and each day the same lineup rule as Streamers and the schedule grid seats the
 * best `slots` players by value who have a game. A player's STARTED games are what enter
 * the projection.
 *
 * SCORING reuses the Streamers arithmetic exactly (lib/streamers.ts): start from the live
 * team projection, and for every player whose started games changed, swap his whole
 * moments for the new count. So a plan's expected categories and win chance are on the
 * same footing as every other number on the Current Matchup page.
 *
 * OPTIMISER. Greedy, then local search:
 *   1. add the single move that improves the objective most, given the moves already in
 *      the plan; repeat until the moves run out or nothing helps;
 *   2. revisit each chosen move with the others held fixed, and swap it for a better one
 *      if there is one (greedy picks early moves without knowing the later ones).
 * The search space per step is (free agent) x (one of his game days) x (who is on the
 * roster that day) — adding on any other day is never better than adding on the first
 * game day you want him for. Measured ~10-40ms per step on a 126-player pool.
 *
 * IR (owner, 2026-10-29). A player in ESPN's IR slot cannot score until he is moved to an
 * active spot, and with a full roster that means dropping someone - the same shape as an
 * add, so it is a move here too: `{kind: "activate", add: <IR player>, drop}`. Until his
 * activation he is off the active roster, and his games come OUT of the baseline (the
 * export only zeroes him when he was already on IR at export time). An activation is not
 * an acquisition, so it does not count against the week's limit, and the optimiser
 * plans activations as well as pickups.
 *
 * What it does NOT model (yet): positional eligibility for the starting slots (it uses
 * the same count-only cap as the projection), waiver claims (a recently dropped player
 * cannot be added instantly), or the season-long cost of dropping someone — protect
 * players you mean to keep.
 */

import type { FreeAgent, LeagueData, PlayerRow } from "./league";
import { playerMoments } from "./league";
import type { Moments } from "./probability";
import { addMoments, categoryProbabilities, subtractMoments } from "./probability";
import { playerStatus } from "./playerPool";
import { rosterDays } from "./streamers";

export type PlanObjective = "cats" | "games";

export interface PlannedMove {
  id: string;
  /** "add" (default) picks up a free agent; "activate" moves `add` off IR. */
  kind?: "add" | "activate";
  /** ISO date the move takes effect: the pickup can play from this day, the drop cannot. */
  date: string;
  /** Free agent added, by name. */
  add: string;
  /** Roster player (or an earlier pickup) dropped, by name; null = an open roster spot. */
  drop: string | null;
}

export interface PlanContext {
  league: LeagueData;
  /** Your roster as it stands now (live), with games left. */
  roster: PlayerRow[];
  /** Who can be added: free agents not on anyone's live roster. */
  pool: FreeAgent[];
  /** Your live projection: banked totals plus the rest of the week. */
  teamMoments: Moments;
  oppMoments: Moments;
  /** The days a move can still change, ascending (roster lock already applied). */
  dates: string[];
  /** The week's NBA schedule: team -> ISO date -> opponent. */
  teams: Record<string, Record<string, string>>;
  /** Starting slots per day. */
  slots: number;
  /** Adds allowed without a drop. */
  openSpots: number;
  /** Roster players in ESPN's IR slot today: inactive until an activate move. */
  ir?: Set<string>;
}

/** `from` for an IR player not yet activated: after every real date, so never active. */
export const INACTIVE = "9999-12-31";
export const isAdd = (m: PlannedMove) => m.kind !== "activate";

/** One player's line in an evaluated plan — a row of the planner grid. */
export interface PlanRow {
  name: string;
  nbaTeam: string;
  value: number;
  status: string;
  /** True for a pickup from the plan. */
  added: boolean;
  /** True for a player in the IR slot (active only once an activate move lands). */
  ir: boolean;
  /** On the roster from this day (null = already on it). */
  from: string | null;
  /** Off the roster from this day (null = kept all week). */
  until: string | null;
  /** Plannable days he is on the roster AND has a game he is fit to play. */
  playing: Set<string>;
  /** The subset of `playing` he starts. */
  starts: Set<string>;
  /** Started games without any move (0 for a pickup). */
  baseStarted: number;
}

export interface PlanEvaluation {
  rows: PlanRow[];
  perDay: { date: string; playing: number; started: number; baseStarted: number }[];
  started: number;
  baseStarted: number;
  expectedCats: number;
  baseCats: number;
  /** Your projection with the plan applied. */
  moments: Moments;
  /** Moves that could not be applied, by id, with the reason. Skipped in the score. */
  invalid: Map<string, string>;
  /** The applied moves, in the order they happen. */
  applied: PlannedMove[];
}

interface Seat {
  name: string;
  nbaTeam: string;
  avg: number[];
  rank: number;
  status: string;
  days: Set<string>;
  from: string | null;
  until: string | null;
  added: boolean;
  ir: boolean;
}

/** Everything about a context that does not depend on the plan, computed once. */
export interface PreparedPlan {
  ctx: PlanContext;
  /** The live projection with IR players' games taken out - the plan's starting point. */
  teamMoments: Moments;
  roster: Seat[];
  pool: Map<string, Seat>;
  base: Map<string, number>;
  baseCats: number;
  basePerDay: number[];
}

const rankOf = (value: number | undefined, avg: number[], ptsIdx: number) =>
  typeof value === "number" ? value : (avg[ptsIdx] ?? 0);

export function preparePlan(ctx: PlanContext): PreparedPlan {
  const ptsIdx = ctx.league.stats.indexOf("PTS");
  const window = { dates: ctx.dates, teams: ctx.teams };
  const ir = ctx.ir ?? new Set<string>();
  const roster: Seat[] = ctx.roster.map((p) => ({
    name: p.name,
    nbaTeam: p.nbaTeam,
    avg: p.avg,
    rank: rankOf(p.value, p.avg, ptsIdx),
    status: p.status,
    days: rosterDays(p, window),
    from: ir.has(p.name) ? INACTIVE : null,
    until: null,
    added: false,
    ir: ir.has(p.name),
  }));
  // A player on IR scores nothing until activated, whatever games the projection gave
  // him (it only knows about IR as of the export).
  let teamMoments = ctx.teamMoments;
  for (const p of ctx.roster) {
    if (ir.has(p.name) && p.gamesLeft > 0) {
      teamMoments = subtractMoments(
        teamMoments,
        playerMoments(p.avg, p.gamesLeft, ctx.league.variance, ctx.league.projectionError)
      );
    }
  }
  const onRoster = new Set(ctx.roster.map((p) => p.name));
  const pool = new Map<string, Seat>();
  for (const fa of ctx.pool) {
    if (onRoster.has(fa.name)) continue;
    // A free agent ruled out has no games to give, whatever his team's schedule says.
    const out = playerStatus(fa.status)[1] === "out";
    const games = ctx.teams[fa.nbaTeam] ?? {};
    pool.set(fa.name, {
      name: fa.name,
      nbaTeam: fa.nbaTeam,
      avg: fa.avg,
      rank: rankOf(fa.value, fa.avg, ptsIdx),
      status: fa.status,
      days: new Set(out ? [] : ctx.dates.filter((d) => games[d])),
      from: null,
      until: null,
      added: true,
      ir: false,
    });
  }
  const seated = seat(roster, ctx.dates, ctx.slots);
  const baseCats = categoryProbabilities(ctx.league, teamMoments, ctx.oppMoments).reduce(
    (a, b) => a + b,
    0
  );
  return {
    ctx,
    teamMoments,
    roster,
    pool,
    base: seated.started,
    baseCats,
    basePerDay: seated.perDay.map((x) => x.started),
  };
}

const active = (s: Seat, d: string) => (s.from == null || s.from <= d) && (s.until == null || d < s.until);

/** Each day, the best `slots` by value who are on the roster and have a game start. */
function seat(seats: Seat[], dates: string[], slots: number) {
  const started = new Map<string, number>(seats.map((s) => [s.name, 0]));
  const starts = new Map<string, Set<string>>(seats.map((s) => [s.name, new Set()]));
  const perDay = dates.map((d) => {
    const playing = seats.filter((s) => active(s, d) && s.days.has(d));
    if (playing.length > slots) playing.sort((a, b) => b.rank - a.rank);
    const lineup = playing.slice(0, slots);
    for (const s of lineup) {
      started.set(s.name, (started.get(s.name) ?? 0) + 1);
      starts.get(s.name)!.add(d);
    }
    return { date: d, playing: playing.length, started: lineup.length };
  });
  return { started, starts, perDay };
}

/** Apply a plan's moves, in date order, to fresh copies of the roster. */
function applyMoves(prep: PreparedPlan, moves: PlannedMove[]) {
  const { ctx } = prep;
  const seats = prep.roster.map((s) => ({ ...s }));
  const byName = new Map(seats.map((s) => [s.name, s]));
  const invalid = new Map<string, string>();
  const applied: PlannedMove[] = [];
  const dateSet = new Set(ctx.dates);
  let open = ctx.openSpots;
  // Stable by date: two moves on one day keep the order they were entered in.
  const ordered = moves
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (a.m.date < b.m.date ? -1 : a.m.date > b.m.date ? 1 : a.i - b.i))
    .map((x) => x.m);
  for (const m of ordered) {
    if (!dateSet.has(m.date)) {
      invalid.set(m.id, "That day has passed or is locked");
      continue;
    }
    const target = isAdd(m) ? null : byName.get(m.add);
    if (!isAdd(m) && (!target || !target.ir || target.from !== INACTIVE)) {
      invalid.set(m.id, `${m.add} is not on IR - already activated?`);
      continue;
    }
    const fa = prep.pool.get(m.add);
    if (isAdd(m) && !fa) {
      invalid.set(m.id, `${m.add} is not available — already rostered?`);
      continue;
    }
    if (isAdd(m) && byName.has(m.add)) {
      invalid.set(m.id, `${m.add} is already in the plan`);
      continue;
    }
    if (m.drop == null) {
      if (open <= 0) {
        invalid.set(m.id, "No open roster spot — pick someone to drop");
        continue;
      }
      open -= 1;
    } else {
      const d = byName.get(m.drop);
      // On the roster that day: added strictly before it, not already dropped.
      if (!d || d.until != null || (d.from != null && d.from >= m.date)) {
        invalid.set(m.id, `${m.drop} is not on the roster that day`);
        continue;
      }
      d.until = m.date;
    }
    if (target) {
      target.from = m.date;
    } else {
      const seatAdd = { ...fa!, from: m.date };
      seats.push(seatAdd);
      byName.set(seatAdd.name, seatAdd);
    }
    applied.push(m);
  }
  return { seats, invalid, applied };
}

export function evaluatePlan(prep: PreparedPlan, moves: PlannedMove[]): PlanEvaluation {
  const { ctx } = prep;
  const { seats, invalid, applied } = applyMoves(prep, moves);
  const { started, starts, perDay } = seat(seats, ctx.dates, ctx.slots);

  // Only what CHANGED moves the projection: swap each player's whole moments from his
  // no-move started games to the planned ones (the projection-error term is not additive
  // over games — see playerMoments).
  let mine = prep.teamMoments;
  const v = ctx.league.variance;
  const pe = ctx.league.projectionError;
  for (const s of seats) {
    const from = prep.base.get(s.name) ?? 0;
    const to = started.get(s.name) ?? 0;
    if (from === to) continue;
    mine = addMoments(subtractMoments(mine, playerMoments(s.avg, from, v, pe)), playerMoments(s.avg, to, v, pe));
  }
  const expectedCats = categoryProbabilities(ctx.league, mine, ctx.oppMoments).reduce((a, b) => a + b, 0);

  const rows: PlanRow[] = seats.map((s) => ({
    name: s.name,
    nbaTeam: s.nbaTeam,
    value: s.rank,
    status: s.status,
    added: s.added,
    ir: s.ir,
    from: s.from,
    until: s.until,
    playing: new Set(ctx.dates.filter((d) => active(s, d) && s.days.has(d))),
    starts: starts.get(s.name) ?? new Set(),
    baseStarted: prep.base.get(s.name) ?? 0,
  }));

  let total = 0;
  for (const n of started.values()) total += n;
  return {
    rows,
    perDay: perDay.map((x, i) => ({ ...x, baseStarted: prep.basePerDay[i] ?? 0 })),
    started: total,
    baseStarted: prep.basePerDay.reduce((a, b) => a + b, 0),
    expectedCats,
    baseCats: prep.baseCats,
    moments: mine,
    invalid,
    applied,
  };
}

/**
 * One number to maximise. "games" is started games, with expected categories as a
 * tie-break worth less than one game; "cats" is expected categories won.
 */
export function planScore(e: PlanEvaluation, objective: PlanObjective): number {
  return objective === "games" ? e.started + e.expectedCats * 1e-3 : e.expectedCats;
}

export interface OptimizeOptions {
  objective: PlanObjective;
  /** Pickups the plan may hold, the ones already in it included. Activations are free. */
  maxMoves: number;
  /** Roster players never dropped. Pickups from the plan are always droppable. */
  protect: Set<string>;
}

let seq = 0;
export const newMoveId = () => `m${Date.now().toString(36)}${(seq++).toString(36)}`;

/**
 * Fill the plan's remaining moves. The moves already in `fixed` are kept as they are
 * (the owner's own picks, or a must-add) and planned around; invalid ones are dropped.
 */
export function optimizePlan(
  prep: PreparedPlan,
  fixed: PlannedMove[],
  opts: OptimizeOptions
): PlannedMove[] {
  const { ctx } = prep;
  const EPS = 1e-6;
  const score = (moves: PlannedMove[]) => {
    const e = evaluatePlan(prep, moves);
    return e.invalid.size ? -Infinity : planScore(e, opts.objective);
  };

  const keep = evaluatePlan(prep, fixed).applied;
  let plan = [...keep];
  let current = score(plan);

  // Every candidate pickup's game days, computed once.
  const candidates = [...prep.pool.values()].filter((s) => s.days.size > 0);
  // After the first full sweep only the most useful pickups are re-searched: a player who
  // could not help on his own rarely becomes the best move later. Keeps a step ~10ms.
  let shortlist: Seat[] = candidates;
  const SHORTLIST = 30;

  /**
   * The best single move to add to `base`: a pickup from `pool` while pickups are left,
   * or an activation of anyone still on IR (those are not limited).
   */
  const irDays = new Map(prep.roster.filter((r) => r.ir).map((r) => [r.name, r.days]));
  const bestMove = (base: PlannedMove[], pool: Seat[], gains?: Map<string, number>) => {
    const e = evaluatePlan(prep, base);
    const used = new Set(e.rows.map((r) => r.name));
    const openLeft = ctx.openSpots - base.filter((m) => m.drop == null).length;
    const addsLeft = opts.maxMoves - base.filter(isAdd).length;
    let best: { move: PlannedMove; score: number } | null = null;
    const tryAll = (name: string, days: Iterable<string>, kind: "add" | "activate") => {
      let top = -Infinity;
      for (const d of days) {
        const drops: (string | null)[] = openLeft > 0 ? [null] : [];
        for (const r of e.rows) {
          const onRoster = (r.from == null || r.from < d) && r.until == null;
          if (onRoster && (r.added || !opts.protect.has(r.name))) drops.push(r.name);
        }
        for (const drop of drops) {
          const move: PlannedMove = { id: "", kind, date: d, add: name, drop };
          const s = score([...base, move]);
          if (s > top) top = s;
          if (!best || s > best.score) best = { move, score: s };
        }
      }
      return top;
    };
    if (addsLeft > 0) {
      for (const fa of pool) {
        if (used.has(fa.name)) continue;
        // Evaluated BEFORE the optional call: `gains?.set(x, f())` skips f() entirely
        // when there is no map, which silently stopped every search after the first.
        const top = tryAll(fa.name, fa.days, "add");
        gains?.set(fa.name, top);
      }
    }
    for (const r of e.rows) {
      if (r.ir && r.from === INACTIVE) tryAll(r.name, irDays.get(r.name) ?? [], "activate");
    }
    return best as { move: PlannedMove; score: number } | null;
  };

  // 1. Greedy.
  for (;;) {
    const gains =
      shortlist === candidates && plan.filter(isAdd).length < opts.maxMoves
        ? new Map<string, number>()
        : undefined;
    const best = bestMove(plan, shortlist, gains);
    if (gains) {
      shortlist = [...candidates]
        .sort((a, b) => (gains.get(b.name) ?? -Infinity) - (gains.get(a.name) ?? -Infinity))
        .slice(0, SHORTLIST);
    }
    if (!best || best.score <= current + EPS) break;
    plan.push({ ...best.move, id: newMoveId() });
    current = best.score;
  }

  // 2. Local search: re-pick each optimiser move with every other move held fixed.
  for (let pass = 0; pass < 2; pass++) {
    let improved = false;
    for (let i = keep.length; i < plan.length; i++) {
      const rest = plan.filter((_, j) => j !== i);
      if (score(rest) === -Infinity) continue; // a later move depends on this one
      const best = bestMove(rest, shortlist);
      if (best && best.score > current + EPS) {
        plan = [...rest.slice(0, i), { ...best.move, id: plan[i].id }, ...rest.slice(i)];
        current = best.score;
        improved = true;
      }
    }
    if (!improved) break;
  }

  return plan.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
