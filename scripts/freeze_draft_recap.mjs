// Freeze the Draft Recap: save the draft picks and the draft-night season simulation to
// public/data/draft-recap.json, so the page stops re-fetching ESPN and re-simulating.
//
// The draft is over (owner, 2026-10-30: "it should be saved since the draft already
// happened"). Once this file exists, lib/draftSeason.ts and app/api/draft read it instead
// of ESPN, and the recap's Playoff % is the draft-night projection, not the daily export's.
//
// Run against a running app (it uses the app's own routes, so the numbers are exactly
// what the page showed):
//   node scripts/freeze_draft_recap.mjs [http://localhost:3001]
// Re-running overwrites the snapshot; delete the file to go back to live.

import { writeFile } from "node:fs/promises";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";

async function get(route) {
  const r = await fetch(base + route);
  if (!r.ok) throw new Error(`${route}: HTTP ${r.status}`);
  return r.json();
}

const feed = await get("/api/draft");
if (!feed.picks?.length) throw new Error("No picks in the draft feed — nothing to freeze.");
const season = await get("/api/draft/season");
if (!season.results?.length) throw new Error("No season results — is the draft graded?");

const out = {
  frozenAt: new Date().toISOString(),
  feed,
  results: season.results,
  version: season.version,
  sims: season.sims,
};
const file = path.join(process.cwd(), "public", "data", "draft-recap.json");
await writeFile(file, JSON.stringify(out));
console.log(`Wrote ${file}: ${feed.picks.length} picks, ${season.results.length} teams, ${season.sims} sims.`);
