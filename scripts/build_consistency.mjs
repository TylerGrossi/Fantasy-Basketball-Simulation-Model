/**
 * Build `public/data/consistency.json` — the league-wide spread baseline.
 *
 * WHY THIS EXISTS. The Player Card's Consistency panel shows a spread ("± 7.1"). On its
 * own that number means nothing to a reader: is 7.1 steady or wild? Only a distribution
 * can say. The card gets away without one because a human eyeballs a few players; the
 * Agent cannot, so it needs the pool's spreads to place a player in it.
 *
 * WHY PRECOMPUTED RATHER THAN FETCHED ON DEMAND. A percentile needs every player's game
 * log — ~290 ESPN requests. That is fine once at build time and impossible inside a chat
 * turn, where the user is waiting and the function has a timeout. The season is over, so
 * the baseline is fixed: this runs once and the file stops changing.
 *
 * WHY IT REUSES THE APP'S OWN CODE. `parseGameLog` and `consistency` are imported from
 * lib/espnLive.ts, the same functions the card renders from — a Python reimplementation
 * in build_data.py would have to duplicate the 9-cat valuer and would drift from the
 * screen the first time either side changed.
 *
 *   node scripts/build_consistency.mjs
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** ESPN is fine with this; going wider starts drawing connection resets. */
const CONCURRENCY = 8;
/** Below this a standard deviation is noise, and the player is not a fantasy asset. */
const MIN_GAMES = 20;

/*
 * The library is TypeScript and this is a plain Node script, so compile the handful of
 * modules it needs to a throwaway directory. `tsc` emits bare relative specifiers
 * ("./espnLive"), which Node's ESM resolver rejects, hence the extension fix-up.
 */
function buildLib() {
  const out = mkdtempSync(join(tmpdir(), "fbb-consistency-"));
  // Run the local compiler through node directly. `npx` is a .cmd shim on Windows and
  // execFileSync refuses to spawn a batch file (EINVAL) without a shell.
  execFileSync(
    process.execPath,
    [
      join(ROOT, "node_modules/typescript/bin/tsc"),
      "lib/espnLive.ts",
      "lib/percentiles.ts",
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

const dist = buildLib();
try {
  const { parseGameLog, consistency } = await import(
    pathToFileURL(join(dist, "espnLive.js")).href
  );
  const { makeValuer } = await import(pathToFileURL(join(dist, "percentiles.js")).href);

  const league = JSON.parse(readFileSync(join(ROOT, "public/data/league.json"), "utf8"));
  const pool = league.seasonData?.playerPool ?? [];
  const value = makeValuer(pool);
  const targets = pool.filter((p) => p.playerId);
  console.log(`${targets.length} players to fetch`);

  const rows = {};
  let done = 0;
  let missing = 0;

  const worker = async (queue) => {
    for (;;) {
      const p = queue.shift();
      if (!p) return;
      const url =
        "https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/" +
        `${p.playerId}/gamelog`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const games = parseGameLog(await res.json(), value);
        const c = consistency(games);
        if (c && c.n >= MIN_GAMES) {
          rows[p.playerId] = {
            n: c.n,
            avg: +c.avg.toFixed(3),
            median: +c.median.toFixed(3),
            sd: +c.sd.toFixed(3),
            aboveOwn: +c.aboveOwn.toFixed(4),
            abovePool: +c.abovePool.toFixed(4),
          };
        } else missing++;
      } catch {
        missing++;
      }
      if (++done % 25 === 0) console.log(`  ${done}/${targets.length}`);
    }
  };

  const queue = [...targets];
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

  const out = {
    generatedAt: new Date().toISOString(),
    season: league.season,
    minGames: MIN_GAMES,
    players: rows,
  };
  const path = join(ROOT, "public/data/consistency.json");
  writeFileSync(path, JSON.stringify(out));
  console.log(
    `wrote ${Object.keys(rows).length} players to public/data/consistency.json ` +
      `(${missing} skipped: no log, or under ${MIN_GAMES} games)`
  );
} finally {
  rmSync(dist, { recursive: true, force: true });
}
