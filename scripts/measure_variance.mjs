/**
 * Measure the win-probability model's uncertainty constants from a finished season's box
 * scores (public/data/archive/boxscores-<year>.json), and print them in the form
 * engine/config.py takes them.
 *
 * WHY THIS EXISTS (2026-10-21). The per-stat variance factors were hand-picked guesses,
 * and some were badly off — FTM/FTA at 0.2 against a measured ~0.67 made FT% leads look
 * like locks; FGM/FGA/PTS at 0.7 against ~0.35 did the opposite. The live win probability
 * also treated the 15 categories as independent, when FGM, FGA, PTS, 3PM and 3PA move
 * together (FGM~PTS 0.93): one hot shooting quarter counted as five separate pieces of
 * good news and swung the number 20+ points. This script measures all three things the
 * model needs instead of guessing them:
 *
 *   CATEGORY_VARIANCE   per-game noise, as a coefficient of variation per stat:
 *                       Var(week) = games * (avg * cv)^2, residuals taken around each
 *                       player's own full-season average.
 *   PROJECTION_ERROR    how wrong the AVERAGE itself is, as a CV per stat. The app projects
 *                       from season-to-date blended with the last 30 days; this emulates
 *                       that from the weeks before each week, and takes whatever squared
 *                       miss the per-game noise does not explain. It scales with games^2
 *                       (a wrong average is wrong in every game), not games, which is
 *                       why it matters most with many games left.
 *   CATEGORY_CORRELATION
 *                       correlation of the 15 per-category margins (you minus opponent),
 *                       from a Monte Carlo over real team-weeks with the measured stat
 *                       correlations. lib/probability.ts draws the categories jointly
 *                       from it.
 *
 *   node scripts/measure_variance.mjs [path/to/boxscores.json]
 *
 * Paste the output over the matching constants in engine/config.py, then `npm run data`.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const file = process.argv[2] ?? join(ROOT, "public/data/archive/boxscores-2026.json");
const box = JSON.parse(readFileSync(file, "utf8"));
const STATS = box.stats;
const N = STATS.length;
const idx = Object.fromEntries(STATS.map((s, i) => [s, i]));

// Mirrors engine/config.py CATEGORIES / build_data.py lowerIsBetter.
const CATEGORIES = ["FGM", "FGA", "FG%", "FT%", "3PM", "3PA", "3P%",
  "REB", "AST", "STL", "BLK", "TO", "DD", "PTS", "TW"];
const RATIO = { "FG%": ["FGM", "FGA"], "FT%": ["FTM", "FTA"], "3P%": ["3PM", "3PA"] };
const LOWER = new Set(["TO"]);

// Mirrors engine/data.py: last-30 weight 0.7, scaled down below BLEND_FULL_GAMES games.
const BLEND = 0.7;
const BLEND_FULL_GAMES = 10;
const LAST30_WEEKS = 4;
const MIN_PRIOR_GAMES = 5; // week 1 projects off a different source; skip cold starts

// ---------------------------------------------------------------------------------------
// Player-weeks, in period order.
// ---------------------------------------------------------------------------------------
const periods = Object.keys(box.periods).map(Number).sort((a, b) => a - b);
const byPlayer = new Map();
const teamWeeks = [];
for (const per of periods) {
  for (const [team, rows] of Object.entries(box.periods[per])) {
    const tw = [];
    for (const r of rows) {
      if (!r.gp) continue;
      const row = { per, gp: r.gp, v: r.v, name: r.name, team };
      if (!byPlayer.has(r.name)) byPlayer.set(r.name, []);
      byPlayer.get(r.name).push(row);
      tw.push(row);
    }
    if (tw.length) teamWeeks.push({ per, team, rows: tw });
  }
}

const perGame = (weeks) => {
  const g = weeks.reduce((a, w) => a + w.gp, 0);
  return { g, avg: STATS.map((_, i) => (g ? weeks.reduce((a, w) => a + w.v[i], 0) / g : 0)) };
};

// ---------------------------------------------------------------------------------------
// 1. Per-game noise around each player's own season average.
// ---------------------------------------------------------------------------------------
const seasonAvg = new Map();
const nNum = new Array(N).fill(0);
const nDen = new Array(N).fill(0);
for (const [name, weeks] of byPlayer) {
  const { g, avg } = perGame(weeks);
  if (g < 20 || weeks.length < 6) continue;
  seasonAvg.set(name, avg);
  for (const w of weeks) {
    for (let i = 0; i < N; i++) {
      const r = w.v[i] - w.gp * avg[i];
      nNum[i] += r * r;
      nDen[i] += w.gp * avg[i] * avg[i];
    }
  }
}
const noiseCv = STATS.map((_, i) => Math.sqrt(nNum[i] / nDen[i]));

// ---------------------------------------------------------------------------------------
// 2. Projection error: forecast each week from the weeks before it, the way the app does.
// ---------------------------------------------------------------------------------------
const pNum = new Array(N).fill(0);
const pDen = new Array(N).fill(0);
const resid = []; // standardised forecast residuals, for the stat correlation
// Raw forecast misses summed per TEAM-week, for SHOT_CORRELATION: a team's FT% is its
// total makes over total attempts, so what matters is how those totals move together.
const teamMiss = new Map();
for (const [name, weeks] of byPlayer) {
  if (!seasonAvg.has(name)) continue;
  for (let k = 1; k < weeks.length; k++) {
    const w = weeks[k];
    const prior = weeks.slice(0, k);
    const season = perGame(prior);
    if (season.g < MIN_PRIOR_GAMES) continue;
    const recent = perGame(prior.filter((p) => p.per >= w.per - LAST30_WEEKS));
    const wt = recent.g ? Math.min(1, recent.g / BLEND_FULL_GAMES) * BLEND : 0;
    const proj = STATS.map((_, i) => wt * recent.avg[i] + (1 - wt) * season.avg[i]);
    const z = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      const a = proj[i];
      const r = w.v[i] - w.gp * a;
      const tk = `${w.per}|${w.team}`;
      if (!teamMiss.has(tk)) teamMiss.set(tk, new Array(N).fill(0));
      teamMiss.get(tk)[i] += r;
      pNum[i] += r * r - w.gp * (a * noiseCv[i]) ** 2;
      pDen[i] += (w.gp * a) ** 2;
      const sd = Math.sqrt(w.gp * (a * noiseCv[i]) ** 2);
      z[i] = sd > 0 ? r / sd : 0;
    }
    resid.push(z);
  }
}
const projCv = STATS.map((_, i) => Math.sqrt(Math.max(0, pNum[i] / pDen[i])));

// Stat-by-stat correlation of the forecast residuals (noise + projection error together).
const sdz = STATS.map((_, i) => Math.sqrt(resid.reduce((a, z) => a + z[i] * z[i], 0) / resid.length));
const statCorr = STATS.map((_, i) =>
  STATS.map((_, j) => resid.reduce((a, z) => a + z[i] * z[j], 0) / resid.length / (sdz[i] * sdz[j]))
);

// ---------------------------------------------------------------------------------------
// 3. Category-margin correlation, by Monte Carlo over real team-weeks.
// ---------------------------------------------------------------------------------------
function cholesky(m) {
  const n = m.length;
  const L = m.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = m[i][j];
      for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
      L[i][j] = i === j ? Math.sqrt(Math.max(s, 1e-9)) : s / L[j][j];
    }
  }
  return L;
}
const Ls = cholesky(statCorr);

let seed = 20261021;
const rand = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = () => {
  let u = 0;
  while (!u) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};

/** A team-week's projected (mu, sd) per stat, from its players' season averages. */
function teamMoments(tw) {
  const mu = new Array(N).fill(0);
  const vr = new Array(N).fill(0);
  for (const r of tw.rows) {
    const a = seasonAvg.get(r.name);
    if (!a) continue;
    for (let i = 0; i < N; i++) {
      mu[i] += r.gp * a[i];
      vr[i] += r.gp * (a[i] * noiseCv[i]) ** 2 + (r.gp * a[i] * projCv[i]) ** 2;
    }
  }
  return { mu, sd: vr.map(Math.sqrt) };
}
function drawCats(m) {
  const e = STATS.map(gauss);
  const x = STATS.map((_, i) => {
    let s = 0;
    for (let k = 0; k <= i; k++) s += Ls[i][k] * e[k];
    return Math.max(0, m.mu[i] + m.sd[i] * s);
  });
  return CATEGORIES.map((c) => {
    const p = RATIO[c];
    if (p) {
      const att = x[idx[p[1]]];
      return att > 0 ? x[idx[p[0]]] / att : 0;
    }
    return x[idx[c]];
  });
}

const C = CATEGORIES.length;
const regular = teamWeeks.filter((t) => t.per <= 19);
const acc = CATEGORIES.map(() => new Array(C).fill(0));
let pairings = 0;
const PAIRINGS = 300;
const DRAWS = 1500;
for (let p = 0; p < PAIRINGS; p++) {
  const a = teamMoments(regular[Math.floor(rand() * regular.length)]);
  const b = teamMoments(regular[Math.floor(rand() * regular.length)]);
  if (a.mu[idx.FGA] <= 0 || b.mu[idx.FGA] <= 0) continue;
  const D = [];
  for (let d = 0; d < DRAWS; d++) {
    const ya = drawCats(a);
    const yb = drawCats(b);
    D.push(ya.map((v, i) => v - yb[i]));
  }
  const mean = CATEGORIES.map((_, i) => D.reduce((s, r) => s + r[i], 0) / DRAWS);
  const sd = CATEGORIES.map((_, i) =>
    Math.sqrt(D.reduce((s, r) => s + (r[i] - mean[i]) ** 2, 0) / DRAWS)
  );
  for (let i = 0; i < C; i++) {
    for (let j = 0; j < C; j++) {
      let s = 0;
      for (const r of D) s += (r[i] - mean[i]) * (r[j] - mean[j]);
      acc[i][j] += s / DRAWS / (sd[i] * sd[j] || 1);
    }
  }
  pairings++;
}
const catCorr = acc.map((row) => row.map((v) => v / pairings));

// ---------------------------------------------------------------------------------------
// Output, ready to paste into engine/config.py.
// ---------------------------------------------------------------------------------------
const f2 = (x) => x.toFixed(2);
const dict = (vals) =>
  "{\n" + STATS.map((s, i) => `    "${s}": ${f2(vals[i])},`).join("\n") + "\n}";
console.log(`# measured by scripts/measure_variance.mjs from ${file.split(/[\\/]/).pop()}`);
console.log(`# ${seasonAvg.size} players, ${resid.length} forecast player-weeks, ${pairings} pairings`);
console.log(`CATEGORY_VARIANCE = ${dict(noiseCv)}\n`);
console.log(`PROJECTION_ERROR = ${dict(projCv)}\n`);
console.log("# Rows/columns in CATEGORIES order.");
console.log("CATEGORY_CORRELATION = [");
for (let i = 0; i < C; i++) {
  const row = catCorr[i].map((v, j) => (i === j ? "1.00" : f2(v)).padStart(5));
  console.log(`    [${row.join(",")}],  # ${CATEGORIES[i]}`);
}
console.log("]");

// Made-vs-attempted correlation per ratio category (2026-11-09), from the same forecast
// residuals as the stat correlation above. Without it the delta method treated makes and
// attempts as independent, and an FT% range ran 60%-100% when the truth was ~76-84%.
const shotRho = Object.fromEntries(
  Object.entries(RATIO).map(([cat, [m, a]]) => {
    const t = [...teamMiss.values()];
    const i = idx[m], j = idx[a];
    const mean = (k) => t.reduce((s, x) => s + x[k], 0) / t.length;
    const mi = mean(i), mj = mean(j);
    let sij = 0, sii = 0, sjj = 0;
    for (const x of t) {
      sij += (x[i] - mi) * (x[j] - mj);
      sii += (x[i] - mi) ** 2;
      sjj += (x[j] - mj) ** 2;
    }
    return [cat, sij / Math.sqrt(sii * sjj)];
  })
);
console.log(`\n# Correlation of a team-week's made and attempted forecast miss (${teamMiss.size} team-weeks).`);
console.log(
  "SHOT_CORRELATION = {" + Object.entries(shotRho).map(([c, v]) => `"${c}": ${f2(v)}`).join(", ") + "}"
);

// ---------------------------------------------------------------------------------------
// 5. SEASON_TEAM_SIGMA (2026-11-09): how far a team's REST OF SEASON drifts from what its
//    projection said, beyond week-to-week noise - the season engine (lib/seasonOdds.ts)
//    shifts each team once per simulated season by N(0, sigma) on the probit of every
//    category. Measured, like everything above, never tuned.
//
//    For each start week t: every team's week is projected from data up to t (its roster
//    at t, each player's blended line and games per week), and every later regular-season
//    week is scored all-play (each team against every other) with the same normal model
//    the app uses. A team effect delta is fitted by probit maximum likelihood,
//    P(a beats b in c) = Phi(q + delta_a - delta_b), SEPARATELY on the odd and the even
//    later weeks. Week-to-week noise is independent between the halves; a persistent
//    effect is in both - so the covariance of the two halves' deltas across teams is the
//    persistent variance, free of the noise (which plain var(delta) would count too).
// ---------------------------------------------------------------------------------------
const RS = Number(process.env.RS_WEEKS ?? 19); // the archived season's regular-season weeks
const erf = (x) => {
  const sgn = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sgn * y;
};
const Phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const phi = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
const PhiInv = (p) => {
  let lo = -8, hi = 8;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (Phi(mid) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
};

const teamIds = [...new Set(teamWeeks.map((t) => t.team))];
const rowsAt = new Map(teamWeeks.map((t) => [`${t.team}|${t.per}`, t.rows]));

/** A player's line and games per week as of the end of week t (blend as section 2). */
function projAt(name, t) {
  const ws = (byPlayer.get(name) ?? []).filter((w) => w.per <= t);
  const season = perGame(ws);
  if (season.g < MIN_PRIOR_GAMES) return null;
  const recent = perGame(ws.filter((p) => p.per > t - LAST30_WEEKS));
  const wt = recent.g ? Math.min(1, recent.g / BLEND_FULL_GAMES) * BLEND : 0;
  const avg = STATS.map((_, i) => wt * recent.avg[i] + (1 - wt) * season.avg[i]);
  return { avg, gpw: season.g / ws.length };
}
/** A team's projected week from its roster at t: (mu, var) per stat, playerMoments. */
function projTeam(team, t) {
  const mu = new Array(N).fill(0);
  const vr = new Array(N).fill(0);
  for (const r of rowsAt.get(`${team}|${t}`) ?? []) {
    const p = projAt(r.name, t);
    if (!p) continue;
    for (let i = 0; i < N; i++) {
      mu[i] += p.gpw * p.avg[i];
      vr[i] += p.gpw * (p.avg[i] * noiseCv[i]) ** 2 + (p.gpw * p.avg[i] * projCv[i]) ** 2;
    }
  }
  // The app's week term (section 4), once weekCv exists.
  if (typeof weekCv !== "undefined") for (let i = 0; i < N; i++) vr[i] += (weekCv[i] * mu[i]) ** 2;
  return { mu, vr };
}
const actualTotals = (team, w) => {
  const v = new Array(N).fill(0);
  for (const r of rowsAt.get(`${team}|${w}`) ?? []) for (let i = 0; i < N; i++) v[i] += r.v[i];
  return v;
};
const catValue = (v, c) => {
  const p = RATIO[c];
  if (!p) return v[idx[c]];
  const att = v[idx[p[1]]];
  return att > 0 ? v[idx[p[0]]] / att : 0;
};
/** P(a beats b) per category - the app's normal model, ratios correlated (shotRho). */
function catProbs(A, B) {
  return CATEGORIES.map((c) => {
    const p = RATIO[c];
    const mom = (T) => {
      if (!p) return [T.mu[idx[c]], T.vr[idx[c]]];
      const i = idx[p[0]], j = idx[p[1]];
      const a = T.mu[i], b = T.mu[j];
      if (b <= 0) return [0, 1e-12];
      const r = a / b;
      const v = r * r * (T.vr[i] / (a * a) + T.vr[j] / (b * b) - (2 * shotRho[c] * Math.sqrt(T.vr[i] * T.vr[j])) / (a * b));
      return [r, Math.max(v, 1e-12)];
    };
    const [ma, sa] = mom(A);
    const [mb, sb] = mom(B);
    const pr = Phi((ma - mb) / Math.sqrt(sa + sb || 1e-12));
    return LOWER.has(c) ? 1 - pr : pr;
  });
}
/** Probit team effects (centred) from observations {a, b, q, y} by Fisher scoring. */
function fitDelta(obs, n) {
  let d = new Array(n).fill(0);
  for (let it = 0; it < 30; it++) {
    const g = new Array(n).fill(0);
    const I = Array.from({ length: n }, () => new Array(n).fill(0));
    for (const o of obs) {
      const x = o.q + d[o.a] - d[o.b];
      const P = Math.min(1 - 1e-9, Math.max(1e-9, Phi(x)));
      const f = phi(x);
      const s = (f * (o.y - P)) / (P * (1 - P));
      const w = (f * f) / (P * (1 - P));
      g[o.a] += s; g[o.b] -= s;
      I[o.a][o.a] += w; I[o.b][o.b] += w; I[o.a][o.b] -= w; I[o.b][o.a] -= w;
    }
    for (let i = 0; i < n; i++) I[i][i] += 1e-3; // effects are defined only up to a constant
    const M = I.map((row, i) => [...row, g[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    const step = M.map((row, i) => row[n] / row[i]);
    d = d.map((x, i) => x + step[i]);
    const m = d.reduce((a, b) => a + b, 0) / n;
    d = d.map((x) => x - m);
    if (Math.max(...step.map(Math.abs)) < 1e-6) break;
  }
  return d;
}


// ---------------------------------------------------------------------------------------
// 4. WEEK_UNCERTAINTY (2026-11-09): what a PRE-WEEK projection cannot know. Sections 1-2
//    measure a player's spread GIVEN the games he actually played, so injuries, rest,
//    pickups, drops and returns during the week were never in it - which is why a Monday
//    forecast read 96% on a team that then lost three players' games and faced a LeBron
//    the projection had at zero. Here each team's week is projected the way the app does
//    before it starts: its roster at the end of the previous week, every player who played
//    then projected for all of his NBA team's games (one who did not play is taken as out,
//    as the injury-aware count does), lines blended from the weeks before. The squared
//    miss of the team total beyond what the per-player terms explain, relative to the
//    projected total squared, is the CV printed per stat. The app adds (cv x rest-of-week
//    projection)^2 to a side's variance, so it is largest on Monday and gone by Sunday.
//    The mean miss (mostly the daily starting cap, which this emulation does not apply) is
//    removed first: only the SPREAD is wanted.
// ---------------------------------------------------------------------------------------
const archivePoolPath = join(dirname(file), "league-2026.json");
const nbaOf = new Map();
try {
  const arch = JSON.parse(readFileSync(archivePoolPath, "utf8"));
  for (const p of arch.seasonData?.playerPool ?? []) nbaOf.set(p.name, p.nbaTeam);
} catch {
  /* no archive league: players fall back to their own games per week */
}
const nbaGames = new Map(); // `${nba}|${period}` -> that NBA team's games (most any player logged)
for (const [name, weeks] of byPlayer) {
  const nba = nbaOf.get(name);
  if (!nba) continue;
  for (const w of weeks) {
    const k = `${nba}|${w.per}`;
    nbaGames.set(k, Math.max(nbaGames.get(k) ?? 0, w.gp));
  }
}
const wkRows = []; // per team-week: { r: miss per stat, mv: model variance, mu }
for (const tw of teamWeeks) {
  const w = tw.per;
  if (w < 3 || w > RS) continue;
  const prev = rowsAt.get(`${tw.team}|${w - 1}`);
  if (!prev?.length) continue;
  const mu = new Array(N).fill(0);
  const mv = new Array(N).fill(0);
  for (const r of prev) {
    const p = projAt(r.name, w - 1);
    if (!p) continue;
    const nba = nbaOf.get(r.name);
    const g = (nba && nbaGames.get(`${nba}|${w}`)) || Math.round(p.gpw);
    for (let i = 0; i < N; i++) {
      mu[i] += g * p.avg[i];
      mv[i] += g * (p.avg[i] * noiseCv[i]) ** 2 + (g * p.avg[i] * projCv[i]) ** 2;
    }
  }
  const act = actualTotals(tw.team, w);
  wkRows.push({ r: act.map((x, i) => x - mu[i]), mv, mu });
}
const weekCv = STATS.map((_, i) => {
  const n = wkRows.length;
  const bias = wkRows.reduce((s, x) => s + x.r[i], 0) / n;
  const miss2 = wkRows.reduce((s, x) => s + (x.r[i] - bias) ** 2, 0) / n;
  const model = wkRows.reduce((s, x) => s + x.mv[i], 0) / n;
  const mu2 = wkRows.reduce((s, x) => s + x.mu[i] ** 2, 0) / n;
  return Math.sqrt(Math.max(0, miss2 - model) / mu2);
});
console.log(`\n# What a pre-week projection cannot know, as a CV of the rest-of-week total (${wkRows.length} team-weeks).`);
console.log(`WEEK_UNCERTAINTY = ${dict(weekCv)}`);

const sig2 = [];
for (let t = 4; t <= RS - 4; t++) {
  const proj = teamIds.map((tm) => projTeam(tm, t));
  if (proj.some((p) => p.mu[idx.FGA] <= 0)) continue;
  const q = teamIds.map((_, a) =>
    teamIds.map((_, b) => (a === b ? null : catProbs(proj[a], proj[b]).map((p) => PhiInv(Math.min(1 - 1e-6, Math.max(1e-6, p))))))
  );
  const halves = [[], []];
  let k = 0;
  for (let w = t + 1; w <= RS; w++, k++) {
    const act = teamIds.map((tm) => actualTotals(tm, w));
    for (let a = 0; a < teamIds.length; a++) {
      for (let b = a + 1; b < teamIds.length; b++) {
        CATEGORIES.forEach((c, ci) => {
          const va = catValue(act[a], c), vb = catValue(act[b], c);
          if (va === vb) return;
          const aWins = LOWER.has(c) ? va < vb : va > vb;
          halves[k % 2].push({ a, b, q: q[a][b][ci], y: aWins ? 1 : 0 });
        });
      }
    }
  }
  const n = teamIds.length;
  const d0 = fitDelta(halves[0], n);
  const d1 = fitDelta(halves[1], n);
  sig2.push(d0.reduce((s, x, i) => s + x * d1[i], 0) / (n - 1));
}
const teamSigma = Math.sqrt(Math.max(0, sig2.reduce((a, b) => a + b, 0) / sig2.length));
console.log(`\n# Season-long team-strength spread, probit per category (${sig2.length} start weeks,`);
console.log(`# split-half covariances ${sig2.map((x) => x.toFixed(3)).join(" ")}).`);
console.log(`SEASON_TEAM_SIGMA = ${teamSigma.toFixed(3)}`);
