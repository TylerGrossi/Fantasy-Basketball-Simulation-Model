/**
 * Shapes of the generated league.json (see scripts/build_data.py) and the helpers that
 * turn it into what the Scoreboard renders.
 */

import type { LeagueMeta, Moments, StatVector } from "./probability";
import { matchupOutcome, withCurrentTotals } from "./probability";

export interface PlayerRow {
  name: string;
  nbaTeam: string;
  gamesLeft: number;
  /** Per-game averages (season blended with last 30). Moments derive from this. */
  avg: StatVector;
  status: string;
  injured: boolean;
}

/** A waiver-pool player. Same shape as PlayerRow minus roster-only fields. */
export interface FreeAgent {
  name: string;
  nbaTeam: string;
  gamesLeft: number;
  avg: StatVector;
  status: string;
}

export interface TeamSide {
  players: PlayerRow[];
  /** Projected REMAINING production. Zero for a completed period. */
  projMu: StatVector;
  projVar: StatVector;
  /** Snapshot of banked totals; api/live supersedes this. */
  current: StatVector;
}

export interface Matchup {
  homeId: number;
  awayId: number;
  home: TeamSide;
  away: TeamSide;
}

/** Used/max for one team's "Matchup Acquisition Limit" — ESPN's own box-score line. */
export interface AcquisitionSummary {
  used: number;
  max: number;
}

/** One finished matchup: final banked totals only, no rosters. */
export interface PeriodGame {
  homeId: number;
  awayId: number;
  home: StatVector;
  away: StatVector;
  /**
   * Acquisitions used against this matchup's allowance. Optional: absent when the
   * exporter couldn't resolve the ESPN matchupPeriodId, the date window, or the raw
   * transaction counter for that team — never a guessed number.
   */
  homeAcq?: AcquisitionSummary;
  awayAcq?: AcquisitionSummary;
}

export interface PeriodResult {
  period: number;
  games: PeriodGame[];
}

export interface Team {
  id: number;
  name: string;
  abbrev: string;
  wins: number;
  losses: number;
  ties: number;
  standing: number;
}

export interface StandingRow {
  teamId: number;
  teamName: string;
  standing: number;
  /**
   * ESPN's final placing once the bracket is done — the number the league actually
   * remembers, which is NOT the category-record order (`standing`). Optional because
   * it is 0/absent mid-season and in exports built before it was added.
   */
  finalStanding?: number;
  wins: number;
  losses: number;
  ties: number;
  winPct: number;
  allPlayWins: number;
  allPlayLosses: number;
  allPlayTies: number;
  /** All-play win rate: how you'd score against the whole league every week. */
  allPlayPct: number;
  /** Actual wins minus all-play expectation — schedule luck, not skill. */
  luck: number;
  /**
   * Roster churn for the season. Optional because exports built before these were added
   * don't carry them — the column hides itself rather than printing zeros that would
   * read as "this manager never touched their team".
   */
  acquisitions?: number;
  drops?: number;
  trades?: number;
  /**
   * Roster-management moves ESPN counts separately from acquisitions: activating a
   * bench spot, stashing someone on IR. Optional for the same reason as the three
   * above - absent on an export built before they were added.
   */
  moveToActive?: number;
  moveToIR?: number;
  catTotals: Record<string, number>;
}

export interface PowerRankingRow {
  teamId: number;
  teamName: string;
  rank: number;
  prevRank: number;
  delta: number;
  powerPct: number;
  recentPct: number;
  form: string;
  sos: number;
  record: number[];
  rankHistory: number[];
}

export interface ScheduleRow {
  period: number;
  matchup: string;
  result: string;
  score: string;
  winPct: string;
  opponent: string;
  manager: string;
}

export interface PlayoffOddsRow {
  teamId: number;
  teamName: string;
  playoffProb: number;
  advanceProb: number;
  championshipProb: number;
  inPlayoffs: boolean;
  record: number[];
  /**
   * Chance of finishing on each seed, keyed by seed number as a string, plus
   * `no_playoffs`. Only meaningful before the bracket starts — optional because it is
   * absent from exports built before it was added.
   */
  seedProbs?: Record<string, number>;
}

export interface PoolPlayer {
  name: string;
  nbaTeam: string;
  position: string;
  /**
   * Every position ESPN considers this player eligible for ("PG/SG" players carry
   * both), not just the single default `position` above. Optional because exports
   * built before this field existed won't have it — callers that need it should fall
   * back to `[position]`.
   */
  eligibleSlots?: string[];
  /** Fantasy team that owns them, or "" / "Waivers" when free. */
  owner: string;
  status: string;
  playerId: number | null;
  /**
   * Current starting-lineup slot ("PG", "Bench", "IR", ...) and how the player was
   * added to their roster ("Draft", "Free Agency", "Waiver", "Trade"). Both are "" for a
   * free agent (never rostered) and for exports built before these fields were added.
   */
  lineupSlot?: string;
  acquisitionType?: string;
  /** 9-cat value: standard deviations above/below a replacement-level player. */
  value: number;
  recent: number;
  trend: number;
  recent15: number;
  trend15: number;
  fgPct: number;
  ftPct: number;
  tpPct: number;
  PTS: number; REB: number; AST: number; STL: number; BLK: number;
  "3PM": number; TO: number; FGM: number; FGA: number; FTM: number;
  FTA: number; "3PA": number; DD: number;
  /**
   * The three fields below exist for the draft projection (`lib/projection.ts`) and are
   * all OPTIONAL, because an export built before they were added must degrade rather
   * than crash — and because two of them can genuinely be missing for a real player.
   */
  /** Games behind the season line above: its sample size. */
  gp?: number;
  /** Age and NBA seasons completed, from ESPN's NBA rosters. Absent for a player not
   *  on one (retired, overseas, two-way churn) — the projection treats that as "peak". */
  age?: number;
  exp?: number;
  /** The recent windows' own per-game lines, plus each window's `gp`. Absent when the
   *  player had no games in that window — which is NOT the same as a line of zeros, and
   *  is why the Player Card falls back to the season line rather than printing noughts. */
  last30?: Partial<Record<string, number>> & { gp?: number };
  last15?: Partial<Record<string, number>> & { gp?: number };
  /**
   * Up to three seasons of career per-game history, NEWEST FIRST, from ESPN's athlete
   * pages (scripts/build_data.py `fetch_player_history`).
   *
   * Carries `min`, which nothing else in the export does — and minutes are what let the
   * draft projection separate the three things a single season conflates: production per
   * minute, the minutes a role gives you, and the games you were available for. Absent
   * for a player ESPN has no career page for; the projection falls back to a
   * single-season path.
   */
  history?: SeasonLine[];
  /**
   * ESPN's own published rankings for the season being drafted FOR, plus live ADP — the
   * outside opinion the draft board is measured against.
   *
   * `espnRank` is the **ROTO** rank, which is the one that matches this league's category
   * scoring; `espnStdRank` is the points-league rank, carried only so the two can be
   * compared (Giannis is STANDARD 3 and ROTO 15 — the gap IS the format). `adp` is what
   * drafters actually do, which is a different signal from what a ranker says.
   *
   * All optional: ESPN ranks about 260 of the ~290 pool and publishes these only once the
   * next fantasy season has rolled over.
   */
  espnRank?: number;
  espnStdRank?: number;
  adp?: number;
}

/** One past season's per-game line. `min` is minutes per game. */
export interface SeasonLine {
  season: number;
  gp: number;
  min: number;
  FGM: number; FGA: number; FTM: number; FTA: number;
  "3PM": number; "3PA": number;
  REB: number; AST: number; STL: number; BLK: number; TO: number; PTS: number;
}

export interface SeasonPlayerLine {
  name: string;
  gp: number;
  [stat: string]: number | string;
}

export interface TeamSeasonStats {
  totals: Record<string, number>;
  players: SeasonPlayerLine[];
}

export interface RecentMoveRow {
  /** ISO timestamp. */
  date: string;
  team: string;
  /** "Add" / "Waiver Add" / "Drop" / "Trade" / "Moved", or a title-cased fallback for an
   *  ESPN action type not in the known set. */
  action: string;
  player: string;
  /** Roster slot the player was moved into/out of, when ESPN reports one. */
  position: string;
}

export interface SeasonData {
  playerPool?: PoolPlayer[];
  /** Keyed by team id (string, since JSON keys are strings). */
  teamSeasonStats?: Record<string, TeamSeasonStats>;
  standings?: StandingRow[];
  powerRankings?: { weeks: number[]; teams: PowerRankingRow[] };
  /** Keyed by team id (as a string, since JSON keys are strings). */
  schedules?: Record<string, ScheduleRow[]>;
  playoffOdds?: PlayoffOddsRow[];
  championshipFinalists?: number[];
  /** League-wide add/drop/trade feed, newest first. */
  recentMoves?: RecentMoveRow[];
}

export interface LeagueData extends LeagueMeta {
  generatedAt: string;
  season: number;
  /** The ESPN league's own name. Optional — older exports predate it. */
  leagueName?: string;
  leaguePeriod: number;
  period: number;
  seasonOver: boolean;
  /** Weeks before the playoffs start. Optional — older exports predate it. */
  regularSeasonWeeks?: number;
  /** How many playoff rounds follow them. Optional — older exports predate it. */
  playoffRounds?: number;
  /**
   * The roster's slot shape, one entry per spot and in board order:
   * `["PG", "SG", ..., "UTIL", "UTIL", "UTIL", "Bench", ...]`. Read by the League
   * Rosters board so it can draw an empty row for an unfilled spot. Optional — older
   * exports predate it, and the board then just lists the players it has.
   */
  rosterSlots?: string[];
  /** Per-stat variance factor. The one source for turning averages into moments. */
  variance: number[];
  statIds: Record<string, number>;
  teams: Team[];
  matchups: Matchup[];
  freeAgents: FreeAgent[];
  /** Final totals for every completed week. Optional — older exports predate it. */
  periodResults?: PeriodResult[];
  /** Season-wide data. `season` above is the YEAR — do not confuse them. */
  seasonData: SeasonData;
}

/**
 * What to call a matchup period: "Matchup 12", or "Playoff Round 2".
 *
 * THE ONLY PLACE A PERIOD GETS A NAME. The week menu used to label past weeks with the
 * string ESPN wrote into the export ("Matchup 18", "Playoff Round 1") and the current
 * week with this function, which then said "Playoffs · Round 2" — so one list held two
 * naming schemes and the last two playoff entries looked like different kinds of thing.
 * The wording here now matches ESPN's, which is what the Schedule page shows too; label
 * every period through this function and the question can't come back.
 *
 * A playoff round spans TWO scoring periods, so the round is found by halving the
 * distance past the regular season — the same arithmetic as `resolve_view_window` in
 * the legacy app, deliberately, because both period 22 and period 23 are round 2 and
 * an exact reverse lookup of the period→label map would miss one of them. (The
 * offseason export pins `period` to 23, so this is not a hypothetical.)
 *
 * The two constants ride along in the export; the defaults here only cover exports
 * built before they were added.
 */
export function periodLabel(league: LeagueData, period = league.period): string {
  const weeks = league.regularSeasonWeeks ?? 19;
  const rounds = league.playoffRounds ?? 2;
  if (period > weeks) {
    const round = Math.floor((period - weeks - 1) / 2) + 1;
    if (round >= 1 && round <= rounds) return `Playoff Round ${round}`;
    return "Playoffs";
  }
  return `Matchup ${period}`;
}

/**
 * One player's (mu, variance) contribution over their remaining games.
 *
 *   mu  = games * avg
 *   var = games * (avg * varianceFactor)^2
 *
 * Derived here rather than shipped, so the formula has exactly one home. Variances add
 * across independent players — that identity is what makes "drop A, add B" a subtraction
 * instead of a re-simulation.
 */
export function playerMoments(
  avg: StatVector,
  gamesLeft: number,
  variance: number[]
): Moments {
  const g = Math.max(0, gamesLeft);
  return {
    mu: avg.map((a) => a * g),
    var: avg.map((a, i) => g * Math.pow(a * variance[i], 2)),
  };
}

const RATIO_PAIRS: Record<string, [string, string]> = {
  "FG%": ["FGM", "FGA"],
  "FT%": ["FTM", "FTA"],
  "3P%": ["3PM", "3PA"],
};

/** The value shown for a scored category, derived from the raw stat vector. */
export function categoryValue(
  stats: string[],
  vec: StatVector,
  cat: string
): number {
  const pair = RATIO_PAIRS[cat];
  if (pair) {
    const made = vec[stats.indexOf(pair[0])] ?? 0;
    const att = vec[stats.indexOf(pair[1])] ?? 0;
    return att > 0 ? made / att : 0;
  }
  return vec[stats.indexOf(cat)] ?? 0;
}

/** `48.7%` not `0.4868`; thousands separators on counting stats. */
export function formatValue(cat: string, v: number): string {
  if (cat.includes("%")) return `${(v * 100).toFixed(1)}%`;
  return Math.round(v).toLocaleString("en-US");
}

export interface ScoreboardRow {
  cat: string;
  you: number;
  opp: number;
  youStr: string;
  oppStr: string;
  /** Signed relative margin, + = you ahead. TO is inverted. */
  margin: number;
  marginStr: string;
  youWins: boolean;
  oppWins: boolean;
  /** Bar width as a percentage of the half-track. */
  width: number;
}

/**
 * Build the scoreboard rows.
 *
 * The bar encodes MARGIN, not the magnitude split — a magnitude split sits near 50/50 for
 * every category regardless of how lopsided the matchup is (measured: a real 10-5 week
 * spanned only 38.7-56.5% while true margins ran +0.9% to -45%). Normalised to the
 * biggest margin in this matchup, floored at 10% so an all-close week doesn't render
 * hairline leads as full-width bars.
 */
export function scoreboardRows(
  meta: LeagueMeta,
  youVec: StatVector,
  oppVec: StatVector
): ScoreboardRow[] {
  const lower = new Set(meta.lowerIsBetter);

  const raw = meta.categories.map((cat) => {
    const you = categoryValue(meta.stats, youVec, cat);
    const opp = categoryValue(meta.stats, oppVec, cat);
    const mid = (you + opp) / 2;
    let margin = mid === 0 ? 0 : (you - opp) / mid;
    if (lower.has(cat)) margin = -margin;
    return { cat, you, opp, margin };
  });

  const peak = Math.max(0.1, ...raw.map((r) => Math.abs(r.margin)));

  return raw.map(({ cat, you, opp, margin }) => {
    const isLower = lower.has(cat);
    const youWins = isLower ? you < opp : you > opp;
    const oppWins = isLower ? opp < you : opp > you;
    let width = margin === 0 ? 0 : Math.min(100, (Math.abs(margin) / peak) * 100);
    if (width > 0 && width < 1.5) width = 1.5;
    return {
      cat,
      you,
      opp,
      youStr: formatValue(cat, you),
      oppStr: formatValue(cat, opp),
      margin,
      // One decimal below 10%: on a category won by 0.9% the precision IS the point.
      marginStr:
        margin === 0
          ? "TIED"
          : `${margin > 0 ? "+" : ""}${(margin * 100).toFixed(
              Math.abs(margin) < 0.1 ? 1 : 0
            )}%`,
      youWins,
      oppWins,
      width,
    };
  });
}

export function categoryRecord(rows: ScoreboardRow[]) {
  let win = 0;
  let loss = 0;
  let tie = 0;
  for (const r of rows) {
    if (r.youWins) win++;
    else if (r.oppWins) loss++;
    else tie++;
  }
  return { win, loss, tie };
}

/** Combine a side's cached projection with (possibly live) current totals. */
export function sideMoments(side: TeamSide, current: StatVector): Moments {
  return withCurrentTotals({ mu: side.projMu, var: side.projVar }, current);
}

/** Live win probability for a matchup, given whatever current totals we have. */
export function winProbability(
  meta: LeagueMeta,
  side: TeamSide,
  oppSide: TeamSide,
  current: StatVector,
  oppCurrent: StatVector
) {
  return matchupOutcome(
    meta,
    sideMoments(side, current),
    sideMoments(oppSide, oppCurrent)
  );
}
