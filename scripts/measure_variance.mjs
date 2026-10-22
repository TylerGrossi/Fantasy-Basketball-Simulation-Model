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
      const row = { per, gp: r.gp, v: r.v, name: r.name };
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
