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
 * WHY NOT JUST RANK THIS SEASON'S STATS: because that ranking is wrong in four known,
 * correctable ways, and each one is a step below.
 *
 *   1. FORM      a player's last 30 days carry role information the season average has
 *                already averaged away.
 *   2. SAMPLE    a 14-game line is mostly noise; a 74-game line is mostly signal. They
 *                should not be trusted equally.
 *   3. AGE       identical lines from a 22-year-old and a 34-year-old are not worth the
 *                same thing next season.
 *   4. LUCK      shooting percentages regress hard, and they regress in proportion to
 *                how few attempts they rest on. An 89% free-throw shooter on 40 attempts
 *                is not an 89% free-throw shooter.
 *
 * Plus a fifth thing a per-game ranking ignores entirely: AVAILABILITY. 78 games of a
 * good player beats 52 games of a slightly better one, and games played is itself
 * strongly mean-reverting, so last season's 52 does not project as next season's 52.
 *
 * The pipeline, in order:
 *
 *   season line + last-30 line  ->  blend            (form)
 *                               ->  regress          (sample size)
 *                               ->  age curve        (aging)
 *                               ->  shrink rates     (luck)
 *                               ->  project games    (availability)
 *                               ->  z-score + tiers  (scoring, in `scoreProjections`)
 *
 * The split between this file's two halves matters for the page's payload: `projectPool`
 * is the expensive, fixed part and runs ONCE on the server; `scoreProjections` is the
 * part that has to re-run every time a filter or a punt changes, so it is pure, cheap
 * (~290 players x 14 categories, twice) and runs in the browser. Only the projected
 * lines cross between them.
 */

import type { PoolPlayer } from "./league";
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
/* 1. Form — blending the season with the last 30 days                         */
/* -------------------------------------------------------------------------- */

/**
 * How much weight the last-30 window can take, at most.
 *
 * Deliberately a minority share. The last 30 days is the smaller sample of the two and
 * is the one being used to detect a genuine role change, so it has to be able to move
 * the projection without being able to define it — a hot March cannot outvote a season.
 */
const MAX_RECENT_WEIGHT = 0.35;

/** Last-30 games at which that weight is reached. Below it, weight scales down. */
const RECENT_FULL_GP = 14;

function blendForm(p: PoolPlayer): { line: Line; weight: number } {
  const season: Line = {};
  for (const s of PROJ_STATS) season[s] = Number(p[s as keyof PoolPlayer] ?? 0);

  const l30 = p.last30;
  const l30gp = Number(l30?.gp ?? 0);
  // No last-30 window is NOT a window of zeros — a player who did not play in it has no
  // recent evidence either way, so the season line stands unaltered.
  if (!l30 || l30gp <= 0) return { line: season, weight: 0 };

  const weight = MAX_RECENT_WEIGHT * Math.min(1, l30gp / RECENT_FULL_GP);
  const line: Line = {};
  for (const s of PROJ_STATS) {
    const recent = Number(l30[s] ?? season[s]);
    line[s] = season[s] * (1 - weight) + recent * weight;
  }
  return { line, weight };
}

/* -------------------------------------------------------------------------- */
/* 2. Sample size — regressing a short season toward its position              */
/* -------------------------------------------------------------------------- */

/**
 * Games at which a player's own line and the prior carry equal weight.
 *
 * At k = 12 a 70-game season keeps 85% of itself (the projection is essentially the
 * player), a 30-game season keeps 71%, and a 10-game season keeps 45% — which is about
 * right for a line nobody should believe.
 */
const SAMPLE_K = 12;

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

/** Shrunk rate: `(made + k*prior) / (attempts + k)`, on SEASON TOTALS, not per game. */
function shrinkRate(
  perGameMade: number,
  perGameAtt: number,
  gp: number,
  prior: number,
  k: number
): number {
  const att = perGameAtt * gp;
  const made = perGameMade * gp;
  if (att + k <= 0) return prior;
  return (made + k * prior) / (att + k);
}

/* -------------------------------------------------------------------------- */
/* 5. Availability — projected games played                                    */
/* -------------------------------------------------------------------------- */

/**
 * How much of last season's games-played carries forward.
 *
 * Games played is one of the most mean-reverting quantities in the sport — season to
 * season it correlates only weakly with itself, because most missed time is one-off
 * injury rather than a durable trait. Half weight on the player, half on the field is
 * roughly what that correlation supports; anything more would make one unlucky ankle
 * into a permanent verdict.
 */
const GP_CARRY = 0.5;
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

  /** Per-stat 40th-percentile line for a position group (falling back to the whole pool). */
  const priorLine = (group: string): Line => {
    const peers = (byGroup.get(group) ?? []).length >= 8 ? byGroup.get(group)! : priorSource;
    const out: Line = {};
    for (const s of PROJ_STATS) {
      const vals = peers
        .map((p) => Number(p[s as keyof PoolPlayer] ?? 0))
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

    // 1. form
    const { line: blended, weight: formWeight } = blendForm(p);

    // 2. sample size
    const w = gp / (gp + SAMPLE_K);
    const regressed: Line = {};
    for (const s of PROJ_STATS) regressed[s] = blended[s] * w + prior[s] * (1 - w);

    // 3. age
    const aged: Line = {};
    for (const s of PROJ_STATS) {
      aged[s] = regressed[s] * ageMultiplier(age, exp, FAMILY[s] ?? "scoring");
    }

    // 4. rates. Attempts are projected like any other volume stat; the RATE is shrunk
    //    separately, and makes are then derived from the pair — so FGM, FGA and FG%
    //    can never disagree with each other on the card the way three independently
    //    projected numbers would.
    const projFgPct = shrinkRate(actual.FGM, actual.FGA, gp, rp.fg, RATE_K.fg);
    const projFtPct = shrinkRate(actual.FTM, actual.FTA, gp, rp.ft, RATE_K.ft);
    const projTpPct = shrinkRate(actual["3PM"], actual["3PA"], gp, rp.tp, RATE_K.tp);

    const proj: Line = { ...aged };
    proj.FGM = proj.FGA * projFgPct;
    proj.FTM = proj.FTA * projFtPct;
    proj["3PM"] = proj["3PA"] * projTpPct;
    // Points follow from the shot profile: 2 per field goal, 1 more for a three, 1 per
    // free throw. Verified against the export — the identity holds to rounding — so
    // deriving it is strictly better than projecting points as a fourteenth free
    // parameter that could then contradict the shooting line beside it.
    proj.PTS = 2 * proj.FGM + proj["3PM"] + proj.FTM;

    // 5. games
    const sev = playerStatus(p.status)[1];
    let projGp = GP_CARRY * gp + (1 - GP_CARRY) * fieldGp;
    if (age != null) projGp -= GP_AGE_COST * Math.max(0, age - GP_AGE_FROM);
    if (sev === "out") projGp -= GP_INJURY_COST;
    projGp = Math.round(Math.min(GP_CEIL, Math.max(GP_FLOOR, projGp)));

    // ---- Why it moved ------------------------------------------------------
    if (gp < PRIOR_MIN_GP) drivers.push(`${gp} games — heavily regressed`);
    if (age != null && age < PEAK_START && (exp == null || exp <= 4)) {
      drivers.push(`Age ${age} — growth curve`);
    }
    if (age != null && age > PEAK_END) drivers.push(`Age ${age} — decline curve`);
    if (formWeight > 0.15) {
      const seasonPts = actual.PTS;
      const l30Pts = Number(p.last30?.PTS ?? seasonPts);
      if (Math.abs(l30Pts - seasonPts) >= 2) {
        drivers.push(l30Pts > seasonPts ? "Finished hot (last 30)" : "Faded late (last 30)");
      }
    }
    if (Math.abs(projFtPct - p.ftPct) >= 0.03 && actual.FTA * gp < 150) {
      drivers.push(`FT% regressed to ${(projFtPct * 100).toFixed(0)}%`);
    }
    if (Math.abs(projTpPct - p.tpPct) >= 0.03 && actual["3PA"] * gp < 200) {
      drivers.push(`3P% regressed to ${(projTpPct * 100).toFixed(0)}%`);
    }
    if (projGp - gp >= 8) drivers.push(`Games regress up: ${gp} → ${projGp}`);
    else if (gp - projGp >= 8) drivers.push(`Games regress down: ${gp} → ${projGp}`);

    // Confidence is about the INPUTS, not the ranking: how much of this projection is
    // the player and how much is the prior filling in for a player we barely saw.
    let confidence: Confidence = "med";
    if (gp < PRIOR_MIN_GP || (age != null && age >= 35)) confidence = "low";
    else if (gp >= 55 && age != null && age >= 23 && age <= 31) confidence = "high";

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
