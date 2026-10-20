/**
 * Server-only: the 2026-27 draft, graded — one implementation shared by the Draft Recap's
 * season route (app/api/draft/season) and the Agent's draft tools, so the page and the
 * chat can never disagree about who won the draft.
 *
 * Inputs: the picks from ESPN (lib/espnDraft.ts) and public/data/draft.json (projections).
 * Scoring is NEUTRAL — the league's categories, equal weights, no punts — because it judges
 * every team. Ranking is by projected value (round-weighted value over replacement); the
 * season simulation (lib/seasonSim.ts) adds projected record and playoff odds.
 *
 * The simulation is the expensive part (~seconds for 10,000 seasons), so the whole result
 * is cached in memory, keyed on the model version, the sim count, the export and the picks.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DraftData } from "./draft";
import { fetchDraftFeed, type DraftFeed } from "./espnDraft";
import { scoreProjections, type DraftRow } from "./projection";
import {
  HIGHLIGHT_MAX_ROUND,
  SIM_VERSION,
  replacementLine,
  roundWeight,
  simulateSeason,
  type SeasonResult,
  type SimPlayer,
} from "./seasonSim";

export const SEASON_SIMS = 10000;

export interface DraftedPick {
  pick: number;
  round: number;
  r: DraftRow;
  /** pick - ADP: positive = taken later than the room usually takes him (a steal). */
  vsAdp: number | null;
}

export interface GradedTeam {
  id: number;
  name: string;
  mine: boolean;
  picks: DraftedPick[];
  projValue: number;
  steal?: DraftedPick;
  reach?: DraftedPick;
  place: number;
  season?: SeasonResult;
}

export interface DraftSeason {
  data: DraftData;
  feed: DraftFeed;
  rows: DraftRow[];
  teams: GradedTeam[];
  results: SeasonResult[];
}

let cache: { key: string; value: DraftSeason } | null = null;

export async function loadDraftData(): Promise<DraftData> {
  const file = path.join(process.cwd(), "public", "data", "draft.json");
  return JSON.parse(await readFile(file, "utf8")) as DraftData;
}

/** Neutral board rows: league categories, no weights, no punts. */
export function neutralRows(data: DraftData): DraftRow[] {
  const { league, lines } = data;
  return scoreProjections(lines, {
    categories: league.categories,
    lowerIsBetter: league.lowerIsBetter,
    poolSize: (league.teams.length || 8) * (league.rounds || 13),
    rankBy: "total",
  });
}

/** The graded draft, or null when ESPN has not published picks yet. */
export async function getDraftSeason(): Promise<DraftSeason | null> {
  const feed = await fetchDraftFeed();
  if (!feed.picks.length) return null;
  const data = await loadDraftData();
  const key =
    `v${SIM_VERSION}|${SEASON_SIMS}|${data.generatedAt}|` +
    feed.picks.map((p) => `${p.pick}:${p.teamId}:${p.playerId}`).join(",");
  if (cache && cache.key === key) return cache.value;

  const { league } = data;
  const rows = neutralRows(data);
  const byId = new Map(rows.map((r) => [r.playerId, r]));

  const teams: GradedTeam[] = feed.teams.map((t) => {
    const picks: DraftedPick[] = feed.picks
      .filter((p) => p.teamId === t.id)
      .map((p) => {
        const r = byId.get(p.playerId);
        return r ? { pick: p.pick, round: p.round, r, vsAdp: r.adp != null ? p.pick - r.adp : null } : null;
      })
      .filter((x): x is DraftedPick => x != null)
      .sort((a, b) => a.pick - b.pick);
    const early = picks
      .filter((x) => x.round <= HIGHLIGHT_MAX_ROUND && x.vsAdp != null)
      .sort((a, b) => (b.vsAdp ?? 0) * roundWeight(b.round) - (a.vsAdp ?? 0) * roundWeight(a.round));
    const steal = early[0] && (early[0].vsAdp ?? 0) > 0 ? early[0] : undefined;
    const last = early[early.length - 1];
    const reach = last && (last.vsAdp ?? 0) < 0 ? last : undefined;
    return {
      id: t.id,
      name: t.name || t.abbrev,
      mine: t.id === feed.myTeamId,
      picks,
      projValue: picks.reduce((a, x) => a + x.r.total * roundWeight(x.round), 0),
      steal,
      reach,
      place: 0,
    };
  });
  [...teams].sort((a, b) => b.projValue - a.projValue).forEach((t, i) => (t.place = i + 1));

  const rosters = new Map<number, SimPlayer[]>(
    teams.map((t) => [t.id, t.picks.map((x) => ({ line: x.r, weight: roundWeight(x.round) }))])
  );
  const drafted = new Set(feed.picks.map((p) => p.playerId));
  const repl = replacementLine(rows.filter((r) => r.playerId == null || !drafted.has(r.playerId)));
  const results = simulateSeason(
    rosters,
    league.schedule ?? [],
    league.categories,
    league.lowerIsBetter,
    repl,
    league.playoffTeams || 4,
    SEASON_SIMS
  );
  const byTeam = new Map(results.map((x) => [x.team, x]));
  for (const t of teams) t.season = byTeam.get(t.id);

  const value: DraftSeason = { data, feed, rows, teams: teams.sort((a, b) => a.place - b.place), results };
  cache = { key, value };
  return value;
}

/** Letter grade from a place, same scale as the Recap page. */
export function gradeFor(place: number, teams: number): string {
  const f = (place - 1) / Math.max(1, teams - 1);
  if (f <= 0) return "A+";
  if (f <= 0.15) return "A";
  if (f <= 0.3) return "B+";
  if (f <= 0.45) return "B";
  if (f <= 0.6) return "C+";
  if (f <= 0.75) return "C";
  if (f < 1) return "D";
  return "F";
}
