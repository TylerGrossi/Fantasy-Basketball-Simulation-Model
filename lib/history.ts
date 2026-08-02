/**
 * Season history derived from `periodResults` — every team's final category totals for
 * every completed scoring period.
 *
 * That block is the most under-used thing in the export: 22 weeks × 10 teams × 14 stats,
 * checked in and read by almost nothing. Everything here is a reduction over it, computed
 * on the server so the page ships numbers rather than the 22 KB it took to derive them.
 *
 * The category comparison reuses `scoreboardRows` + `categoryRecord`, the same pair the
 * live Scoreboard uses. A second implementation of "who won this category" would be a
 * second thing to keep in step with the league's scoring rules, and this one is already
 * validated against real weeks.
 */

import {
  categoryRecord,
  periodLabel,
  scoreboardRows,
  type LeagueData,
  type PeriodResult,
} from "./league";

export interface WeekRow {
  period: number;
  label: string;
  /** Null when this team had no game that period. */
  opponentId: number | null;
  opponentName: string;
  /** The matchup as played: categories won, lost, tied against the actual opponent. */
  actual: { win: number; loss: number; tie: number } | null;
  /** Whether that scoreline counts as a win — the league's own rule, most categories. */
  result: "W" | "L" | "T" | null;
  /** Against ALL other teams that week, not just the one drawn. */
  allPlay: { win: number; loss: number; tie: number };
  /** All-play CATEGORY win rate, ties worth a half. Comparable to the standings figure. */
  allPlayPct: number;
  /**
   * Share of the league you would have BEATEN that week — a drawn matchup counts a half.
   *
   * Not the same thing as `allPlayPct`, and the distinction is the whole point: that one
   * counts category comparisons, this one counts matchups. Winning 68% of categories wins
   * far more than 68% of weeks, because a matchup only needs a majority. This is the
   * number that answers "would I have won this week against a random opponent".
   */
  beat: number;
  /**
   * What the schedule did to you that week: +1 you won a week an average opponent
   * would have beaten you in, −1 you lost one you'd usually win, 0 the draw was fair.
   */
  luck: 1 | -1 | 0;
}

export interface SeasonHistory {
  weeks: WeekRow[];
  actual: { win: number; loss: number; tie: number };
  /** Record you'd hold if every week were played against the whole league. */
  expected: { win: number; loss: number; tie: number };
  allPlayPct: number;
  /** Weeks won on the draw, and weeks lost to it. */
  luckyWeeks: WeekRow[];
  unluckyWeeks: WeekRow[];
}

const empty = () => ({ win: 0, loss: 0, tie: 0 });

/**
 * One team's week-by-week story: what happened, and what would have happened against
 * the field.
 *
 * The Season Summary already reports season all-play as a single percentage. This is the
 * same arithmetic kept per week, which is what turns "you were unlucky" into "these three
 * weeks were the unlucky ones".
 */
export function weeklyAllPlay(league: LeagueData, teamId: number): SeasonHistory {
  const names = new Map(league.teams.map((t) => [t.id, t.name]));
  const periods = dedupePlayoffEchoes(
    [...(league.periodResults ?? [])].sort((a, b) => a.period - b.period),
    teamId
  );

  const weeks: WeekRow[] = [];
  for (const p of periods) {
    const mine = vectorFor(p, teamId);
    if (!mine) continue;

    // Everyone who actually played that week, so a bye can't count as a free win.
    const others: Array<{ id: number; vec: number[] }> = [];
    for (const g of p.games) {
      if (g.homeId !== teamId) others.push({ id: g.homeId, vec: g.home });
      if (g.awayId !== teamId) others.push({ id: g.awayId, vec: g.away });
    }

    const all = empty();
    // Matchups won against the field, a drawn one counting a half.
    let beaten = 0;
    for (const o of others) {
      const rec = categoryRecord(scoreboardRows(league, mine.vec, o.vec));
      all.win += rec.win;
      all.loss += rec.loss;
      all.tie += rec.tie;
      if (rec.win > rec.loss) beaten += 1;
      else if (rec.win === rec.loss) beaten += 0.5;
    }
    const total = all.win + all.loss + all.tie;
    const pct = total ? (all.win + 0.5 * all.tie) / total : 0;
    const beat = others.length ? beaten / others.length : 0;

    const oppVec = mine.oppId == null ? null : vectorFor(p, mine.oppId)?.vec ?? null;
    const actual = oppVec ? categoryRecord(scoreboardRows(league, mine.vec, oppVec)) : null;
    const result = actual
      ? actual.win > actual.loss
        ? "W"
        : actual.win < actual.loss
          ? "L"
          : "T"
      : null;

    // Judged on MATCHUPS beaten, not categories won. On the category rate a week could
    // read 54% — apparently unlucky to lose — while you would in fact have lost to five
    // of the nine opponents that week. "Would most of the league have beaten you" is a
    // matchup question, so `beat` is what answers it.
    const luck: 1 | -1 | 0 =
      result === "W" && beat < 0.5 ? 1 : result === "L" && beat > 0.5 ? -1 : 0;

    weeks.push({
      period: p.period,
      label: periodLabel(league, p.period),
      opponentId: mine.oppId,
      opponentName: mine.oppId == null ? "—" : (names.get(mine.oppId) ?? "Unknown"),
      actual,
      result,
      allPlay: all,
      allPlayPct: pct,
      beat,
      luck,
    });
  }

  const actual = empty();
  for (const w of weeks) {
    if (w.result === "W") actual.win += 1;
    else if (w.result === "L") actual.loss += 1;
    else if (w.result === "T") actual.tie += 1;
  }

  const season = weeks.reduce(
    (a, w) => ({
      win: a.win + w.allPlay.win,
      loss: a.loss + w.allPlay.loss,
      tie: a.tie + w.allPlay.tie,
    }),
    empty()
  );
  const seasonTotal = season.win + season.loss + season.tie;
  const allPlayPct = seasonTotal ? (season.win + 0.5 * season.tie) / seasonTotal : 0;

  /**
   * The record the season "should" have produced: the sum of each week's probability of
   * beating a random opponent.
   *
   * This used to be `allPlayPct * weeks`, which mixed units — a CATEGORY win rate applied
   * to MATCHUP outcomes. It read 14-7 for a season where 18 of 21 weeks would have beaten
   * most of the league, because 68% of categories is not 68% of weeks; summed properly
   * the same season expects 17 wins. Per-week probabilities also beat a simple
   * over/under-50% count, which would score a 61% week and a 100% week identically.
   */
  const played = weeks.filter((w) => w.result);
  const expWin = Math.round(played.reduce((a, w) => a + w.beat, 0));
  const expected = { win: expWin, loss: played.length - expWin, tie: 0 };

  return {
    weeks,
    actual,
    expected,
    allPlayPct,
    luckyWeeks: weeks.filter((w) => w.luck === 1),
    unluckyWeeks: weeks.filter((w) => w.luck === -1),
  };
}

/**
 * Drop the second copy of a playoff matchup.
 *
 * A playoff round spans TWO scoring periods, and the export carries a row for each — so
 * this league's Round 2 appears as period 21 AND period 22, same opponent, byte-identical
 * totals (1913 points both times). Counted naively that is a phantom extra week: it
 * inflated the season record by a win and added 135 fake category comparisons to the
 * all-play total.
 *
 * The test is deliberately strict — same opponent AND an identical stat vector — so it
 * can only ever collapse a genuine duplicate, never two real weeks that happened to be
 * played against the same team. The LATER period survives, because that is the one whose
 * label resolves to the correct round.
 */
function dedupePlayoffEchoes(periods: PeriodResult[], teamId: number): PeriodResult[] {
  const out: PeriodResult[] = [];
  for (const p of periods) {
    const mine = vectorFor(p, teamId);
    const prev = out.length ? vectorFor(out[out.length - 1], teamId) : null;
    const echo =
      mine &&
      prev &&
      mine.oppId === prev.oppId &&
      mine.vec.length === prev.vec.length &&
      mine.vec.every((v, i) => v === prev.vec[i]);
    if (echo) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/** This team's totals for a period, plus who they were drawn against. */
function vectorFor(
  p: PeriodResult,
  teamId: number
): { vec: number[]; oppId: number | null } | null {
  for (const g of p.games) {
    if (g.homeId === teamId) return { vec: g.home, oppId: g.awayId };
    if (g.awayId === teamId) return { vec: g.away, oppId: g.homeId };
  }
  return null;
}
