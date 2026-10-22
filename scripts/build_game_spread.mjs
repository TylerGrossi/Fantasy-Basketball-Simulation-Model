/**
 * Build `public/data/game-spread.json` — how far ONE GAME spreads, per category.
 *
 * WHY THIS EXISTS. Game Day values a single night's line with the Player Card's formula,
 * and that formula divides each category by a spread. The Player Card's spreads are how
 * far players' SEASON AVERAGES sit apart — right for a season line, far too narrow for a
 * night: steals averages spread 0.36, so 3 steals scored +6.8 and outweighed a 36-point
 * game. One night has to be measured against how far single nights actually spread.
 *
 * WHY MEASURED. The first cut modelled it from the engine's per-stat variance factors and
 * got points and blocks backwards (PTS 0.7 = a 20-point scorer swinging ±14 a night, about
 * twice reality, so a 4-point, 5-block line out-ranked 36 points). Real game logs settle it.
 *
 * WHAT IT MEASURES. Every regular-season game of the pool's players in LAST season's logs
 * (the current season has a handful of games each), pooled: the standard deviation of
 * each of the league's fifteen categories across all those player-games. For FG%, FT% and
 * 3P% the quantity is the one the value scores — makes minus the league rate times
 * attempts — so volume counts as it does on the card. DD is off each line, TW off the
 * game's result.
 *
 * WHY LAST SEASON, FIXED. A spread is a property of the sport, not of this week; 15,000+
 * games of last season is a better estimate than a fortnight of this one. Re-run it once a
 * season, after it ends.
 *
 *   node scripts/build_game_spread.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** ESPN is fine with this; going wider starts drawing connection resets. */
const CONCURRENCY = 8;
/** The last COMPLETE season: ESPN names a season by the year it ends in. */
const SEASON = 2026;

/* Same throwaway compile as build_consistency.mjs, so the game-log parser is the app's own. */
function buildLib() {
  const out = mkdtempSync(join(tmpdir(), "fbb-spread-"));
  execFileSync(
    process.execPath,
    [
      join(ROOT, "node_modules/typescript/bin/tsc"),
      "lib/espnLive.ts",
      "--outDir", out,
      "--module", "esnext",
      "--target", "es2022",
      "--moduleResolution", "bundler",
      "--skipLibCheck",
    ],
    { cwd: ROOT, stdio: "inherit" }
  );
  for (const f of readdirSync(out)) {
    if (!f.endsWith(".js")) continue;
    const p = join(out, f);
    writeFileSync(
      p,
      readFileSync(p, "utf8").replace(
        /(from\s+")(\.\/[^"]+?)(")/g,
        (_, a, spec, c) => a + (spec.endsWith(".js") ? spec : spec + ".js") + c
      )
    );
  }
  return out;
}

const sd = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
};

const dist = buildLib();
try {
  const { parseGameLog } = await import(pathToFileURL(join(dist, "espnLive.js")).href);

  const league = JSON.parse(readFileSync(join(ROOT, "public/data/league.json"), "utf8"));
  const targets = (league.seasonData?.playerPool ?? []).filter((p) => p.playerId);
  console.log(`${targets.length} players to fetch (${SEASON - 1}-${String(SEASON).slice(2)} logs)`);

  const lines = [];
  let players = 0;
  let missing = 0;
  let done = 0;
  const noValue = () => ({ off: 0, def: 0, other: 0 });

  const worker = async (queue) => {
    for (;;) {
      const p = queue.shift();
      if (!p) return;
      const url =
        "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/" +
        `${p.playerId}/gamelog?season=${SEASON}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const games = parseGameLog(await res.json(), noValue);
        if (games.length) players++;
        else missing++;
        for (const g of games) lines.push(g.line);
      } catch {
        missing++;
      }
      if (++done % 25 === 0) console.log(`  ${done}/${targets.length}`);
    }
  };

  const queue = [...targets];
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
  if (lines.length < 1000) throw new Error(`only ${lines.length} games — not writing a spread`);

  const spread = {};
  // All fifteen of the league's categories, as the value counts them (lib/percentiles.ts).
  for (const c of ["PTS", "3PM", "3PA", "FGM", "FGA", "AST", "REB", "STL", "BLK", "TO", "DD", "TW"]) {
    spread[c] = +sd(lines.map((l) => l[c] ?? 0)).toFixed(4);
  }
  for (const [cat, made, att] of [["FG%", "FGM", "FGA"], ["FT%", "FTM", "FTA"], ["3P%", "3PM", "3PA"]]) {
    const lg =
      lines.reduce((a, l) => a + (l[made] ?? 0), 0) / lines.reduce((a, l) => a + (l[att] ?? 0), 0);
    spread[cat] = +sd(lines.map((l) => (l[made] ?? 0) - lg * (l[att] ?? 0))).toFixed(4);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    season: SEASON,
    players,
    games: lines.length,
    spread,
  };
  writeFileSync(join(ROOT, "public/data/game-spread.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote public/data/game-spread.json from ${lines.length} games of ${players} players`);
  console.log(spread);
  if (missing) console.log(`(${missing} players with no ${SEASON} log — rookies, mostly)`);
} finally {
  rmSync(dist, { recursive: true, force: true });
}
