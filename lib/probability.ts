/**
 * Head-to-head category probability engine — runs in the browser, no server needed.
 *
 * The whole reason this can live client-side: a team's total for a counting category is
 * a sum of independent per-player, per-game normals, which is itself normal. So a team is
 * fully described by 14 (mu, variance) pairs, and:
 *
 *   - per category:  P(you win) = Phi( (muY - muO) / sqrt(varY + varO) )
 *   - across categories: the number won is a Poisson-binomial, exact via a small DP
 *
 * Validated against the Python Monte Carlo it replaces (200,000 sims): worst
 * disagreement 0.44pp on matchup win probability, and on streamer rankings the top-10
 * picks were identical with a worst rank displacement of 1. It is ~236x faster, which is
 * what makes live what-ifs (bench a player, add a streamer, run a trade) instant.
 *
 * Two inherited modelling assumptions, both carried over from the Python — not new here:
 *   1. Categories are drawn INDEPENDENTLY. A player's PTS and FGM are uncorrelated in the
 *      model, which is not true in reality.
 *   2. Ratio categories (FG%/FT%/3P%) are ratios of normals, approximated by the delta
 *      method. That is the bulk of the 0.44pp gap above.
 */

/** Canonical stat order. Must match `stats` in the generated league.json. */
export type StatVector = number[];

export interface Moments {
  /** Projected total per stat, in `stats` order. */
  mu: StatVector;
  /** Variance of that projection per stat. Variances add across players. */
  var: StatVector;
}

export interface LeagueMeta {
  /** The 14 counting stats, canonical order. */
  stats: string[];
  /** The 15 SCORED categories (includes FG%/FT%/3P%, excludes FTM/FTA). */
  categories: string[];
  /** Categories where a LOWER value wins. */
  lowerIsBetter: string[];
}

export interface MatchupOutcome {
  /** P(win the matchup) — more categories than the opponent. */
  win: number;
  loss: number;
  tie: number;
  /** Expected number of categories won (the sum of the per-category probabilities). */
  expectedCats: number;
  /** P(you win), per scored category, aligned to `meta.categories`. */
  categoryProbs: number[];
  /** Distribution over the number of categories won: dist[k] = P(exactly k). */
  distribution: number[];
}

/** Ratio categories and the made/attempted pair each is derived from. */
const RATIO_PAIRS: Record<string, [string, string]> = {
  "FG%": ["FGM", "FGA"],
  "FT%": ["FTM", "FTA"],
  "3P%": ["3PM", "3PA"],
};

/**
 * Error function, Abramowitz & Stegun 7.1.26 (max absolute error ~1.5e-7).
 * JavaScript has no built-in erf. That precision is far below the ~0.1% the UI shows.
 */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Standard normal CDF. */
export function normalCdf(z: number): number {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/**
 * Inverse standard normal CDF (Acklam's rational approximation, |rel. error| < 1.15e-9).
 *
 * This is what replaces `np.percentile` over a simulated array: because a projected
 * category total is Normal(mu, sd), its 10th/90th percentile is exact arithmetic rather
 * than a quantile of 10,000 samples — no simulation, and no sampling noise in the
 * confidence interval.
 */
export function normalQuantile(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
    1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
    6.680131188771972e1, -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
    -2.549732539343734, 4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p <= 1 - pLow) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return -(
    (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  );
}

/** Percentile of a Normal(mu, sd) projection. */
export function projectionPercentile(mu: number, sd: number, p: number): number {
  return mu + sd * normalQuantile(p);
}

/** Index lookup for the canonical stat order. */
function indexOf(meta: LeagueMeta): Record<string, number> {
  const idx: Record<string, number> = {};
  meta.stats.forEach((s, i) => (idx[s] = i));
  return idx;
}

/**
 * Mean and standard deviation of a ratio category, via the delta method:
 *   Var(A/B) ~= (muA/muB)^2 * (varA/muA^2 + varB/muB^2)
 */
function ratioMoments(
  m: Moments,
  madeIdx: number,
  attIdx: number
): [number, number] {
  const a = m.mu[madeIdx];
  const b = m.mu[attIdx];
  if (b <= 0) return [0, 1e-9];
  const r = a / b;
  const v =
    r * r * (m.var[madeIdx] / Math.max(a * a, 1e-12) + m.var[attIdx] / Math.max(b * b, 1e-12));
  return [r, Math.sqrt(Math.max(v, 1e-18))];
}

/** P(you win), per scored category. */
export function categoryProbabilities(
  meta: LeagueMeta,
  you: Moments,
  opp: Moments
): number[] {
  const idx = indexOf(meta);
  const lower = new Set(meta.lowerIsBetter);
  return meta.categories.map((cat) => {
    let muY: number, sdY: number, muO: number, sdO: number;
    const pair = RATIO_PAIRS[cat];
    if (pair) {
      const [made, att] = pair;
      [muY, sdY] = ratioMoments(you, idx[made], idx[att]);
      [muO, sdO] = ratioMoments(opp, idx[made], idx[att]);
    } else {
      const i = idx[cat];
      muY = you.mu[i];
      sdY = Math.sqrt(Math.max(you.var[i], 1e-18));
      muO = opp.mu[i];
      sdO = Math.sqrt(Math.max(opp.var[i], 1e-18));
    }
    const denom = Math.sqrt(sdY * sdY + sdO * sdO) || 1e-9;
    const p = normalCdf((muY - muO) / denom);
    return lower.has(cat) ? 1 - p : p;
  });
}

/**
 * Poisson-binomial: exact distribution of how many independent categories you win.
 * dist[k] = P(exactly k). O(n^2) on 15 categories, i.e. instant.
 */
export function poissonBinomial(probs: number[]): number[] {
  let dist = [1];
  for (const p of probs) {
    const next = new Array(dist.length + 1).fill(0);
    for (let k = 0; k < dist.length; k++) {
      next[k] += dist[k] * (1 - p);
      next[k + 1] += dist[k] * p;
    }
    dist = next;
  }
  return dist;
}

/** Full matchup outcome from two teams' moment vectors. */
export function matchupOutcome(
  meta: LeagueMeta,
  you: Moments,
  opp: Moments
): MatchupOutcome {
  const categoryProbs = categoryProbabilities(meta, you, opp);
  const distribution = poissonBinomial(categoryProbs);
  const n = categoryProbs.length;
  let win = 0;
  let loss = 0;
  let tie = 0;
  distribution.forEach((w, k) => {
    const lost = n - k;
    if (k > lost) win += w;
    else if (k < lost) loss += w;
    else tie += w;
  });
  return {
    win,
    loss,
    tie,
    expectedCats: categoryProbs.reduce((a, b) => a + b, 0),
    categoryProbs,
    distribution,
  };
}

// ---------------------------------------------------------------------------
// Moment arithmetic — what makes every "what-if" a subtraction instead of a
// re-simulation. Variances add for independent players, so swapping a player is:
//     mu'  = mu  - mu_out  + mu_in
//     var' = var - var_out + var_in
// ---------------------------------------------------------------------------

export function emptyMoments(n: number): Moments {
  return { mu: new Array(n).fill(0), var: new Array(n).fill(0) };
}

export function addMoments(base: Moments, add: Moments): Moments {
  return {
    mu: base.mu.map((v, i) => v + add.mu[i]),
    var: base.var.map((v, i) => v + add.var[i]),
  };
}

export function subtractMoments(base: Moments, remove: Moments): Moments {
  return {
    mu: base.mu.map((v, i) => v - remove.mu[i]),
    // Clamp at zero: floating-point subtraction of a player's own contribution can land
    // fractionally below it, and a negative variance would produce NaN in the sqrt.
    var: base.var.map((v, i) => Math.max(0, v - remove.var[i])),
  };
}

/**
 * Combine the SLOW projection with the LIVE current-week totals.
 *
 * Current totals are already banked, so they shift the mean and add NO uncertainty —
 * which is exactly why the expensive half can be cached and only this part fetched live.
 */
export function withCurrentTotals(projection: Moments, current: StatVector): Moments {
  return {
    mu: projection.mu.map((v, i) => v + (current[i] ?? 0)),
    var: projection.var.slice(),
  };
}
