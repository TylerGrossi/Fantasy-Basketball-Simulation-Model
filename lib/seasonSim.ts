/**
 * Season projection for the Draft Recap: the real schedule, week by week, many times.
 *
 * v2 (2026-10-19), rebuilt after v1 gave the projected favourite a 100% playoff chance.
 * v1 modelled only week-to-week luck, which averages out over 19 weeks, so whoever the
 * projections liked best always made it. Two things were missing, and both are now
 * CALIBRATED ON THIS OWNER'S REAL 2025-26 LEAGUE (public/data/league.json periodResults:
 * 10 teams x 19 regular-season weeks of actual category totals):
 *
 * 1. Realistic WEEKLY swings. Real weekly team totals move 17-24% (BLK 32%, DD 39%), and
 *    they move TOGETHER: PTS correlates 0.84 with REB and 0.82 with AST week to week —
 *    mostly games played (a 4-game week lifts everything). So each team-week draws one
 *    shared VOLUME factor (sd 0.168, from those correlations) plus a stat-specific residual
 *    sized so each stat's total CV matches the real one. Shooting percentages swing on their
 *    own (real weekly sd: FG% 2.3, FT% 3.8, 3P% 3.2 points); makes = attempts x drawn %.
 *
 * 2. SEASON-LEVEL uncertainty — what preseason projections cannot know. Each simulated
 *    season redraws, per player, a production multiplier (breakouts and busts) and an
 *    availability (injuries around his projected games), and per team a small in-season
 *    management factor (waivers, streaming, trades). Sized against the real league's
 *    final standings spread (SD 11.6 points of win%) — see SEASON_SIGMAS for why not
 *    all the way to it.
 *
 * The league is H2H each-category: a week is 15 category results; the season record
 * counts them (19 x 15 = 285); the top N by record make the playoffs (H2H_RECORD).
 *
 * Late picks are blended with a replacement-level waiver line by round weight: a dropped
 * flier's games are played by whoever replaces him.
 */

import type { ProjectedLine } from "./projection";

/**
 * Real 2025-26 week-to-week CV per stat (this owner's league), measured from WEEK-OVER-
 * WEEK changes (sd of the difference / sqrt 2). That strips season-long trends — injuries,
 * trades, roster churn — which the model adds separately as season-level uncertainty, so
 * they are not counted twice. (The raw within-team CV was ~5% larger, e.g. PTS 0.178.)
 */
export const REAL_WEEKLY_CV: Record<string, number> = {
  FGM: 0.17, FGA: 0.162, FTM: 0.208, FTA: 0.197, "3PM": 0.197, "3PA": 0.168,
  REB: 0.176, AST: 0.189, STL: 0.227, BLK: 0.295, TO: 0.206, PTS: 0.167, DD: 0.363, TW: 0.211,
};
/** Shared weekly volume swing, from the week-over-week PTS-REB correlation (0.83). */
const VOLUME_SD = 0.156;
/** Real week-over-week SD of team shooting percentages (fractions). */
const PCT_SD: Record<string, number> = { "FG%": 0.0235, "FT%": 0.0363, "3P%": 0.0341 };

/**
 * Season-level uncertainty. player = production multiplier (lognormal sd); games =
 * availability noise (lognormal sd on the games fraction); team = in-season management.
 *
 * Calibrated on the real draft (2026-10-19), playoff % best..worst / standings SD:
 *   weekly swings only            75..31   0.057
 *   0.15 / 0.20 / 0.04 (chosen)    67..34   0.076
 *   0.22 / 0.25 / 0.06             64..38   0.089
 *   0.30 / 0.30 / 0.08             61..40   0.102   (real league: 0.116)
 * NOT tuned all the way to the real 0.116: part of a real season's spread is manager
 * skill that persists all year, which no preseason projection can know; forcing that
 * much randomness flattens every team toward 50%. The chosen setting keeps a strong
 * favourite near 2-in-3, in line with preseason playoff calculators.
 */
export const SEASON_SIGMAS = { player: 0.15, games: 0.2, team: 0.04 };

const STATS = Object.keys(REAL_WEEKLY_CV);
const RATIO: Record<string, [string, string]> = {
  "FG%": ["FGM", "FGA"],
  "FT%": ["FTM", "FTA"],
  "3P%": ["3PM", "3PA"],
};
const GAMES_PER_WEEK = 82 / 25;

/**
 * Bump whenever the model or its result shape changes. app/api/draft/season includes it
 * in its cache key, so a code change can never be answered from a stale cached result
 * (that crashed the Recap once, when results gained catWLow/catWHigh/leaderW).
 */
export const SIM_VERSION = 3;

/**
 * How much a drafted pick counts, by round: flat through round 2, then about -0.075 a
 * round, floored at 0.25. Late picks get dropped, so they count less (owner, 2026-10-19).
 * Shared by the Recap page and app/api/draft/season.
 */
export function roundWeight(round: number): number {
  return Math.max(0.25, Math.min(1, 1 - 0.075 * (round - 2)));
}

export interface SimPlayer {
  line: ProjectedLine;
  /** 0..1: how much of the season this player is "himself" vs a replacement pickup. */
  weight: number;
}

export interface SeasonResult {
  team: number;
  catW: number;
  catL: number;
  catT: number;
  weekW: number;
  weekL: number;
  weekT: number;
  playoffPct: number;
  avgSeed: number;
  catWinPct: Record<string, number>;
  /** 10th / 90th percentile of the team's category wins: the realistic range. */
  catWLow: number;
  catWHigh: number;
  /** Mean category wins of whichever team finished FIRST, across all seasons (same for all). */
  leaderW: number;
}

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

/** The average per-game line of the best undrafted players: who a dropped pick becomes. */
export function replacementLine(undrafted: ProjectedLine[], n = 20): ProjectedLine | null {
  const pool = undrafted.slice(0, n);
  if (!pool.length) return null;
  const proj: Record<string, number> = {};
  for (const s of STATS) proj[s] = pool.reduce((a, l) => a + (l.proj[s] ?? 0), 0) / pool.length;
  const projGp = pool.reduce((a, l) => a + l.projGp, 0) / pool.length;
  return { ...pool[0], name: "Replacement", proj, projGp };
}

export function simulateSeason(
  rosters: Map<number, SimPlayer[]>,
  schedule: { period: number; home: number; away: number }[],
  categories: string[],
  lowerIsBetter: string[],
  replacement: ProjectedLine | null,
  playoffTeams: number,
  sims = 5000,
  seed = 7,
  sigmas = SEASON_SIGMAS
): SeasonResult[] {
  const teams = [...rosters.keys()];
  const lower = new Set(lowerIsBetter);
  const r = rng(seed);
  const gauss = () => {
    const u = Math.max(1e-12, r());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
  };
  // Stat-specific weekly residual, so volume + residual reproduces each real CV.
  const resid: Record<string, number> = {};
  for (const s of STATS) resid[s] = Math.sqrt(Math.max(0, REAL_WEEKLY_CV[s] ** 2 - VOLUME_SD ** 2));

  const acc = new Map(teams.map((t) => [t, { cw: 0, cl: 0, ct: 0, ww: 0, wl: 0, wt: 0, po: 0, seed: 0 }]));
  const catWins = new Map(teams.map((t) => [t, Object.fromEntries(categories.map((c) => [c, 0]))]));
  const games = new Map(teams.map((t) => [t, 0]));
  const winsDist = new Map(teams.map((t) => [t, [] as number[]]));
  let leaderSum = 0;

  for (let i = 0; i < sims; i++) {
    // ---- season draw: each team's weekly MEAN for this simulated season
    const mean = new Map<number, Record<string, number>>();
    const pct = new Map<number, Record<string, number>>();
    for (const t of teams) {
      const mu: Record<string, number> = {};
      for (const s of STATS) mu[s] = 0;
      const add = (l: ProjectedLine, share: number, noisy: boolean) => {
        const prod = noisy ? Math.exp(sigmas.player * gauss() - sigmas.player ** 2 / 2) : 1;
        const avail = noisy
          ? Math.min(1, (l.projGp / 82) * Math.exp(sigmas.games * gauss() - sigmas.games ** 2 / 2))
          : Math.min(1, l.projGp / 82);
        const g = GAMES_PER_WEEK * avail * share;
        if (g <= 0) return;
        for (const s of STATS) mu[s] += g * (l.proj[s] ?? 0) * prod;
      };
      for (const p of rosters.get(t) ?? []) {
        add(p.line, p.weight, true);
        if (replacement && p.weight < 1) add(replacement, 1 - p.weight, false);
      }
      const mgmt = Math.exp(sigmas.team * gauss());
      for (const s of STATS) mu[s] *= mgmt;
      mean.set(t, mu);
      const pc: Record<string, number> = {};
      for (const [c, [m, a]] of Object.entries(RATIO)) pc[c] = mu[a] > 0 ? mu[m] / mu[a] : 0;
      pct.set(t, pc);
    }

    // ---- the weeks
    const draw = (t: number) => {
      const mu = mean.get(t)!;
      const vol = Math.max(0.2, 1 + VOLUME_SD * gauss());
      const w: Record<string, number> = {};
      for (const s of STATS) w[s] = Math.max(0, mu[s] * vol * (1 + resid[s] * gauss()));
      const pc = pct.get(t)!;
      const out: Record<string, number> = { ...w };
      for (const [c, [, a]] of Object.entries(RATIO)) {
        out[c] = w[a] > 0 ? Math.min(1, Math.max(0, pc[c] + PCT_SD[c] * gauss())) : 0;
      }
      return out;
    };
    const rec = new Map(teams.map((t) => [t, { w: 0, l: 0, t: 0, ww: 0, wl: 0, wt: 0 }]));
    for (const m of schedule) {
      const a = rec.get(m.home);
      const b = rec.get(m.away);
      if (!a || !b) continue;
      const wa = draw(m.home);
      const wb = draw(m.away);
      games.set(m.home, games.get(m.home)! + 1);
      games.set(m.away, games.get(m.away)! + 1);
      let aw = 0;
      let bw = 0;
      for (const c of categories) {
        let d = (wa[c] ?? 0) - (wb[c] ?? 0);
        if (lower.has(c)) d = -d;
        if (Math.abs(d) < 1e-9) {
          a.t++;
          b.t++;
        } else if (d > 0) {
          a.w++;
          b.l++;
          aw++;
          catWins.get(m.home)![c]++;
        } else {
          a.l++;
          b.w++;
          bw++;
          catWins.get(m.away)![c]++;
        }
      }
      if (aw > bw) {
        a.ww++;
        b.wl++;
      } else if (bw > aw) {
        a.wl++;
        b.ww++;
      } else {
        a.wt++;
        b.wt++;
      }
    }
    const order = [...teams].sort((x, y) => {
      const rx = rec.get(x)!;
      const ry = rec.get(y)!;
      const px = (rx.w + rx.t / 2) / Math.max(1, rx.w + rx.l + rx.t);
      const py = (ry.w + ry.t / 2) / Math.max(1, ry.w + ry.l + ry.t);
      return py - px || r() - 0.5;
    });
    leaderSum += rec.get(order[0])!.w;
    order.forEach((t, idx) => {
      const x = acc.get(t)!;
      const rr = rec.get(t)!;
      winsDist.get(t)!.push(rr.w);
      x.cw += rr.w;
      x.cl += rr.l;
      x.ct += rr.t;
      x.ww += rr.ww;
      x.wl += rr.wl;
      x.wt += rr.wt;
      x.seed += idx + 1;
      if (idx < playoffTeams) x.po++;
    });
  }
  return teams.map((t) => {
    const x = acc.get(t)!;
    return {
      team: t,
      catW: x.cw / sims,
      catL: x.cl / sims,
      catT: x.ct / sims,
      weekW: x.ww / sims,
      weekL: x.wl / sims,
      weekT: x.wt / sims,
      playoffPct: x.po / sims,
      avgSeed: x.seed / sims,
      catWinPct: Object.fromEntries(categories.map((c) => [c, catWins.get(t)![c] / Math.max(1, games.get(t)!)])),
      ...(() => {
        const d = winsDist.get(t)!.sort((a, b) => a - b);
        const q = (f: number) => d[Math.min(d.length - 1, Math.floor(f * d.length))] ?? 0;
        return { catWLow: q(0.1), catWHigh: q(0.9) };
      })(),
      leaderW: leaderSum / sims,
    };
  });
}

/**
 * Calibration helper: the average within-season SD of final team win% under the given
 * sigmas. The target is the real league's 0.116.
 */
export function standingsSpread(
  rosters: Map<number, SimPlayer[]>,
  schedule: { period: number; home: number; away: number }[],
  categories: string[],
  lowerIsBetter: string[],
  replacement: ProjectedLine | null,
  sigmas = SEASON_SIGMAS,
  sims = 300
): number {
  let total = 0;
  for (let i = 0; i < sims; i++) {
    const res = simulateSeason(rosters, schedule, categories, lowerIsBetter, replacement, 4, 1, 1000 + i, sigmas);
    const wp = res.map((x) => (x.catW + x.catT / 2) / Math.max(1, x.catW + x.catL + x.catT));
    const m = wp.reduce((a, b) => a + b, 0) / wp.length;
    total += Math.sqrt(wp.reduce((a, b) => a + (b - m) ** 2, 0) / wp.length);
  }
  return total / sims;
}
