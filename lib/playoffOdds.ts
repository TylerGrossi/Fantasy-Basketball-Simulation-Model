/**
 * Playoff and championship odds for the rest of the season — fast enough to re-run once
 * per streamer move in the browser, so the Streamers table can say what a pickup does to
 * your chance of making the playoffs and of winning the title (owner, 2026-10-30).
 *
 * The Playoffs page's odds come from the Python export (engine/simulation.py
 * simulate_playoff_probabilities), which needs ESPN's whole league object and runs once a
 * day. This is a lighter model of the same league, used for the CHANGE a move makes:
 *
 *   - every team at full strength: its best STARTERS players (by value) play
 *     GAMES_PER_WEEK games a week, the rest BENCH_GAMES — a bench player fills in on the
 *     nights a starter has no game, he does not play a starter's week;
 *   - each remaining regular-season week, every scheduled matchup is 15 category results,
 *     each a coin weighted by `categoryProbabilities` (the normal model the matchup page
 *     uses), added to the real records — this league is head-to-head EACH category;
 *   - your current week uses the live projection (what has happened plus what is left);
 *   - top PLAYOFF_TEAMS by record make it; 1 v 4 and 2 v 3, then the final, each round two
 *     weeks of games, won by taking more categories;
 *   - each simulated season shifts every team's strength by a random amount (TEAM_SIGMA,
 *     on the log-odds of each category): nobody knows in October who will bust, get hurt
 *     or work the waiver wire. Without it the favourite makes the playoffs every time.
 *
 * COMMON RANDOM NUMBERS. The baseline and every move draw the same random numbers, so the
 * gap between them is the move, not luck — that is what makes a +0.4% readable. Games
 * between OTHER teams do not depend on your roster at all, so they are simulated once,
 * up front, and each run only re-plays your own weeks and the playoffs.
 *
 * The Streamers page shows the Playoffs page's numbers PLUS this model's change, so its
 * baseline always matches that page.
 */

import type { LeagueData, PoolPlayer } from "./league";
import { playerMoments } from "./league";
import { categoryProbabilities, addMoments, type Moments, type StatVector } from "./probability";

export const GAMES_PER_WEEK = 3.5;
const STARTERS = 10;
const BENCH_GAMES = 0.75;
// 4,000: at 2,000 the title change wobbled by about a point on moves that barely touch
// the roster. ~20ms a move, run in batches after paint.
const PLAYOFF_SIMS = 4000;
// Calibrated 2026-10-30 against the export's odds for all 8 teams: 0.35 left the spread
// far too wide (99% vs the export's 95% at the top, 8% vs 21% at the bottom); 0.6 matches
// it within a few points for most teams. Title odds still run high for the favourite —
// only the CHANGE is shown, on top of the export's own number.
const TEAM_SIGMA = 0.6;
const PLAYOFF_TEAMS = 4;

/** One player as the simulation sees him: per-game line and the value that ranks him. */
export interface SimPlayer {
  v: StatVector;
  value: number;
  /** Set on context rosters, so a past move can be undone on a team's current roster. */
  name?: string;
}

/** Everything the simulation needs, built on the server from the export (small). */
export interface SeasonContext {
  /** Team ids, in a fixed order. */
  teamIds: number[];
  /** Real records so far [W, L, T], categories, by team id. */
  records: Record<number, [number, number, number]>;
  /** Every team's roster, by team id. */
  rosters: Record<number, SimPlayer[]>;
  /** Every pool player by name — your live roster may differ from the export's. */
  players: Record<string, SimPlayer>;
  /** Remaining regular-season weeks, from the current one: each a list of [teamA, teamB]. */
  weeks: Array<{ period: number; pairs: Array<[number, number]> }>;
  /** The Playoffs page's numbers for your team, 0-100. */
  baseline: { playoff: number; champ: number } | null;
}

/**
 * Built on the server — the player pool itself never crosses to the client. `names` limits
 * `players` to the ones the page can swap (your live roster and the free agents).
 */
export function buildSeasonContext(
  league: LeagueData,
  myTeamId: number,
  names?: Iterable<string>
): SeasonContext | null {
  const pool: PoolPlayer[] = league.seasonData.playerPool ?? [];
  const schedules = league.seasonData.schedules ?? {};
  const rsWeeks = league.regularSeasonWeeks ?? 0;
  if (!pool.length || !rsWeeks || league.seasonOver) return null;

  const idByName = new Map(league.teams.map((t) => [t.name, t.id]));
  const round = (x: number) => Math.round(x * 1000) / 1000;
  const sim = (p: PoolPlayer): SimPlayer => ({
    v: league.stats.map((s) => round(Number((p as unknown as Record<string, unknown>)[s] ?? 0) || 0)),
    value: round(p.value ?? 0),
    name: p.name,
  });

  const rosters: Record<number, SimPlayer[]> = {};
  const players: Record<string, SimPlayer> = {};
  for (const t of league.teams) rosters[t.id] = [];
  const wanted = names ? new Set(names) : null;
  for (const p of pool) {
    const s = sim(p);
    if (!wanted || wanted.has(p.name)) players[p.name] = s;
    const id = idByName.get(p.owner);
    if (id != null) rosters[id].push(s);
  }

  // "@ Matt's Magnificent Team (9-6-0)" -> the team's id.
  const oppId = (s: string) =>
    idByName.get(s.replace(/^@\s*/, "").replace(/\s*\([^)]*\)\s*$/, "").trim());
  const byPeriod = new Map<number, Array<[number, number]>>();
  for (const [tid, rows] of Object.entries(schedules)) {
    const a = Number(tid);
    for (const r of rows) {
      if (r.period < league.period || r.period > rsWeeks) continue;
      const b = oppId(r.opponent);
      if (b == null || a >= b) continue; // each pair once
      const list = byPeriod.get(r.period) ?? [];
      list.push([a, b]);
      byPeriod.set(r.period, list);
    }
  }
  const weeks = [...byPeriod.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([period, pairs]) => ({ period, pairs }));

  const mine = league.seasonData.playoffOdds?.find((o) => o.teamId === myTeamId);
  return {
    teamIds: league.teams.map((t) => t.id),
    records: Object.fromEntries(
      league.teams.map((t) => [t.id, [t.wins, t.losses, t.ties] as [number, number, number]])
    ),
    rosters,
    players,
    weeks,
    baseline: mine ? { playoff: mine.playoffProb, champ: mine.championshipProb } : null,
  };
}

type Meta = Pick<LeagueData, "stats" | "categories" | "lowerIsBetter" | "variance" | "projectionError">;

/** A team's week: the best STARTERS by value at full games, the bench filling in. */
function teamMoments(meta: Meta, roster: SimPlayer[], weeks: number): Moments {
  let m: Moments = { mu: meta.stats.map(() => 0), var: meta.stats.map(() => 0) };
  const ranked = [...roster].sort((a, b) => b.value - a.value);
  ranked.forEach((p, i) => {
    const g = (i < STARTERS ? GAMES_PER_WEEK : BENCH_GAMES) * weeks;
    m = addMoments(m, playerMoments(p.v, g, meta.variance, meta.projectionError));
  });
  return m;
}

const logit = (p: number) => {
  const q = Math.min(1 - 1e-6, Math.max(1e-6, p));
  return Math.log(q / (1 - q));
};

/** mulberry32: small, fast, seedable — the same seed gives the same draws. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Odds {
  /** 0-100. */
  playoff: number;
  champ: number;
}

/**
 * A reusable simulator for one team's season. `run(roster, thisWeek)` re-plays the season
 * with your roster replaced by `roster` and your current week's category odds by
 * `thisWeek` (null: treat it as a normal week).
 */
export function makeOddsSimulator(meta: Meta, ctx: SeasonContext, myTeamId: number) {
  const ids = ctx.teamIds;
  const n = ids.length;
  const ix = new Map(ids.map((id, i) => [id, i]));
  const me = ix.get(myTeamId);
  if (me == null) return null;
  const C = meta.categories.length;

  const weekM = ids.map((id) => teamMoments(meta, ctx.rosters[id] ?? [], 1));
  const twoM = ids.map((id) => teamMoments(meta, ctx.rosters[id] ?? [], 2));
  const lg = (a: Moments, b: Moments) => Float64Array.from(categoryProbabilities(meta, a, b).map(logit));
  const baseTwo: Float64Array[][] = ids.map((_, a) => ids.map((_, b) => lg(twoM[a], twoM[b])));

  const weeks = ctx.weeks.map((w) => w.pairs.map(([a, b]) => [ix.get(a)!, ix.get(b)!] as const));
  // Each week, your opponent (or -1 on a bye).
  const myOpp = weeks.map((pairs) => {
    const p = pairs.find(([a, b]) => a === me || b === me);
    return p ? (p[0] === me ? p[1] : p[0]) : -1;
  });

  // Uniform on the log-odds scale: win iff draw < logit(p) + shift, with no exp() per coin.
  const draw = (u: number) => Math.log((u || 1e-12) / (1 - u || 1e-12));

  // ---- once: season shocks and every game that does not involve you ----
  const S = PLAYOFF_SIMS;
  const shocks = new Float64Array(S * n);
  const baseW = new Float64Array(S * n);
  const baseL = new Float64Array(S * n);
  {
    const rand = rng(1);
    for (let s = 0; s < S; s++) {
      for (let t = 0; t < n; t++) {
        const u = rand() || 1e-12;
        const v = rand();
        shocks[s * n + t] = TEAM_SIGMA * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        const r = ctx.records[ids[t]] ?? [0, 0, 0];
        baseW[s * n + t] = r[0] + r[2] / 2;
        baseL[s * n + t] = r[1] + r[2] / 2;
      }
    }
    const otherLg = new Map<string, Float64Array>();
    for (let s = 0; s < S; s++) {
      for (const pairs of weeks) {
        for (const [a, b] of pairs) {
          if (a === me || b === me) continue;
          const key = `${a}-${b}`;
          let l = otherLg.get(key);
          if (!l) otherLg.set(key, (l = lg(weekM[a], weekM[b])));
          const d = shocks[s * n + a] - shocks[s * n + b];
          let won = 0;
          for (let c = 0; c < C; c++) if (draw(rand()) < l[c] + d) won++;
          baseW[s * n + a] += won;
          baseL[s * n + a] += C - won;
          baseW[s * n + b] += C - won;
          baseL[s * n + b] += won;
        }
      }
    }
  }

  // Your stream of draws, pre-converted to log-odds once: every run reads the same
  // numbers in the same order, so a run is comparisons, not logarithms.
  const perSim = myOpp.length * C + PLAYOFF_TEAMS + 3 * (C + 1);
  const mine = new Float64Array(S * perSim);
  {
    const rand = rng(2);
    for (let i = 0; i < mine.length; i++) mine[i] = draw(rand());
  }

  return function run(roster: SimPlayer[], thisWeek: number[] | null): Odds {
    const myW = teamMoments(meta, roster, 1);
    const my2 = teamMoments(meta, roster, 2);
    const vsWeek = ids.map((_, b) => (b === me ? null : lg(myW, weekM[b])));
    const two = baseTwo.map((r) => r.slice());
    for (let b = 0; b < n; b++) {
      if (b === me) continue;
      two[me][b] = lg(my2, twoM[b]);
      two[b][me] = lg(twoM[b], my2);
    }
    const now = thisWeek ? Float64Array.from(thisWeek.map(logit)) : null;

    let k = 0;
    const next = () => mine[k++];
    const w = new Float64Array(n);
    const l = new Float64Array(n);
    let playoff = 0;
    let champ = 0;
    const play = (logits: Float64Array, d: number) => {
      let won = 0;
      for (let c = 0; c < C; c++) if (next() < logits[c] + d) won++;
      return won;
    };

    for (let s = 0; s < S; s++) {
      k = s * perSim;
      const sh = (t: number) => shocks[s * n + t];
      for (let t = 0; t < n; t++) {
        w[t] = baseW[s * n + t];
        l[t] = baseL[s * n + t];
      }
      // Your weeks — always C draws each, so every run consumes the same numbers.
      myOpp.forEach((b, wi) => {
        if (b < 0) return;
        const live = wi === 0 && now;
        const won = live ? play(now!, 0) : play(vsWeek[b]!, sh(me) - sh(b));
        w[me] += won;
        l[me] += C - won;
        w[b] += C - won;
        l[b] += won;
      });
      // Standings by win %, ties broken by a fixed-count random draw.
      // (`next()` is a log-odds draw; scaled tiny, it only ever splits exact ties.)
      const order = ids.map((_, t) => ({ t, key: w[t] / Math.max(1, w[t] + l[t]) + next() * 1e-12 }));
      order.sort((x, y) => y.key - x.key);
      const seeds = order.slice(0, PLAYOFF_TEAMS).map((x) => x.t);
      if (seeds.includes(me)) playoff++;

      // Two-week rounds; a 7.5-7.5 split is a coin flip. All three are always played so
      // the draw count never depends on who got in.
      const match = (a: number, b: number) => {
        const won = play(two[a][b], sh(a) - sh(b));
        const coin = next();
        return won * 2 > C || (won * 2 === C && coin < 0) ? a : b;
      };
      const f1 = match(seeds[0], seeds[3]);
      const f2 = match(seeds[1], seeds[2]);
      if (match(f1, f2) === me) champ++;
    }
    return { playoff: (100 * playoff) / S, champ: (100 * champ) / S };
  };
}
