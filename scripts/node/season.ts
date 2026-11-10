/**
 * The export's Node step (2026-11-09) - run after build_data.py and the Will They Play
 * scoring, before the logs are recorded:
 *
 *   1. this week's sides for every team EXACTLY as the gauge counts them
 *      (lib/gaugeSides.ts, the owner's view for the owner's matchup, an observer's for the
 *      rest) -> seasonData.currentWeekSides, which the logs and the browser read;
 *   2. the ONE season engine (lib/seasonOdds.ts) over seasonData.seasonInputs ->
 *      seasonData.playoffOdds and championshipFinalists (Playoffs page, Schedule's future
 *      weeks, League pages, Streamers' baseline).
 *
 *   npm run season        (compiles to .cache/node, then runs)
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { normaliseLeague } from "../../lib/leagueAttach";
import { observerSides, projectedSides, snapshotLive } from "../../lib/gaugeSides";
import { makeSeasonEngine, oddsTable } from "../../lib/seasonOdds";
import { sideMoments, type LeagueData, type TeamSide } from "../../lib/league";
import { etDate } from "../../lib/dates";
import { SLOT_LABEL } from "../../lib/lineupOrder";
import { DEFAULT_TEAM_NAME } from "../../lib/defaultTeam";
import type { AvailabilityData } from "../../lib/availability";
import type { Moments } from "../../lib/probability";
import type { TodayLine } from "../../lib/useLiveTotals";

const SIMS = 8000;
const dir = path.join(process.cwd(), "public", "data");
const leaguePath = path.join(dir, "league.json");
const raw = JSON.parse(readFileSync(leaguePath, "utf8")) as LeagueData;
const availPath = path.join(dir, "availability.json");
const avail = existsSync(availPath) ? (JSON.parse(readFileSync(availPath, "utf8")) as AvailabilityData) : null;
const league = normaliseLeague(raw, avail);
const today = etDate();

if (league.seasonOver) {
  console.log("season step: season is over - nothing to do");
  process.exit(0);
}

// Today's ESPN lineup per team, from the export's own lineup slots (the live feed's
// `lineupSlotId`, as of the export) - what the gauge reads from the live route.
const slotId = new Map(Object.entries(SLOT_LABEL).map(([id, label]) => [label, Number(id)]));
const linesFor = (teamName: string): TodayLine[] =>
  (league.seasonData.playerPool ?? [])
    .filter((p) => p.owner === teamName)
    .map((p) => {
      const slot = slotId.get(String(p.lineupSlot ?? "Bench")) ?? 12;
      return {
        name: p.name,
        playerId: p.playerId ?? null,
        counted: slot !== 12 && slot !== 13,
        slot,
        gameId: "",
        min: 0,
        v: null,
      } as TodayLine;
    });
const nameOf = new Map(league.teams.map((t) => [t.id, t.name]));
const viewer = league.teams.find((t) => t.name.trim() === DEFAULT_TEAM_NAME)?.id ?? league.teams[0]?.id;

// 1. This week's sides, as the gauge counts them.
const sides: Record<number, { side: TeamSide; current: number[] }> = {};
for (const m of league.matchups) {
  const home = linesFor(nameOf.get(m.homeId) ?? "");
  const away = linesFor(nameOf.get(m.awayId) ?? "");
  if (m.homeId === viewer || m.awayId === viewer) {
    const isHome = m.homeId === viewer;
    const live = snapshotLive(m, isHome, { you: isHome ? home : away, opp: isHome ? away : home });
    const p = projectedSides(league, m, isHome, live, today);
    const [h, a] = isHome ? [p.you, p.opp] : [p.opp, p.you];
    sides[m.homeId] = { side: h, current: m.home.current };
    sides[m.awayId] = { side: a, current: m.away.current };
  } else {
    const o = observerSides(league, m, snapshotLive(m, true, { you: home, opp: away }), today);
    sides[m.homeId] = { side: o.home, current: m.home.current };
    sides[m.awayId] = { side: o.away, current: m.away.current };
  }
}
const r = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;
raw.seasonData = raw.seasonData ?? {};
raw.seasonData.currentWeekSides = Object.fromEntries(
  Object.entries(sides).map(([id, s]) => [
    id,
    {
      current: s.current,
      projMu: s.side.projMu.map((x) => r(x, 3)),
      projVar: s.side.projVar.map((x) => r(x, 4)),
      ...(s.side.projWk ? { projWk: s.side.projWk.map((x) => r(x, 4)) } : {}),
    },
  ])
);
console.log(`season step: this week's gauge sides for ${Object.keys(sides).length} teams (viewer ${nameOf.get(viewer)})`);

// 2. The season engine.
const inputs = league.seasonData.seasonInputs;
if (!inputs) {
  console.log("season step: no seasonInputs in this export - playoff odds left as they were");
} else {
  const t0 = Date.now();
  const engine = makeSeasonEngine(league, inputs, SIMS);
  const current: Record<number, Moments> = {};
  for (const [id, s] of Object.entries(sides)) current[Number(id)] = sideMoments(s.side, s.current);
  const odds = engine.run({ current, weeks: true });
  raw.seasonData.playoffOdds = oddsTable(league, inputs, odds);
  if (inputs.bracket?.finalists?.length) raw.seasonData.championshipFinalists = inputs.bracket.finalists;
  else delete raw.seasonData.championshipFinalists;
  console.log(`season step: ${SIMS} seasons in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const row of [...raw.seasonData.playoffOdds].sort((a, b) => b.playoffProb - a.playoffProb)) {
    console.log(
      `  ${row.teamName.padEnd(26)} playoffs ${row.playoffProb.toFixed(1).padStart(5)}%  title ${row.championshipProb.toFixed(1).padStart(5)}%`
    );
  }
}

writeFileSync(leaguePath, JSON.stringify(raw));
console.log(`season step: wrote ${leaguePath}`);
