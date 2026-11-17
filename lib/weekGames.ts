import type { LeagueData } from "@/lib/league";
import type { BoxScores } from "@/lib/loadLeague";
import { countedGames, type SeasonInputs, type SeasonPlayer } from "@/lib/seasonOdds";

/**
 * Games played per team in one matchup week: yours, your opponent's, and the league
 * average. Feeds the Schedule page's GP columns.
 *
 * - A FINISHED week is the box scores' count (boxscores.json): counted lines only, so a
 *   benched or IR player's game is not in it, the same as ESPN's own GP.
 * - A FUTURE week is a projection by the season engine's own rule (`countedGames`:
 *   13 active by value, 10 starters a day, injury-aware game days), so it is the same
 *   games the projected scores and win % on that row were built from.
 * - The CURRENT week is the games banked so far plus the projected games on the days
 *   after the export's day. Both halves come from the same export run, so they never
 *   overlap or leave a gap.
 */
export interface WeekGames {
  mine: number | null;
  opp: number | null;
  /** Mean over every team that played (or is scheduled) that week. */
  avg: number | null;
  /** True when any part of it is a projection. */
  proj: boolean;
}

const sumGp = (lines: Array<{ gp: number }> | undefined) =>
  lines ? lines.reduce((s, l) => s + (Number(l.gp) || 0), 0) : null;

/** The export's calendar date in Eastern time, "YYYY-MM-DD". */
function easternDate(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function weekGames(
  league: LeagueData,
  box: BoxScores | null,
  teamId: number,
  periods: number[]
): Map<number, WeekGames> {
  const out = new Map<number, WeekGames>();
  const inputs = league.seasonData?.seasonInputs as SeasonInputs | undefined;

  // Opponent per period: finished weeks from the results, future ones from the schedule.
  const oppOf = new Map<number, number>();
  for (const p of league.periodResults ?? []) {
    for (const g of p.games) {
      if (g.homeId === teamId) oppOf.set(p.period, g.awayId);
      if (g.awayId === teamId) oppOf.set(p.period, g.homeId);
    }
  }
  for (const w of inputs?.schedule ?? []) {
    for (const [a, b] of w.pairs) {
      if (a === teamId) oppOf.set(w.period, b);
      if (b === teamId) oppOf.set(w.period, a);
    }
  }

  // The weeks a period's projection spans: a playoff round is two NBA weeks.
  const spanOf = (period: number) =>
    inputs?.playoffWeeks.find((r) => r[0] === period) ?? [period];

  // Projected counted games per team over `weeks`, optionally only days after `afterDay`
  // in the current week.
  const projected = (weeks: number[], afterDay: number | null) => {
    const res = new Map<number, number>();
    if (!inputs) return res;
    for (const t of inputs.teams) {
      let total = 0;
      for (const w of weeks) {
        const key = String(w);
        const players: SeasonPlayer[] =
          afterDay == null || w !== inputs.currentWeek
            ? t.players
            : t.players.map((p) => ({
                ...p,
                days: { ...p.days, [key]: (p.days[key] ?? []).filter((d) => d > afterDay) },
              }));
        for (const n of countedGames(players, w, inputs.rosterCap, inputs.dailyCap).values()) total += n;
      }
      res.set(t.id, total);
    }
    return res;
  };

  // Day index of the export within the current week (0 = the week's first day).
  let exportDay: number | null = null;
  const start = league.weekSchedule?.start;
  const exported = box?.generatedAt ? easternDate(box.generatedAt) : null;
  if (start && exported) {
    exportDay = Math.round(
      (Date.parse(`${exported}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000
    );
  }

  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

  for (const period of periods) {
    const opp = oppOf.get(period) ?? null;
    const banked = box?.periods?.[String(period)];
    const isCurrent = !league.seasonOver && inputs != null && period === inputs.currentWeek;
    const isFuture = !league.seasonOver && inputs != null && period > inputs.currentWeek;

    if (banked && !isCurrent) {
      // Finished week: actual counts.
      const per = Object.entries(banked).map(([id, lines]) => [Number(id), sumGp(lines) ?? 0] as const);
      const by = new Map(per);
      out.set(period, {
        mine: by.get(teamId) ?? null,
        opp: opp == null ? null : (by.get(opp) ?? null),
        avg: mean(per.map(([, n]) => n)),
        proj: false,
      });
      continue;
    }

    if (isCurrent) {
      // Banked so far + what is left after the export's day. Without a usable export day
      // the remaining half can't be placed, so show the banked games alone.
      const rest = exportDay != null && exportDay >= 0 ? projected([period], exportDay) : new Map<number, number>();
      const ids = inputs!.teams.map((t) => t.id);
      const total = (id: number) => (sumGp(banked?.[String(id)]) ?? 0) + (rest.get(id) ?? 0);
      out.set(period, {
        mine: total(teamId),
        opp: opp == null ? null : total(opp),
        avg: mean(ids.map(total)),
        proj: rest.size > 0,
      });
      continue;
    }

    if (isFuture) {
      const by = projected(spanOf(period), null);
      if (!by.size) continue;
      out.set(period, {
        mine: by.get(teamId) ?? null,
        opp: opp == null ? null : (by.get(opp) ?? null),
        avg: mean([...by.values()]),
        proj: true,
      });
    }
  }
  return out;
}
