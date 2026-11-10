/**
 * THE season engine (2026-11-09): playoff, seed and title odds, projected records and
 * every unplayed week's win chance. One implementation, run in two places:
 *
 *   - the export's Node step (scripts/node/season.ts) writes the Playoffs page's table and
 *     Schedule's future weeks (`seasonData.playoffOdds`);
 *   - the browser re-runs it per move for Streamers' and Recent Moves' playoff/title change.
 *
 * Before this there were two engines with different inputs (a Python Monte Carlo that
 * spread each team-week by the per-GAME noise - every future week ~50% - and a lighter
 * TypeScript one assuming 3.5 games a week for everyone), and the pages disagreed.
 *
 * THE MODEL, each part shared with the live gauge:
 *   - a team's week (or two-week playoff round) = the sum of playerMoments over its players
 *     at their COUNTED games: each player's injury-aware game days that week (real NBA
 *     schedules, engine/simulation.py season_inputs), with the export's two caps applied
 *     HERE (`countedGames`) - the 13 active spots by value, idle players last, then at most
 *     10 starters a day by value. Applying them here is what lets a pickup compete for a
 *     spot like everyone else (with the caps baked into exported counts, a streamer played
 *     as a 14th man in weeks his drop had been capped out of: +24 title points for one move);
 *   - this week = the gauge's own sides (lib/gaugeSides.ts), banked totals included;
 *   - a matchup's per-category odds = categoryProbabilities (the gauge's normal model,
 *     made/attempted correlated), the categories drawn JOINTLY through the gauge's Gaussian
 *     copula on the measured category correlation;
 *   - each simulated season shifts every team's strength once, for the whole season, by
 *     N(0, teamSigma) on the probit of every category: a team's true level for the rest of
 *     the year is not known. teamSigma is MEASURED (scripts/measure_variance.mjs), not tuned;
 *   - standings by win % (this league counts every category), ties by all-play strength;
 *     top 4, seeded 1v4 / 2v3, each round two weeks, more categories wins.
 *
 * COMMON RANDOM NUMBERS. Every random draw is fixed by (simulation, slot): the season
 * shifts per team and the correlated category draws per matchup slot. So two runs that
 * differ only by one roster move see the same luck, and the gap between them IS the move.
 */

import type { LeagueData, PlayoffOddsRow } from "./league";
import { playerMoments, weekTerm } from "./league";
import {
  addMoments,
  categoryProbabilities,
  choleskyFactor,
  normalQuantile,
  type Moments,
  type StatVector,
} from "./probability";

/**
 * Measured season-long team-strength spread (probit units per category) - mirrors
 * engine/config.py SEASON_TEAM_SIGMA for an export that predates `teamSigma`.
 */
export const DEFAULT_TEAM_SIGMA = 0.32;

export interface SeasonPlayer {
  name: string;
  nbaTeam: string;
  /** Projected per-game line, `stats` order. */
  avg: number[];
  /** League value: what the roster and daily caps rank by. */
  value: number;
  /** Matchup period (string) -> his game days that week (offsets from its first day). */
  days: Record<string, number[]>;
}

export interface SeasonTeam {
  id: number;
  /** Real record so far [W, L, T], categories. */
  record: [number, number, number];
  /** All-play win share: the standings tie-break. */
  strength: number;
  players: SeasonPlayer[];
}

export interface SeasonBracket {
  /** 0 = semifinals in progress, 1 = final. */
  roundIdx: number;
  seeds: number[];
  pairs: Array<[number, number]>;
  finalists: number[] | null;
}

/** engine/simulation.py season_inputs, verbatim. */
export interface SeasonInputs {
  currentWeek: number;
  regularSeasonWeeks: number;
  playoffTeams: number;
  /** [[semis w1, w2], [final w1, w2]]. */
  playoffWeeks: number[][];
  /** Active roster spots (13) and starting slots per day (10). */
  rosterCap: number;
  dailyCap: number;
  teams: SeasonTeam[];
  /** Remaining regular-season weeks, the current one first. */
  schedule: Array<{ period: number; pairs: Array<[number, number]> }>;
  /** Matchup period -> NBA team -> game days that week (for a pickup's weeks). */
  nbaWeekDays: Record<string, Record<string, number[]>>;
  bracket: SeasonBracket | null;
}

export type SeasonMeta = Pick<
  LeagueData,
  "stats" | "categories" | "lowerIsBetter" | "variance" | "projectionError" | "categoryCorrelation" | "shotCorrelation" | "teamSigma" | "weekUncertainty"
>;

/** A roster change for one team: players out, players in (with their weeks' games). */
export interface RosterChange {
  teamId: number;
  drop?: string[];
  add?: SeasonPlayer[];
}

export interface RunOptions {
  /** This week's moments per team (banked + rest): the gauge's sides. */
  current?: Record<number, Moments>;
  changes?: RosterChange[];
  /** Also collect per-week score distributions (the table; slower). */
  weeks?: boolean;
}

export interface TeamOdds {
  /** 0-100. */
  playoff: number;
  advance: number;
  champ: number;
  /** Seed 1..playoffTeams then "no_playoffs", 0-100. */
  seeds: Record<string, number>;
  projRecord: [number, number, number];
  projWeeks: Record<string, { score: [number, number]; win: number; tie: number }>;
}

/**
 * A pickup as the engine sees him: his NBA team's game days each week from `fromWeek` on
 * (this week comes from the gauge's sides, so it is left out), ranked by `value` - which
 * must be on the export's scale (free agents' and rostered players' `value` are; both are
 * scored against every rostered line).
 */
export function pickupPlayer(
  inputs: SeasonInputs,
  p: { name: string; nbaTeam: string; avg: number[]; value: number },
  fromWeek: number
): SeasonPlayer {
  const days: Record<string, number[]> = {};
  for (const [w, teams] of Object.entries(inputs.nbaWeekDays)) {
    if (Number(w) < fromWeek) continue;
    const d = teams[p.nbaTeam];
    if (d?.length) days[w] = d;
  }
  return { name: p.name, nbaTeam: p.nbaTeam, avg: p.avg, value: p.value, days };
}

/**
 * The games each player COUNTS for in one week, by the export's own rules
 * (engine/data.py `_roster_for_projection_caps` then `_accumulate_counted_games_by_day`):
 * more players than `rosterCap` -> keep the top by value, players with no game that week
 * last, ties by name; then each day at most `dailyCap` of the kept players with a game,
 * best value first.
 */
export function countedGames(
  players: SeasonPlayer[],
  week: number,
  rosterCap: number,
  dailyCap: number
): Map<SeasonPlayer, number> {
  const key = String(week);
  const idle = (p: SeasonPlayer) => (p.days[key]?.length ? 0 : 1);
  const byRank = (a: SeasonPlayer, b: SeasonPlayer) =>
    b.value - a.value || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  const kept =
    players.length > rosterCap ? [...players].sort((a, b) => idle(a) - idle(b) || byRank(a, b)).slice(0, rosterCap) : players;
  const byDay = new Map<number, SeasonPlayer[]>();
  for (const p of kept) {
    for (const d of p.days[key] ?? []) {
      const list = byDay.get(d);
      if (list) list.push(p);
      else byDay.set(d, [p]);
    }
  }
  const out = new Map<SeasonPlayer, number>();
  for (const list of byDay.values()) {
    const starters = list.length > dailyCap ? [...list].sort(byRank).slice(0, dailyCap) : list;
    for (const p of starters) out.set(p, (out.get(p) ?? 0) + 1);
  }
  return out;
}

/** mulberry32 from a 32-bit seed. */
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
const hash = (a: number, b: number) => (Math.imul(a, 0x9e3779b1) ^ Math.imul(b + 0x7f4a7c15, 0x85ebca77)) >>> 0;
function gaussFrom(rand: () => number) {
  let u = 0;
  while (!u) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/**
 * Build an engine for one league state. `sims` simulated seasons; the draws are cached so
 * each `run` is comparisons only (~10ms at 4,000 sims in the browser).
 */
export function makeSeasonEngine(meta: SeasonMeta, inputs: SeasonInputs, sims = 4000) {
  const ids = inputs.teams.map((t) => t.id);
  const n = ids.length;
  const ix = new Map(ids.map((id, i) => [id, i]));
  const C = meta.categories.length;
  const lower = meta.categories.map((c) => meta.lowerIsBetter.includes(c));
  const sigma = meta.teamSigma ?? DEFAULT_TEAM_SIGMA;
  const rs = inputs.regularSeasonWeeks;
  const inPlayoffs = inputs.currentWeek > rs;
  const P = inputs.playoffTeams;
  const weeks = inPlayoffs ? [] : inputs.schedule.filter((w) => w.period >= inputs.currentWeek && w.period <= rs);

  // Slots: every regular-season pair, then the three bracket games (semi 1v4, semi 2v3, final).
  const slotOf: number[][] = [];
  let slots = 0;
  for (const w of weeks) slotOf.push(w.pairs.map(() => slots++));
  const BR = slots;
  slots += 3;

  // ---- fixed draws: correlated category normals per (sim, slot), season shifts per team ----
  const corr = meta.categoryCorrelation && meta.categoryCorrelation.length === C ? meta.categoryCorrelation : null;
  const L = corr ? choleskyFactor(corr) : null;
  const Z = new Float32Array(sims * slots * C);
  const shift = new Float64Array(sims * n);
  {
    const e = new Float64Array(C);
    for (let s = 0; s < sims; s++) {
      const rs2 = rng(hash(s, 0xabcdef));
      for (let t = 0; t < n; t++) shift[s * n + t] = sigma * gaussFrom(rs2);
      for (let k = 0; k < slots; k++) {
        const r = rng(hash(s, k + 1));
        for (let c = 0; c < C; c++) e[c] = gaussFrom(r);
        const base = (s * slots + k) * C;
        for (let i = 0; i < C; i++) {
          let z = 0;
          if (L) for (let j = 0; j <= i; j++) z += L[i][j] * e[j];
          else z = e[i];
          Z[base + i] = z;
        }
      }
    }
  }

  const zero = (): Moments => ({ mu: meta.stats.map(() => 0), var: meta.stats.map(() => 0) });
  // A team's moments over weeks `ws` (one week, or a two-week round): each player's
  // counted games summed over the weeks, then ONE playerMoments per player - his
  // projection error is shared by both weeks of a round, so it scales with the total.
  // Plus each week's WEEK term (the gauge's, lib/league.ts weekTerm): a future week is a
  // whole week nobody knows the injuries and moves of yet. Weeks are independent, so a
  // two-week round adds the two weeks' terms.
  const sumWeeks = (players: SeasonPlayer[], ws: number[]): Moments => {
    const g = new Map<SeasonPlayer, number>();
    let wk = meta.stats.map(() => 0);
    for (const w of ws) {
      let week = zero();
      for (const [p, n] of countedGames(players, w, inputs.rosterCap, inputs.dailyCap)) {
        g.set(p, (g.get(p) ?? 0) + n);
        if (n > 0) week = addMoments(week, { mu: p.avg.map((a) => a * n), var: meta.stats.map(() => 0) });
      }
      const t = weekTerm(meta, week.mu);
      wk = wk.map((x, i) => x + t[i]);
    }
    let m = zero();
    for (const [p, n] of g) if (n > 0) m = addMoments(m, playerMoments(p.avg, n, meta.variance, meta.projectionError));
    return { mu: m.mu, var: m.var.map((v, i) => v + wk[i]), wk };
  };
  /**
   * Per category, the threshold in the copula's units: team A wins category c in a draw
   * when sgn_c * z_c < q_c + (shift_A - shift_B), q_c = Phi^-1(P(A wins c)). The same
   * orientation as lib/probability.ts correlatedWins (the correlation is of A-minus-B
   * margins; a lower-is-better category flips the side).
   */
  const thresholds = (a: Moments, b: Moments) =>
    Float64Array.from(categoryProbabilities(meta, a, b).map((p) => normalQuantile(Math.min(1 - 1e-9, Math.max(1e-9, p)))));
  const play = (q: Float64Array, s: number, slot: number, d: number) => {
    const base = (s * slots + slot) * C;
    let won = 0;
    for (let c = 0; c < C; c++) {
      const z = Z[base + c];
      won += +((lower[c] ? z : -z) < q[c] + d);
    }
    return won;
  };

  // Each team's week and playoff-round moments on its exported roster, built once; a run
  // rebuilds only the teams its changes touch.
  const baseWeek = inputs.teams.map((t) => new Map(weeks.map((w) => [w.period, sumWeeks(t.players, [w.period])])));
  const baseRound = [0, 1].map((r) => inputs.teams.map((t) => sumWeeks(t.players, inputs.playoffWeeks[r] ?? [])));

  function run(opts: RunOptions = {}): Map<number, TeamOdds> {
    // Rosters with the changes applied.
    const players = inputs.teams.map((t) => t.players);
    const changed = new Set<number>();
    for (const ch of opts.changes ?? []) {
      const i = ix.get(ch.teamId);
      if (i == null) continue;
      const out = new Set(ch.drop ?? []);
      players[i] = [...players[i].filter((p) => !out.has(p.name)), ...(ch.add ?? [])];
      changed.add(i);
    }
    const cur = opts.current ?? {};
    const weekM = (t: number, w: number) =>
      w === inputs.currentWeek && cur[ids[t]]
        ? cur[ids[t]]
        : changed.has(t)
          ? sumWeeks(players[t], [w])
          : (baseWeek[t].get(w) ?? sumWeeks(players[t], [w]));
    // Regular-season thresholds per slot.
    const qSlot: Array<{ a: number; b: number; q: Float64Array; week: number }> = [];
    weeks.forEach((w) => {
      for (const [ha, hb] of w.pairs) {
        const a = ix.get(ha)!;
        const b = ix.get(hb)!;
        qSlot.push({ a, b, q: thresholds(weekM(a, w.period), weekM(b, w.period)), week: w.period });
      }
    });
    // Playoff rounds: moments per team per round; thresholds per ordered pair, lazily.
    const roundM = [0, 1].map((r) =>
      players.map((ps, t) => (changed.has(t) ? sumWeeks(ps, inputs.playoffWeeks[r] ?? []) : baseRound[r][t]))
    );
    const curRound = inPlayoffs ? (inputs.bracket?.roundIdx ?? 0) : -1;
    const qRound = new Map<string, Float64Array>();
    const roundQ = (r: number, a: number, b: number) => {
      const key = `${r}:${a}:${b}`;
      let q = qRound.get(key);
      if (!q) {
        const useCur = r === curRound && cur[ids[a]] && cur[ids[b]];
        q = thresholds(useCur ? cur[ids[a]] : roundM[r][a], useCur ? cur[ids[b]] : roundM[r][b]);
        qRound.set(key, q);
      }
      return q;
    };

    const playoff = new Float64Array(n);
    const advance = new Float64Array(n);
    const champ = new Float64Array(n);
    const seedCount = Array.from({ length: n }, () => new Float64Array(P + 1));
    const recSum = Array.from({ length: n }, () => [0, 0, 0]);
    const hist = opts.weeks ? new Map<string, Uint32Array>() : null;
    const W = new Float64Array(n);
    const Lr = new Float64Array(n);
    const T = new Float64Array(n);
    const strength = inputs.teams.map((t) => t.strength);

    for (let s = 0; s < sims; s++) {
      for (let t = 0; t < n; t++) {
        const r = inputs.teams[t].record;
        W[t] = r[0];
        Lr[t] = r[1];
        T[t] = r[2];
      }
      const sh = (t: number) => shift[s * n + t];
      for (let k = 0; k < qSlot.length; k++) {
        const { a, b, q, week } = qSlot[k];
        const won = play(q, s, k, sh(a) - sh(b));
        W[a] += won;
        Lr[a] += C - won;
        W[b] += C - won;
        Lr[b] += won;
        if (hist && week !== inputs.currentWeek) {
          for (const [t, w] of [[a, won], [b, C - won]] as const) {
            const key = `${t}:${week}`;
            let h = hist.get(key);
            if (!h) hist.set(key, (h = new Uint32Array(C + 1)));
            h[w]++;
          }
        }
      }
      // Standings: win % (ties half), then all-play strength.
      let seeds: number[];
      if (inPlayoffs && inputs.bracket) {
        seeds = inputs.bracket.seeds.map((id) => ix.get(id)!).filter((x) => x != null);
      } else {
        const order = ids.map((_, t) => t);
        const pct = (t: number) => (W[t] + T[t] / 2) / Math.max(1, W[t] + Lr[t] + T[t]);
        order.sort((x, y) => pct(y) - pct(x) || strength[y] - strength[x]);
        seeds = order.slice(0, P);
        order.forEach((t, rank) => seedCount[t][Math.min(rank, P)]++);
      }
      for (const t of seeds) playoff[t]++;
      for (let t = 0; t < n; t++) {
        recSum[t][0] += W[t];
        recSum[t][1] += Lr[t];
        recSum[t][2] += T[t];
      }

      // Bracket: semis 1v4 and 2v3 (or ESPN's actual pairs once it has started), final.
      const game = (r: number, a: number, b: number, slot: number) =>
        play(roundQ(r, a, b), s, BR + slot, sh(a) - sh(b)) * 2 > C ? a : b;
      let finalists: [number, number];
      if (inPlayoffs && inputs.bracket && curRound === 1 && inputs.bracket.finalists?.length === 2) {
        finalists = [ix.get(inputs.bracket.finalists[0])!, ix.get(inputs.bracket.finalists[1])!];
      } else {
        const pairs: Array<[number, number]> =
          inPlayoffs && inputs.bracket?.pairs.length === 2
            ? inputs.bracket.pairs.map(([h, a]) => [ix.get(h)!, ix.get(a)!] as [number, number])
            : seeds.length >= 4
              ? [
                  [seeds[0], seeds[3]],
                  [seeds[1], seeds[2]],
                ]
              : [];
        if (pairs.length < 2) continue;
        finalists = [game(0, pairs[0][0], pairs[0][1], 0), game(0, pairs[1][0], pairs[1][1], 1)];
      }
      advance[finalists[0]]++;
      advance[finalists[1]]++;
      champ[game(1, finalists[0], finalists[1], 2)]++;
    }

    const out = new Map<number, TeamOdds>();
    for (let t = 0; t < n; t++) {
      const seedsPct: Record<string, number> = {};
      if (!inPlayoffs) {
        for (let k = 0; k < P; k++) seedsPct[String(k + 1)] = (100 * seedCount[t][k]) / sims;
        seedsPct.no_playoffs = (100 * seedCount[t][P]) / sims;
      }
      const projWeeks: TeamOdds["projWeeks"] = {};
      if (hist) {
        for (const w of weeks) {
          const h = hist.get(`${t}:${w.period}`);
          if (!h) continue;
          let total = 0;
          let mode = 0;
          let wins = 0;
          let ties = 0;
          for (let k = 0; k <= C; k++) {
            total += h[k];
            if (h[k] > h[mode]) mode = k;
            if (k * 2 > C) wins += h[k];
            else if (k * 2 === C) ties += h[k];
          }
          if (total) projWeeks[String(w.period)] = { score: [mode, C - mode], win: wins / total, tie: ties / total };
        }
      }
      out.set(ids[t], {
        playoff: (100 * playoff[t]) / sims,
        advance: (100 * advance[t]) / sims,
        champ: (100 * champ[t]) / sims,
        seeds: seedsPct,
        projRecord: recSum[t].map((x) => x / sims) as [number, number, number],
        projWeeks,
      });
    }
    return out;
  }

  return { run, inPlayoffs, ids };
}

/**
 * Everything a browser page needs to re-run the engine (Streamers, Recent Moves), built
 * on the server: the inputs, this week's gauge sides as of the export (the page swaps in
 * its own live sides for its matchup), and the lines of only the players the page can
 * move - never the whole pool.
 */
export interface SeasonPack {
  inputs: SeasonInputs;
  current: Record<string, { current: number[]; projMu: number[]; projVar: number[]; projWk?: number[] }>;
  /** name -> NBA team, per-game line and value, for players not on an exported roster. */
  players: Record<string, { nbaTeam: string; avg: number[]; value: number }>;
  /** The Playoffs page's numbers for this team, 0-100 (the page adds a move's change). */
  baseline: { playoff: number; champ: number } | null;
}

export function buildSeasonPack(league: LeagueData, myTeamId: number, names?: Iterable<string>): SeasonPack | null {
  const inputs = league.seasonData.seasonInputs;
  if (!inputs || league.seasonOver) return null;
  const wanted = names ? new Set(names) : null;
  // Value on the season inputs' scale: the free-agent list's (scored against the same
  // rostered lines), else the pool's.
  const faValue = new Map(league.freeAgents.map((f) => [f.name, f.value]));
  const players: SeasonPack["players"] = {};
  for (const p of league.seasonData.playerPool ?? []) {
    if (wanted && !wanted.has(p.name)) continue;
    const rec = p as unknown as Record<string, unknown>;
    players[p.name] = {
      nbaTeam: p.nbaTeam,
      avg: league.stats.map((s) => Number(rec[s] ?? 0) || 0),
      value: Number(faValue.get(p.name) ?? p.value ?? 0) || 0,
    };
  }
  const mine = league.seasonData.playoffOdds?.find((o) => o.teamId === myTeamId);
  return {
    inputs,
    current: league.seasonData.currentWeekSides ?? {},
    players,
    baseline: mine ? { playoff: mine.playoffProb, champ: mine.championshipProb } : null,
  };
}

/** A pack's this-week sides as moments (banked + rest), by team id. */
export function packCurrent(pack: SeasonPack): Record<number, Moments> {
  const out: Record<number, Moments> = {};
  for (const [id, s] of Object.entries(pack.current)) {
    const wk = s.projWk;
    out[Number(id)] = {
      mu: s.projMu.map((v, i) => v + (s.current[i] ?? 0)),
      var: wk ? s.projVar.map((v, i) => v + (wk[i] ?? 0)) : s.projVar,
      ...(wk ? { wk } : {}),
    };
  }
  return out;
}

/**
 * League-wide NBA games per team-week over the remaining regular season, from the
 * exported schedules - what Streamers charges a drop for each week after this one.
 */
export function gamesPerWeek(inputs: SeasonInputs): number {
  let sum = 0;
  let n = 0;
  for (const w of inputs.schedule) {
    if (w.period <= inputs.currentWeek) continue;
    for (const d of Object.values(inputs.nbaWeekDays[String(w.period)] ?? {})) {
      sum += d.length;
      n++;
    }
  }
  return n ? sum / n : 3.5;
}

/** The Playoffs page's rows, from one full run. */
export function oddsTable(
  league: Pick<LeagueData, "teams">,
  inputs: SeasonInputs,
  odds: Map<number, TeamOdds>
): PlayoffOddsRow[] {
  const name = new Map(league.teams.map((t) => [t.id, t.name]));
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  return inputs.teams.map((t) => {
    const o = odds.get(t.id)!;
    return {
      teamId: t.id,
      teamName: name.get(t.id) ?? String(t.id),
      playoffProb: r3(o.playoff),
      advanceProb: r3(o.advance),
      championshipProb: r3(o.champ),
      inPlayoffs: inputs.currentWeek > inputs.regularSeasonWeeks,
      record: t.record,
      projRecord: o.projRecord.map(r1),
      seedProbs: Object.fromEntries(Object.entries(o.seeds).map(([k, v]) => [k, r3(v)])),
      projWeeks: Object.fromEntries(
        Object.entries(o.projWeeks).map(([w, v]) => [w, { score: v.score, win: Math.round(v.win * 1e4) / 1e4, tie: Math.round(v.tie * 1e4) / 1e4 }])
      ),
    };
  });
}

export type { StatVector };
