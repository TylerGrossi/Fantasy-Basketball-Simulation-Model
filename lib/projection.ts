/**
 * Next-season projections for the draft board.
 *
 * WHAT THIS IS NOT: a scrape of somebody else's projections. ESPN publishes its own
 * preseason numbers, but they appear in the fantasy API only once the preseason starts —
 * checked against the live endpoint for the upcoming season and the projected split
 * (`statSourceId 1`) simply does not exist yet. So this is a MODEL, built from the data
 * the export already carries, and it should be read as one. Every number on the draft
 * board is an estimate with a stated method, not a fact.
 *
 * THE CENTRAL IDEA: a per-game line is THREE things multiplied together, and a projection
 * has to take them apart before it can put them back.
 *
 *     per-game production  =  production per minute  x  minutes per game
 *     season value         =  per-game production    x  games available
 *
 * Conflating them is what makes a naive ranking wrong. An injured star reads as a worse
 * player instead of an unavailable one. A player whose minutes doubled because the man
 * ahead of him got hurt reads as having improved. A player traded into a bigger role
 * reads as unchanged. All three are the SAME error — attributing a change in opportunity
 * to a change in ability, or vice versa.
 *
 * So the model works in per-36 space, where opportunity has been divided out, and
 * projects minutes and games as their own quantities:
 *
 *   3 seasons of history  ->  per-36 blend       (skill, opportunity removed)
 *                         ->  regress            (sample size, in MINUTES)
 *                         ->  age curve          (aging)
 *                         ->  shrink rates       (shooting luck)
 *                         ->  x projected minutes (role)
 *                         ->  x projected games   (availability)
 *                         ->  z-score + tiers     (scoring, in `scoreProjections`)
 *
 * Three seasons, weighted toward the present. One season is too few to tell a career year
 * from a career; the third season back is mostly there to stop a single outlier — a lost
 * year, a fluke shooting season — from setting the whole projection.
 *
 * WHAT IT STILL CANNOT SEE: the model has box scores, not depth charts. A player whose
 * minutes spiked because a teammate tore an ACL and a player whose minutes spiked because
 * he earned the job look identical in this data. Both are treated as PARTLY persistent —
 * the minutes projection carries most of the current role forward but regresses it toward
 * the player's own multi-year baseline, which is the honest split when you cannot tell the
 * two apart. Confirmed offseason trades and depth-chart moves are not in here at all.
 *
 * ---------------------------------------------------------------------------------------
 * UNFINISHED. The page is hidden from the nav (HIDDEN_FROM_NAV in lib/nav.ts) because the
 * ranking is still wrong in ways an owner spotted immediately. Do not un-hide it until
 * these are addressed. Recorded here so the next pass starts from evidence:
 *
 *   1. STARS WITH LOST SEASONS ARE STILL TOO LOW. The rebuild moved Giannis 51 -> 37 and
 *      Trae Young 75 -> 39, but 37 is still not a defensible draft slot for him, and
 *      Wembanyama (4th) reads low too. Note he is only 2 ranks better on `perGame` than on
 *      `total`, so this is NOT the availability discount — it is the production estimate
 *      or the category scoring. Giannis's real 9-cat profile (65% FT on volume, ~0 threes,
 *      3+ turnovers) genuinely punishes him, so check whether the z-scoring is
 *      over-weighting the ratio categories before touching the projection itself.
 *
 *   2. YOUNG PLAYERS ON THIN SAMPLES ARE TOO HIGH. Kon Knueppel ranked 10th. The likely
 *      cause is compounding: the age GROWTH multiplier and the per-36 extrapolation both
 *      reward a young player with limited minutes, and nothing caps their product. A
 *      per-36 rate from a bench role does not survive a starter's minutes, which is
 *      exactly what the model currently assumes when it multiplies one by the other.
 *
 *   3. TIERS ARE DEGENERATE. Measured on the live board: 23 tiers, seven of them with one
 *      player, the first twelve holding 29 players between them, then a wall of tiers of
 *      exactly TIER_MAX, then a single tier of 140. The cause is in `assignTiers` — the
 *      threshold is `mean + TIER_SIGMA * sd` over ALL gaps in the top 160, and the top of
 *      the board has gaps far larger than the middle, so nearly every early gap clears it
 *      and nearly no later one does. It needs a LOCAL scale (a rolling median of nearby
 *      gaps) and a minimum tier size, not a different sigma.
 * ---------------------------------------------------------------------------------------
 *
 * The split between this file's two halves matters for the page's payload: `projectPool`
 * is the expensive, fixed part and runs ONCE on the server; `scoreProjections` is the
 * part that has to re-run every time a filter or a punt changes, so it is pure, cheap
 * (~290 players x 14 categories, twice) and runs in the browser. Only the projected
 * lines cross between them.
 */

import type { PoolPlayer, SeasonLine } from "./league";
import { playerStatus } from "./playerPool";

/* -------------------------------------------------------------------------- */
/* Shapes                                                                      */
/* -------------------------------------------------------------------------- */

/** The counting stats a projected line carries, in export order. */
export const PROJ_STATS = [
  "FGM", "FGA", "FTM", "FTA", "3PM", "3PA",
  "REB", "AST", "STL", "BLK", "TO", "DD", "PTS",
] as const;

export type ProjStat = (typeof PROJ_STATS)[number];
export type Line = Record<string, number>;

/** One player's projection: the per-game line, the games, and why it moved. */
export interface ProjectedLine {
  name: string;
  nbaTeam: string;
  position: string;
  eligibleSlots: string[];
  owner: string;
  status: string;
  playerId: number | null;
  age: number | null;
  exp: number | null;
  /** Games played THIS season — the sample the projection rests on. */
  gp: number;
  /** Games projected for NEXT season. */
  projGp: number;
  /** Projected per-game line. Makes are derived from attempts x shrunk rate. */
  proj: Line;
  /** This season's actual per-game line, for the side-by-side delta. */
  actual: Line;
  projFgPct: number;
  projFtPct: number;
  projTpPct: number;
  fgPct: number;
  ftPct: number;
  tpPct: number;
  /** Short phrases naming what moved this projection off the raw season line. */
  drivers: string[];
  confidence: Confidence;
}

export type Confidence = "high" | "med" | "low";

/** A scored, ranked, tiered row — what the board renders. */
export interface DraftRow extends ProjectedLine {
  rank: number;
  tier: number;
  /** Per-category z-scores against the draftable pool. Punting drops terms from the sum. */
  z: Record<string, number>;
  /** Sum of z over the active categories: value per game played. */
  perGame: number;
  /** Per-game value scaled by durability. Same units, so they are comparable. */
  total: number;
  /** The same z-sum computed from this season's ACTUAL line — the projection's delta. */
  actualValue: number;
}

/* -------------------------------------------------------------------------- */
/* 1. Multi-year blend — per-36 production across up to three seasons          */
/* -------------------------------------------------------------------------- */

/**
 * Season weights, newest first. Heavily current, but not only current.
 *
 * The current season has to lead — it is the most recent evidence of what a player is and
 * of the role he holds. But at 100% weight one lost season rewrites a career, which is
 * exactly the Giannis case: 36 games at reduced minutes does not turn a 30-point player
 * into a 27-point player, it turns him into a 30-point player who was hurt.
 */
const SEASON_WEIGHT = [0.6, 0.25, 0.15];

/**
 * Games at which a season reaches half its nominal weight.
 *
 * Applied ON TOP of the season weights, so a 20-game season contributes less than an
 * 80-game one at the same recency. This is the ONLY place a short season is discounted —
 * it lowers that season's vote, and never the player's projected rate. Availability is a
 * separate quantity, projected separately, further down.
 */
const SEASON_CRED_K = 20;

/** Minutes are per-36; a player below this in a season has no meaningful rate to take. */
const MIN_FLOOR = 4;

/** One season converted to per-36. Returns null when there are no minutes to divide by. */
function per36(s: SeasonLine): Line | null {
  if (!s.min || s.min < MIN_FLOOR) return null;
  const k = 36 / s.min;
  const out: Line = {};
  for (const stat of PROJ_STATS) out[stat] = Number(s[stat as keyof SeasonLine] ?? 0) * k;
  return out;
}

interface Blend {
  /** Weighted per-36 line across the seasons that had usable minutes. */
  line: Line;
  /** Total minutes behind it — the sample the regression below is sized against. */
  minutes: number;
  /**
   * The player's established role, in minutes per game, from the seasons BEFORE this one.
   *
   * Deliberately excludes the current season. This is the number the current role is
   * regressed toward, and a regression target computed from the thing being regressed is
   * no target at all — with the current season included, an injured player's reduced
   * minutes were most of their own baseline and barely pulled back at all.
   */
  priorMin: number;
  /** Games behind the current season, for weighting how much its role signal is worth. */
  currentGp: number;
  seasons: number;
}

/**
 * Blend a player's history into one per-36 line, plus the sample and role behind it.
 *
 * DD is the one stat ESPN's career feed does not publish, so it is carried from the
 * current season alone by the caller — a projected double-double rate built from two
 * seasons of data and one of guesswork would be worse than one honest season.
 */
function blendHistory(history: SeasonLine[]): Blend | null {
  let wsum = 0;
  let minutes = 0;
  let seasons = 0;
  // Prior-season role, weighted only by how much each season was played.
  let priorNum = 0;
  let priorDen = 0;
  const acc: Line = {};
  for (const stat of PROJ_STATS) acc[stat] = 0;

  const used = history.slice(0, SEASON_WEIGHT.length);
  used.forEach((s, i) => {
    const rate = per36(s);
    if (!rate || s.gp <= 0) return;
    const cred = s.gp / (s.gp + SEASON_CRED_K);
    const w = SEASON_WEIGHT[i] * cred;
    if (w <= 0) return;
    for (const stat of PROJ_STATS) acc[stat] += rate[stat] * w;
    minutes += s.min * s.gp;
    wsum += w;
    seasons++;
    if (i > 0) {
      priorNum += s.min * cred;
      priorDen += cred;
    }
  });

  if (!wsum || !seasons) return null;
  const line: Line = {};
  for (const stat of PROJ_STATS) line[stat] = acc[stat] / wsum;
  const current = used[0];
  return {
    line,
    minutes,
    // With no earlier season to compare against, the current role IS the baseline and
    // the regression below becomes a no-op — which is the right answer for a rookie.
    priorMin: priorDen > 0 ? priorNum / priorDen : Number(current?.min ?? 0),
    currentGp: Number(current?.gp ?? 0),
    seasons,
  };
}

/* -------------------------------------------------------------------------- */
/* 2. Sample size — regressing a thin history toward its position              */
/* -------------------------------------------------------------------------- */

/**
 * MINUTES at which a player's own rate and the prior carry equal weight.
 *
 * Minutes, not games, because the sample that determines a per-36 rate is time on court:
 * 30 games at 34 minutes is a real sample and 30 games at 9 minutes is not, and a
 * games-based rule cannot tell them apart. ~1200 is around a third of a full season's
 * minutes, so a healthy starter clears it in one year and a deep-bench player never quite
 * does across three.
 */
const SAMPLE_MIN_K = 1200;

/**
 * The prior a short season is pulled toward: the 40th percentile of the player's own
 * position group, stat by stat.
 *
 * NOT the positional MEAN, and the difference is the whole point. Regressing toward the
 * mean would take a 10-game nobody and project them as an average NBA starter, floating
 * unknown players up the board on the strength of not being known. The 40th percentile
 * is roughly "fringe rotation regular", which is the honest base rate for a player we
 * have barely seen. Percentiles are taken over established players only (`PRIOR_MIN_GP`),
 * so the priors are not themselves built out of noise.
 */
const PRIOR_PCTILE = 0.4;
const PRIOR_MIN_GP = 20;

/** Guards / wings / bigs — enough resolution for a prior, not so much it runs out of players. */
function positionGroup(p: { position: string; eligibleSlots?: string[] }): "G" | "W" | "B" {
  const slots = p.eligibleSlots?.length ? p.eligibleSlots : [p.position];
  if (slots.some((s) => s === "PG" || s === "SG")) return "G";
  if (slots.some((s) => s === "C")) return "B";
  if (slots.some((s) => s === "PF")) return "B";
  return "W";
}

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/* -------------------------------------------------------------------------- */
/* 3. Age                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Aging is applied per STAT FAMILY, because the parts of a player's game do not decline
 * together. Explosiveness goes first and takes rebounds, blocks and steals with it;
 * shooting and passing hold for years after. A single blanket multiplier would tell you
 * a 34-year-old sharpshooter and a 34-year-old rim-runner are the same bet, and they are
 * emphatically not.
 */
type Family = "athletic" | "scoring" | "skill";

const FAMILY: Record<string, Family> = {
  REB: "athletic", BLK: "athletic", STL: "athletic", DD: "athletic",
  FGA: "scoring", FTA: "scoring", TO: "scoring", PTS: "scoring",
  "3PA": "skill", AST: "skill",
  // Makes are derived from attempts, never aged directly.
  FGM: "scoring", FTM: "scoring", "3PM": "skill",
};

/** Per-year improvement below the peak, and decline above it. */
const GROWTH: Record<Family, number> = { athletic: 0.028, scoring: 0.04, skill: 0.035 };
const DECLINE: Record<Family, number> = { athletic: 0.026, scoring: 0.02, skill: 0.012 };

const PEAK_START = 25;
const PEAK_END = 28;
/** Past this age decline accelerates — the curve is not a straight line at the end. */
const CLIFF_AGE = 33;
const CLIFF_EXTRA = 0.4;

/** Bounds, so no single player's curve can run away from the field. */
const AGE_FLOOR = 0.62;
const AGE_CEIL = 1.3;

/**
 * Growth multiplier for one stat family.
 *
 * Improvement is capped by EXPERIENCE as well as age, which is what separates a
 * 22-year-old rookie from a 22-year-old in their fourth season. The younger-in-career
 * player has the room to grow; the one who has already played 400 games has largely
 * shown you who they are, whatever their birthday says.
 *
 * A missing age means "assume peak" and returns exactly 1 — the projection degrades to
 * an un-aged one for that player rather than guessing a birthday.
 */
export function ageMultiplier(
  age: number | null,
  exp: number | null,
  family: Family
): number {
  if (age == null || age <= 0) return 1;

  if (age < PEAK_START) {
    const byAge = PEAK_START - age;
    const byExp = exp == null ? byAge : Math.max(0, 6 - exp);
    const years = Math.min(5, byAge, byExp);
    return Math.min(AGE_CEIL, 1 + GROWTH[family] * years);
  }
  if (age <= PEAK_END) return 1;

  const years = age - PEAK_END + CLIFF_EXTRA * Math.max(0, age - CLIFF_AGE);
  return Math.max(AGE_FLOOR, 1 - DECLINE[family] * years);
}

/* -------------------------------------------------------------------------- */
/* 4. Shooting percentages — beta-binomial shrinkage                           */
/* -------------------------------------------------------------------------- */

/**
 * Attempts at which a player's own rate and the league prior weigh equally.
 *
 * These are shrinkage constants, not stabilisation points, but they are set near where
 * each rate is conventionally held to stabilise: free-throw percentage settles fastest
 * and is nearly a fixed property of a player, field-goal percentage slowest because it
 * mixes shot selection, role and finishing.
 */
const RATE_K: Record<string, number> = { fg: 240, ft: 55, tp: 120 };

/** Shrunk rate: `(made + k*prior) / (attempts + k)`, on TOTALS, not per game. */
function shrinkTotals(made: number, att: number, prior: number, k: number): number {
  if (att + k <= 0) return prior;
  return (made + k * prior) / (att + k);
}

/* -------------------------------------------------------------------------- */
/* 5. Availability — projected games played                                    */
/* -------------------------------------------------------------------------- */

/**
 * Season weights for AVAILABILITY — flatter than the production weights above.
 *
 * Deliberately not `SEASON_WEIGHT`. Games played is one of the most mean-reverting
 * quantities in the sport: season to season it correlates only weakly with itself,
 * because most missed time is one-off injury rather than a durable trait. Leaning as hard
 * on the current season for games as for production would make one unlucky ankle a
 * permanent verdict — which is the exact complaint this model was rebuilt to answer. A
 * three-year availability record is a far better guide to next year than the last twelve
 * months, and these weights say so.
 */
const GP_SEASON_WEIGHT = [0.45, 0.3, 0.25];

/**
 * How much of that multi-year games record carries forward, against the field's median.
 *
 * Half on the player, half on the field is roughly what the year-over-year correlation
 * supports once the player's own number is already a three-year average.
 */
const GP_CARRY = 0.5;

/* -------------------------------------------------------------------------- */
/* 6. Role — projected minutes per game                                        */
/* -------------------------------------------------------------------------- */

/**
 * How much of the CURRENT season's minutes carry, against the multi-year baseline.
 *
 * This one constant is the whole answer to "his role changed". Minutes are the cleanest
 * role signal in a box score, and the two cases that matter pull in opposite directions:
 *
 *   - A player traded into a bigger job, or who won one, should keep most of the raise.
 *   - A player whose minutes spiked covering an injured teammate should give most of it
 *     back, because the job was never his.
 *
 * Nothing in this data distinguishes them — that would take a depth chart. At 0.65 the
 * current role leads and the multi-year baseline pulls the rest, which splits the
 * difference in the direction of "opportunity is stickier than it looks, but not
 * permanent". A player whose minutes have been flat for three years is unaffected either
 * way, since his current season IS his baseline.
 */
const MIN_CARRY = 0.65;

/**
 * A full season's worth of credibility, used to scale MIN_CARRY down for a short one.
 *
 * An injury-shortened season is weak evidence about a ROLE as well as about production:
 * a star on a minutes restriction over 36 games has not been demoted, and letting those
 * 36 games set next season's minutes was what left Giannis projected at 29 MPG against a
 * 34-35 MPG career. So the current season carries the full MIN_CARRY only when it was
 * actually played; below that, its share falls and the prior-season role takes the rest.
 */
const ROLE_FULL_GP = 70;

/** Bounds on the projected role, so no single season can invent or erase a rotation spot. */
const MIN_CEIL = 38;
const MIN_FLOOR_PROJ = 8;
/** Games lost per year of age past this. Old players miss more, and it compounds. */
const GP_AGE_FROM = 31;
const GP_AGE_COST = 1.4;
/** Currently out/IR: a season-ending injury does carry a little signal into next year. */
const GP_INJURY_COST = 5;
/** Nobody plays 82. Load management is a fact of the modern league, so the ceiling isn't 82. */
const GP_CEIL = 78;
const GP_FLOOR = 20;

/* -------------------------------------------------------------------------- */
/* projectPool — the server-side half                                          */
/* -------------------------------------------------------------------------- */

/**
 * Project every player in the pool. Deterministic and pure; run once on the server.
 *
 * The pool is every rostered player plus the top free agents (~290 for a 10-team
 * league), which is roughly twice the number of players that will actually be drafted —
 * deep enough for a board, and not the whole NBA. Players who never played are dropped:
 * there is nothing here to project them from, and a row of zeros at the bottom of a
 * draft board is noise, not information.
 */
export function projectPool(pool: PoolPlayer[]): ProjectedLine[] {
  const players = pool.filter((p) => Number(p.gp ?? 0) > 0);
  if (!players.length) return [];

  // ---- Priors, built from established players only -------------------------
  const established = players.filter((p) => Number(p.gp ?? 0) >= PRIOR_MIN_GP);
  const priorSource = established.length >= 30 ? established : players;

  const byGroup = new Map<string, PoolPlayer[]>([["G", []], ["W", []], ["B", []]]);
  for (const p of priorSource) byGroup.get(positionGroup(p))!.push(p);

  /**
   * Every player's blended per-36 line, computed once and reused — the priors are built
   * out of these, so they have to exist before the per-player loop runs.
   *
   * A player with no usable history keeps `null` and takes the single-season fallback
   * path below, where minutes are unknown and the projection stays in per-game space.
   */
  const blends = new Map<string, Blend | null>();
  for (const p of players) {
    blends.set(p.name, p.history?.length ? blendHistory(p.history) : null);
  }

  /** Per-stat 40th-percentile PER-36 line for a position group. */
  const priorLine = (group: string): Line => {
    const peers = (byGroup.get(group) ?? []).length >= 8 ? byGroup.get(group)! : priorSource;
    const out: Line = {};
    for (const s of PROJ_STATS) {
      const vals = peers
        .map((p) => blends.get(p.name)?.line[s])
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
        .sort((a, b) => a - b);
      out[s] = percentile(vals, PRIOR_PCTILE);
    }
    return out;
  };
  const priors = new Map<string, Line>(
    ["G", "W", "B"].map((g) => [g, priorLine(g)])
  );

  /** Pooled shooting rate for a group — the prior a player's own rate shrinks toward. */
  const ratePrior = (group: string, made: ProjStat, att: ProjStat): number => {
    const peers = (byGroup.get(group) ?? []).length >= 8 ? byGroup.get(group)! : priorSource;
    let m = 0;
    let a = 0;
    for (const p of peers) {
      const gp = Number(p.gp ?? 0);
      m += Number(p[made as keyof PoolPlayer] ?? 0) * gp;
      a += Number(p[att as keyof PoolPlayer] ?? 0) * gp;
    }
    return a > 0 ? m / a : 0;
  };

  /**
   * A player's shooting over their whole HISTORY, as season totals.
   *
   * The rate shrinkage below is sized by attempts, so feeding it three seasons instead of
   * one roughly triples the sample and shrinks a settled shooter far less. It also stops a
   * 36-game season from dragging a career 65% free-throw shooter toward the league mean on
   * the strength of one interrupted year.
   */
  const careerShooting = (p: PoolPlayer, made: ProjStat, att: ProjStat) => {
    let m = 0;
    let a = 0;
    for (const s of (p.history ?? []).slice(0, SEASON_WEIGHT.length)) {
      m += Number(s[made as keyof SeasonLine] ?? 0) * s.gp;
      a += Number(s[att as keyof SeasonLine] ?? 0) * s.gp;
    }
    if (a <= 0) {
      const gp = Number(p.gp ?? 0);
      m = Number(p[made as keyof PoolPlayer] ?? 0) * gp;
      a = Number(p[att as keyof PoolPlayer] ?? 0) * gp;
    }
    return { made: m, att: a };
  };
  const ratePriors = new Map(
    ["G", "W", "B"].map((g) => [
      g,
      {
        fg: ratePrior(g, "FGM", "FGA"),
        ft: ratePrior(g, "FTM", "FTA"),
        tp: ratePrior(g, "3PM", "3PA"),
      },
    ])
  );

  // The field's durability, from the players actually worth drafting rather than from
  // the whole pool — free agents at the bottom drag the median down with games they
  // missed by being in the G League, which is not the same thing as being fragile.
  const topGp = [...players]
    .sort((a, b) => b.value - a.value)
    .slice(0, 130)
    .map((p) => Number(p.gp ?? 0))
    .sort((a, b) => a - b);
  const fieldGp = percentile(topGp, 0.5) || 60;

  // ---- Project each player -------------------------------------------------
  return players.map((p) => {
    const gp = Number(p.gp ?? 0);
    const age = typeof p.age === "number" ? p.age : null;
    const exp = typeof p.exp === "number" ? p.exp : null;
    const group = positionGroup(p);
    const prior = priors.get(group)!;
    const rp = ratePriors.get(group)!;
    const drivers: string[] = [];

    const actual: Line = {};
    for (const s of PROJ_STATS) actual[s] = Number(p[s as keyof PoolPlayer] ?? 0);

    // 1. multi-year blend, in per-36 space. `null` = no usable minutes anywhere, so the
    //    player falls back to their raw per-game line and a league-typical role.
    const blend = blends.get(p.name) ?? null;
    const currentMin = Number(p.history?.[0]?.min ?? 0);
    const base: Line = blend
      ? blend.line
      : (() => {
          // Fallback: treat the per-game line AS IF it were per-36. It is the same shape
          // of number, and the role multiplier below is 1 for these players, so the
          // projection reduces exactly to the old per-game behaviour.
          const out: Line = {};
          for (const s of PROJ_STATS) out[s] = actual[s];
          return out;
        })();

    // 2. sample size, measured in MINUTES rather than games — see SAMPLE_MIN_K.
    const sampleMin = blend ? blend.minutes : gp * 24;
    const w = sampleMin / (sampleMin + SAMPLE_MIN_K);
    const regressed: Line = {};
    for (const s of PROJ_STATS) regressed[s] = base[s] * w + prior[s] * (1 - w);

    // 3. age
    const aged: Line = {};
    for (const s of PROJ_STATS) {
      aged[s] = regressed[s] * ageMultiplier(age, exp, FAMILY[s] ?? "scoring");
    }

    // 4. role. The current season's minutes lead; the multi-year baseline pulls a spike
    //    (or a dip) part of the way back. See MIN_CARRY for why this is the honest split.
    let projMin = 0;
    if (blend && currentMin >= MIN_FLOOR) {
      // How much this season's role signal is worth, discounted if it was cut short.
      const credFull = ROLE_FULL_GP / (ROLE_FULL_GP + SEASON_CRED_K);
      const credNow = blend.currentGp / (blend.currentGp + SEASON_CRED_K);
      const roleW = MIN_CARRY * Math.min(1, credNow / credFull);
      projMin = roleW * currentMin + (1 - roleW) * blend.priorMin;
      projMin = Math.min(MIN_CEIL, Math.max(MIN_FLOOR_PROJ, projMin));
    }
    // Scale per-36 back to per-game. Without minutes the base line is already per-game.
    const roleScale = blend && projMin > 0 ? projMin / 36 : 1;
    const scaled: Line = {};
    for (const s of PROJ_STATS) scaled[s] = aged[s] * roleScale;

    // 5. rates. Attempts are projected like any other volume stat; the RATE is shrunk
    //    separately over the player's whole history, and makes are then derived from the
    //    pair — so FGM, FGA and FG% can never disagree with each other on the card the
    //    way three independently projected numbers would.
    const fgTot = careerShooting(p, "FGM", "FGA");
    const ftTot = careerShooting(p, "FTM", "FTA");
    const tpTot = careerShooting(p, "3PM", "3PA");
    const projFgPct = shrinkTotals(fgTot.made, fgTot.att, rp.fg, RATE_K.fg);
    const projFtPct = shrinkTotals(ftTot.made, ftTot.att, rp.ft, RATE_K.ft);
    const projTpPct = shrinkTotals(tpTot.made, tpTot.att, rp.tp, RATE_K.tp);

    const proj: Line = { ...scaled };
    proj.FGM = proj.FGA * projFgPct;
    proj.FTM = proj.FTA * projFtPct;
    proj["3PM"] = proj["3PA"] * projTpPct;
    // Double-doubles are the one stat ESPN's career feed omits, so they come from this
    // season alone, scaled by the change in role rather than blended across years.
    proj.DD = actual.DD * (blend && currentMin >= MIN_FLOOR ? projMin / currentMin : 1);
    // Points follow from the shot profile: 2 per field goal, 1 more for a three, 1 per
    // free throw. Verified against the export — the identity holds to rounding — so
    // deriving it is strictly better than projecting points as a fourteenth free
    // parameter that could then contradict the shooting line beside it.
    proj.PTS = 2 * proj.FGM + proj["3PM"] + proj.FTM;

    // 6. availability, from the multi-year games record rather than this season alone.
    //    This is where an injury is finally allowed to matter — and ONLY here. It has
    //    already been kept out of the production rate above, which is the entire point:
    //    a hurt star projects as a healthy star who plays fewer games, not a worse one.
    const gpHistory = (p.history ?? []).slice(0, GP_SEASON_WEIGHT.length);
    let ownGp = gp;
    if (gpHistory.length) {
      let num = 0;
      let den = 0;
      gpHistory.forEach((s, i) => {
        num += s.gp * GP_SEASON_WEIGHT[i];
        den += GP_SEASON_WEIGHT[i];
      });
      ownGp = den > 0 ? num / den : gp;
    }
    const sev = playerStatus(p.status)[1];
    let projGp = GP_CARRY * ownGp + (1 - GP_CARRY) * fieldGp;
    if (age != null) projGp -= GP_AGE_COST * Math.max(0, age - GP_AGE_FROM);
    if (sev === "out") projGp -= GP_INJURY_COST;
    projGp = Math.round(Math.min(GP_CEIL, Math.max(GP_FLOOR, projGp)));

    // ---- Why it moved ------------------------------------------------------
    // Ordered by how much a drafter needs to know it: role first (it moves the line
    // most), then availability, then the slower structural stuff.
    if (blend && projMin > 0 && currentMin >= MIN_FLOOR) {
      const d = projMin - currentMin;
      if (Math.abs(d) >= 1.5) {
        drivers.push(
          `Role ${d > 0 ? "up" : "down"}: ${currentMin.toFixed(1)} → ${projMin.toFixed(1)} MPG`
        );
      }
    }
    if (gp < PRIOR_MIN_GP && projGp - gp >= 10) {
      drivers.push(`Missed ${82 - gp} games — rate kept, availability discounted`);
    } else if (projGp - gp >= 8) drivers.push(`Games regress up: ${gp} → ${projGp}`);
    else if (gp - projGp >= 8) drivers.push(`Games regress down: ${gp} → ${projGp}`);
    if (blend && blend.seasons >= 2) {
      // Only worth saying when the older years actually pulled the line somewhere the
      // current season would not have.
      const cur = p.history?.[0];
      const curRate = cur ? per36(cur) : null;
      if (curRate && Math.abs(blend.line.PTS - curRate.PTS) >= 1.5) {
        drivers.push(
          blend.line.PTS > curRate.PTS
            ? `${blend.seasons}-yr blend lifts a down year`
            : `${blend.seasons}-yr blend cools a career year`
        );
      }
    }
    if (age != null && age < PEAK_START && (exp == null || exp <= 4)) {
      drivers.push(`Age ${age} — growth curve`);
    }
    if (age != null && age > PEAK_END) drivers.push(`Age ${age} — decline curve`);
    if (Math.abs(projFtPct - p.ftPct) >= 0.03 && ftTot.att < 300) {
      drivers.push(`FT% regressed to ${(projFtPct * 100).toFixed(0)}%`);
    }
    if (Math.abs(projTpPct - p.tpPct) >= 0.03 && tpTot.att < 400) {
      drivers.push(`3P% regressed to ${(projTpPct * 100).toFixed(0)}%`);
    }

    // Confidence is about the INPUTS, not the ranking: how much of this projection is
    // the player and how much is the prior filling in for a player we barely saw. Now
    // measured over the whole history, so a star with one lost season is not "low" —
    // three years of minutes is a lot of evidence even when the last one was short.
    let confidence: Confidence = "med";
    const seasons = blend?.seasons ?? 0;
    if (sampleMin < SAMPLE_MIN_K || (age != null && age >= 35)) confidence = "low";
    else if (sampleMin >= 3500 && seasons >= 2 && age != null && age >= 23 && age <= 31) {
      confidence = "high";
    }

    return {
      name: p.name,
      nbaTeam: p.nbaTeam,
      position: p.position,
      eligibleSlots: p.eligibleSlots?.length ? p.eligibleSlots : [p.position].filter(Boolean),
      owner: p.owner,
      status: p.status,
      playerId: p.playerId,
      age,
      exp,
      gp,
      projGp,
      proj,
      actual,
      projFgPct,
      projFtPct,
      projTpPct,
      fgPct: p.fgPct,
      ftPct: p.ftPct,
      tpPct: p.tpPct,
      drivers: drivers.slice(0, 3),
      confidence,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* scoreProjections — the client-side half                                     */
/* -------------------------------------------------------------------------- */

/** A ratio category and the makes/attempts it is derived from. */
const RATIO_OF: Record<string, [ProjStat, ProjStat]> = {
  "FG%": ["FGM", "FGA"],
  "FT%": ["FTM", "FTA"],
  "3P%": ["3PM", "3PA"],
};

/** The conventional nine, offered alongside the league's own scoring categories. */
export const NINE_CAT = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "TO", "FG%", "FT%"];

/**
 * Roster spots in the league — the size of the pool that z-scores are standardised over.
 *
 * Standardising against the WHOLE pool would be a mistake: it measures every player
 * against a field that includes 160 players nobody will draft, which compresses the
 * scale and makes the top of the board look flatter than it is. Two passes — score
 * everyone roughly, keep the top `n`, then re-standardise against those — is the
 * standard player-rater construction and is what makes "+2.4" mean something.
 */
export function draftablePoolSize(teams: number, rosterSize = 13): number {
  return Math.max(60, teams * rosterSize);
}

export interface ScoreOptions {
  /** Categories to score. Punting = leaving them out of this list. */
  categories: string[];
  lowerIsBetter?: string[];
  /** How many players the z-scale is standardised against. */
  poolSize?: number;
  /** Rank by durability-weighted value (the default) or by per-game value. */
  rankBy?: "total" | "perGame";
}

/**
 * Score, rank and tier a set of projections.
 *
 * Pure and fast enough to re-run on every keystroke — which is what makes punting
 * interactive rather than a rebuild. Dropping a category from `categories` removes its
 * term from every player's sum, which is exactly what punting it means: you stop being
 * paid for it, so the players who only ever paid you in that category stop being worth
 * anything to you.
 *
 * One approximation worth naming: the z-scale is re-standardised for the chosen
 * categories, but the draftable set used to standardise it is taken from the full-category
 * ranking. A true punt build would re-derive replacement level under the punt as well.
 * The difference is small and the alternative is a fixed point iteration for a board
 * nobody reads to three decimals.
 */
export function scoreProjections(
  lines: ProjectedLine[],
  opts: ScoreOptions
): DraftRow[] {
  const cats = opts.categories;
  const lower = new Set(opts.lowerIsBetter ?? ["TO"]);
  const rankBy = opts.rankBy ?? "total";
  if (!lines.length || !cats.length) return [];

  const poolSize = Math.min(lines.length, opts.poolSize ?? 130);

  /** Per-category z for every line, standardised against `ref`. */
  const zAll = (ref: ProjectedLine[], src: (l: ProjectedLine) => Line) => {
    const out = lines.map(() => ({}) as Record<string, number>);
    for (const cat of cats) {
      const pair = RATIO_OF[cat];
      let raw: number[];
      let refRaw: number[];

      if (pair) {
        // Volume-weighted IMPACT, not the raw percentage — the same construction the
        // Player Value page uses. A 92% free-throw shooter taking one attempt a game
        // moves nothing, and a raw-percentage z-score would rank them above a 78%
        // shooter taking nine. Impact is (rate - league rate) x attempts.
        const [made, att] = pair;
        let m = 0;
        let a = 0;
        for (const r of ref) {
          m += src(r)[made];
          a += src(r)[att];
        }
        const lg = a > 0 ? m / a : 0;
        const impact = (l: ProjectedLine) => {
          const s = src(l);
          return (s[att] > 0 ? s[made] / s[att] - lg : 0) * s[att];
        };
        raw = lines.map(impact);
        refRaw = ref.map(impact);
      } else {
        raw = lines.map((l) => src(l)[cat] ?? 0);
        refRaw = ref.map((l) => src(l)[cat] ?? 0);
      }

      const mean = refRaw.reduce((a, b) => a + b, 0) / (refRaw.length || 1);
      const sd = Math.sqrt(
        refRaw.reduce((a, b) => a + (b - mean) ** 2, 0) / (refRaw.length || 1)
      );
      const sign = lower.has(cat) ? -1 : 1;
      for (let i = 0; i < lines.length; i++) {
        out[i][cat] = sd > 0 ? (sign * (raw[i] - mean)) / sd : 0;
      }
    }
    return out;
  };

  const sum = (z: Record<string, number>) =>
    cats.reduce((a, c) => a + (z[c] ?? 0), 0);

  // Pass 1: rough ranking against everyone, only to find the draftable set.
  const rough = zAll(lines, (l) => l.proj);
  const order = lines
    .map((_, i) => i)
    .sort((a, b) => sum(rough[b]) - sum(rough[a]));
  const draftable = order.slice(0, poolSize).map((i) => lines[i]);

  // Pass 2: the numbers that get shown, standardised against that set.
  const z = zAll(draftable, (l) => l.proj);
  // The same scale applied to this season's actual line, so the board can show what the
  // projection CHANGED. Scored against the projected draftable set on purpose: two
  // numbers on different scales could not be subtracted.
  const zActual = zAll(draftable, (l) => l.actual);

  /**
   * Durability scaling. Expressed relative to the median draftable player's games, so
   * `total` and `perGame` share units — a player with league-typical availability scores
   * the same either way, and the number stays readable as "z-scores per game".
   */
  const gps = draftable.map((l) => l.projGp).sort((a, b) => a - b);
  const refGp = percentile(gps, 0.5) || 65;

  const rows: DraftRow[] = lines.map((l, i) => {
    const perGame = sum(z[i]);
    return {
      ...l,
      rank: 0,
      tier: 0,
      z: z[i],
      perGame,
      total: perGame * (l.projGp / refGp),
      actualValue: sum(zActual[i]),
    };
  });

  const metric = (r: DraftRow) => (rankBy === "total" ? r.total : r.perGame);
  rows.sort((a, b) => metric(b) - metric(a));
  rows.forEach((r, i) => (r.rank = i + 1));
  assignTiers(rows, metric);
  return rows;
}

/* -------------------------------------------------------------------------- */
/* Tiers                                                                       */
/* -------------------------------------------------------------------------- */

/** How far down the board tiers are drawn. Past this it is all one undifferentiated tail. */
const TIER_DEPTH = 160;
/** A gap this many standard deviations above the typical gap starts a new tier. */
const TIER_SIGMA = 1.1;
/** No tier runs longer than this, however smooth the curve is through it. */
const TIER_MAX = 12;

/**
 * Cut the ranked board into tiers at its natural gaps.
 *
 * The point of a tier is a decision rule: inside one, take the player who fits your
 * roster; at the edge of one, reach. So the breaks have to fall where the value curve
 * actually steps down, not every n players. A gap counts as a step when it is
 * `TIER_SIGMA` standard deviations above the typical gap in this region of the board —
 * which adapts to the shape of the curve rather than imposing a fixed threshold on it,
 * and matters because the top of a board is steep and the middle is nearly flat.
 *
 * The length cap is a concession to usability, not to the statistics: a "tier" of forty
 * players is a list, and it tells you nothing.
 */
function assignTiers(rows: DraftRow[], metric: (r: DraftRow) => number): void {
  const depth = Math.min(rows.length, TIER_DEPTH);
  const gaps: number[] = [];
  for (let i = 0; i < depth - 1; i++) gaps.push(metric(rows[i]) - metric(rows[i + 1]));

  const mean = gaps.reduce((a, b) => a + b, 0) / (gaps.length || 1);
  const sd = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / (gaps.length || 1));
  const threshold = mean + TIER_SIGMA * sd;

  let tier = 1;
  let size = 0;
  for (let i = 0; i < rows.length; i++) {
    rows[i].tier = tier;
    size++;
    if (i >= depth - 1) continue;
    const gap = metric(rows[i]) - metric(rows[i + 1]);
    if (gap > threshold || size >= TIER_MAX) {
      tier++;
      size = 0;
    }
  }
}
