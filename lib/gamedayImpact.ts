import type { LeagueData, TeamSide } from "./league";
import { shiftGames, sideMoments } from "./league";
import { remainingSide } from "./liveAdjust";
import { matchupOutcome, type MatchupOutcome, type Moments, type StatVector } from "./probability";
import type { TodayLine } from "./useLiveTotals";

/**
 * What tonight has done to your matchup (Game Day): the model's odds NOW against its odds
 * at TIP-OFF, so a 40-point night reads as "+9 points of win probability" rather than as
 * a box score you have to translate yourself.
 *
 * ONE MODEL (2026-11-09). Both numbers start from the SAME sides as the headline win
 * probability (useProjectedSides: injury odds, who starts, today's rosters). Tip-off is
 * those sides with tonight undone:
 *
 *   totals at tip-off = live totals - tonight's COUNTED lines (bench and IR never reached
 *                       the totals)
 *   projection        = each player's games shifted back up by the share of tonight's
 *                       game that remainingSide took out (lib/liveAdjust.ts)
 *
 * Until 2026-11-09 tip-off was rebuilt from the plain export sides (no injury odds, no
 * lineup recount) and subtracted from the full model, so "+X tonight" could read several
 * points before a single game had started.
 */
export interface NightImpact {
  /** Null until a game has started (no change to show). */
  start: MatchupOutcome | null;
  /** Tonight's counted production per side, in `stats` order. */
  tonightYou: StatVector;
  tonightOpp: StatVector;
  /** Totals at tip-off, in `stats` order. */
  startYou: StatVector;
  startOpp: StatVector;
}

/** The live inputs nightImpact reads — useLiveTotals' fields of the same names. */
export interface NightLive {
  you: StatVector;
  opp: StatVector;
  youToday: TodayLine[] | null;
  oppToday: TodayLine[] | null;
  gameLeft: Record<string, number> | null;
}

/** P(win the week), ties split. */
export const winShare = (o: MatchupOutcome) => o.win + o.tie / 2;

export function sumCounted(lines: TodayLine[] | null, width: number): StatVector {
  const out = new Array(width).fill(0);
  for (const l of lines ?? []) {
    if (!l.counted || !l.v) continue;
    for (let i = 0; i < width; i++) out[i] += l.v[i] ?? 0;
  }
  return out;
}

/**
 * Per player, the games remainingSide took out for the played share of tonight's game:
 * his count with every game tonight fresh minus his count now. `raw` is the side BEFORE
 * remainingSide (today's roster), so this is exactly what the live projection removed.
 */
function tonightPlayed(
  league: LeagueData,
  raw: TeamSide,
  gameLeft: Record<string, number> | null
): Map<string, number> {
  const out = new Map<string, number>();
  if (!gameLeft) return out;
  const fresh = Object.fromEntries(Object.keys(gameLeft).map((k) => [k, 1]));
  const now = new Map(remainingSide(league, raw, null, gameLeft).players.map((p) => [p.name, p.gamesLeft]));
  for (const p of remainingSide(league, raw, null, fresh).players) {
    const d = p.gamesLeft - (now.get(p.name) ?? p.gamesLeft);
    if (d > 1e-9) out.set(p.name, d);
  }
  return out;
}

/** A side's moments with the named players' tonight put back (projection only). */
function undoGames(
  league: LeagueData,
  side: TeamSide,
  totals: StatVector,
  played: Map<string, number>,
  only?: string
): Moments {
  let m = sideMoments(side, totals);
  for (const p of side.players) {
    if (only != null && p.name !== only) continue;
    const d = played.get(p.name);
    if (d) m = shiftGames(league, m, p, p.gamesLeft, d);
  }
  return m;
}

const anyLine = (live: NightLive) =>
  [...(live.youToday ?? []), ...(live.oppToday ?? [])].some((l) => l.v);

/**
 * `you` / `opp`: the win probability's sides (useProjectedSides). `youRaw` / `oppRaw`:
 * the same sides before remainingSide (liveRoster of the export), to know what tonight
 * took out of each player's projection.
 */
export function nightImpact(
  league: LeagueData,
  you: TeamSide,
  opp: TeamSide,
  youRaw: TeamSide,
  oppRaw: TeamSide,
  live: NightLive
): NightImpact {
  const width = league.stats.length;
  const tonightYou = sumCounted(live.youToday, width);
  const tonightOpp = sumCounted(live.oppToday, width);
  const startYou = live.you.map((x, i) => Math.max(0, x - tonightYou[i]));
  const startOpp = live.opp.map((x, i) => Math.max(0, x - tonightOpp[i]));

  let start: MatchupOutcome | null = null;
  if (live.youToday && live.oppToday && anyLine(live)) {
    start = matchupOutcome(
      league,
      undoGames(league, you, startYou, tonightPlayed(league, youRaw, live.gameLeft)),
      undoGames(league, opp, startOpp, tonightPlayed(league, oppRaw, live.gameLeft))
    );
  }
  return { start, tonightYou, tonightOpp, startYou, startOpp };
}
