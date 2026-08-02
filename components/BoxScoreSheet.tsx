import {
  categoryValue,
  formatValue,
  type AcquisitionSummary,
  type LeagueData,
} from "@/lib/league";
import type { BoxLine } from "@/lib/loadLeague";

/**
 * The pieces of ESPN's own box-score page — category sheet, acquisition line, per-player
 * table — shared between the CURRENT week (Scoreboard.tsx, live) and a completed one
 * (WeekRecap.tsx, static). Both used to build their own copies of this; a column fixed in
 * one silently stayed wrong in the other. Pure presentational: every prop is a value the
 * caller already has, so this file has no data-fetching and no "current vs past" branching
 * of its own.
 */

/** Categories won / lost / tied for `a` against `b`, by the league's own rules. */
export function tally(league: LeagueData, a: number[], b: number[]) {
  const lower = new Set(league.lowerIsBetter);
  let win = 0;
  let loss = 0;
  let tie = 0;
  for (const c of league.categories) {
    const x = categoryValue(league.stats, a, c);
    const y = categoryValue(league.stats, b, c);
    if (x === y) tie += 1;
    else if (lower.has(c) ? x < y : x > y) win += 1;
    else loss += 1;
  }
  return { win, loss, tie };
}

/** The head-to-head, full category width, each cell shaded when it beat the other side's. */
export function CategorySheet({
  league,
  youName,
  oppName,
  youVec,
  oppVec,
}: {
  league: LeagueData;
  youName: string;
  oppName: string;
  youVec: number[];
  oppVec: number[];
}) {
  const you = tally(league, youVec, oppVec);
  const opp = { win: you.loss, loss: you.win, tie: you.tie };
  return (
    <div className="table-scroll">
      <table className="sheet rc-sheet">
        <thead>
          <tr>
            <th>Team</th>
            {league.categories.map((c) => (
              <th className="num" key={c}>
                {c}
              </th>
            ))}
            <th className="num">Score</th>
          </tr>
        </thead>
        <tbody>
          <CategoryRow
            league={league}
            team={youName}
            vec={youVec}
            other={oppVec}
            score={`${you.win}-${you.loss}-${you.tie}`}
            won={you.win > you.loss}
          />
          <CategoryRow
            league={league}
            team={oppName}
            vec={oppVec}
            other={youVec}
            score={`${opp.win}-${opp.loss}-${opp.tie}`}
            won={opp.win > opp.loss}
          />
        </tbody>
      </table>
    </div>
  );
}

function CategoryRow({
  league,
  team,
  vec,
  other,
  score,
  won,
}: {
  league: LeagueData;
  team: string;
  vec: number[];
  other: number[];
  score: string;
  won: boolean;
}) {
  const lower = new Set(league.lowerIsBetter);
  return (
    <tr>
      <td className="rc-team">{team}</td>
      {league.categories.map((c) => {
        const a = categoryValue(league.stats, vec, c);
        const b = categoryValue(league.stats, other, c);
        const win = lower.has(c) ? a < b : a > b;
        return (
          <td className={`num ${win ? "rc-win" : ""}`} key={c}>
            {formatValue(c, a)}
          </td>
        );
      })}
      <td className={`num ${won ? "rc-win" : ""}`} style={{ fontWeight: 700 }}>
        {score}
      </td>
    </tr>
  );
}

/**
 * "Matchup Acquisition Limit (Used/Max)" — ESPN's own line for how much of the matchup's
 * add allowance each side has spent. Renders nothing when either side's summary is
 * missing (an old export, or a period the exporter couldn't resolve a window for) rather
 * than showing a blank or a guessed number.
 */
export function AcquisitionLine({
  youName,
  oppName,
  youAcq,
  oppAcq,
}: {
  youName: string;
  oppName: string;
  youAcq?: AcquisitionSummary;
  oppAcq?: AcquisitionSummary;
}) {
  if (!youAcq || !oppAcq) return null;
  return (
    <div className="acq-line">
      <div className="acq-side">
        <span className="acq-name">{youName}</span>
        <span className="acq-label mono">
          Matchup Acquisition Limit (Used/Max): {youAcq.used}/{youAcq.max}
        </span>
      </div>
      <div className="acq-side acq-side-right">
        <span className="acq-name">{oppName}</span>
        <span className="acq-label mono">
          Matchup Acquisition Limit (Used/Max): {oppAcq.used}/{oppAcq.max}
        </span>
      </div>
    </div>
  );
}

/** Columns for a player line, in ESPN's own box-score order: opponents, then the stat group. */
const BOX_COLS = [
  "MIN", "FGM/FGA", "FG%", "FTM/FTA", "FT%", "3PM/3PA", "3P%",
  "REB", "AST", "STL", "BLK", "TO", "DD", "PTS", "TW",
] as const;

/**
 * One team's players for a matchup period, biggest scorer first, with a TOTALS row.
 *
 * Makes/attempts render as ONE cell ("12/16"), matching ESPN's own box score, rather than
 * three separate FGM/FGA/FG% columns — FG% is still its own column (a rate, not a raw
 * stat), but the makes and attempts that produce it read as a pair, not two unrelated
 * counting stats. The totals row has to equal the category sheet above it; that identity
 * is the reader's own check that both halves came from the same week.
 */
export function PlayerBoxTable({
  title,
  caption,
  stats,
  lines,
}: {
  title: string;
  /** e.g. "Playoff Rd 2 (Mar 23 - Apr 5)" — printed over the opponents column. */
  caption?: string;
  stats: string[];
  lines: BoxLine[];
}) {
  if (!lines.length) return null;
  const at = (l: BoxLine, stat: string) => l.v?.[stats.indexOf(stat)] ?? 0;
  const played = [...lines].sort((a, b) => at(b, "PTS") - at(a, "PTS"));

  const totals = lines.reduce<Record<string, number>>((acc, l) => {
    acc.MIN = (acc.MIN ?? 0) + (l.min || 0);
    acc.GP = (acc.GP ?? 0) + (l.gp || 0);
    for (const s of stats) acc[s] = (acc[s] ?? 0) + at(l, s);
    return acc;
  }, {});

  const madeAttempt = (src: Record<string, number> | BoxLine, made: string, att: string) => {
    const get = (s: string) =>
      "v" in src || "gp" in src ? at(src as BoxLine, s) : (src as Record<string, number>)[s] ?? 0;
    const m = get(made);
    const a = get(att);
    return a || m ? `${m.toLocaleString("en-US")}/${a.toLocaleString("en-US")}` : "—";
  };

  const cell = (src: Record<string, number> | BoxLine, col: (typeof BOX_COLS)[number]): string => {
    const get = (s: string) =>
      "v" in src || "gp" in src ? at(src as BoxLine, s) : (src as Record<string, number>)[s] ?? 0;
    if (col === "MIN") {
      const m = "min" in src ? (src as BoxLine).min : (src as Record<string, number>).MIN;
      return m ? String(Math.round(m)) : "—";
    }
    if (col === "FGM/FGA") return madeAttempt(src, "FGM", "FGA");
    if (col === "FTM/FTA") return madeAttempt(src, "FTM", "FTA");
    if (col === "3PM/3PA") return madeAttempt(src, "3PM", "3PA");
    // Percentages are RATES: derived from the makes and attempts, never averaged.
    if (col === "FG%" || col === "FT%" || col === "3P%") {
      const [m, a] =
        col === "FG%" ? ["FGM", "FGA"] : col === "FT%" ? ["FTM", "FTA"] : ["3PM", "3PA"];
      const att = get(a);
      return att ? `${((get(m) / att) * 100).toFixed(1)}%` : "—";
    }
    const v = get(col);
    return v ? v.toLocaleString("en-US") : "—";
  };

  return (
    <>
      <h2 className="rc-box-title">{title}</h2>
      <div className="table-scroll">
        <table className="sheet rc-box">
          <thead>
            <tr>
              <th>Starters</th>
              <th>{caption ? `Games: Opponents (${caption})` : "Games: Opponents"}</th>
              {BOX_COLS.map((c) => (
                <th className="num" key={c}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {played.map((l) => (
              <tr key={l.name} className={l.gp ? undefined : "row-muted"}>
                <td className="rc-player">{l.name}</td>
                <td className="rc-opp">{l.opp?.length ? l.opp.join(", ") : "—"}</td>
                {BOX_COLS.map((c) => (
                  <td className="num" key={c}>
                    {cell(l, c)}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="rc-totals">
              <td>Totals</td>
              <td className="rc-opp" />
              {BOX_COLS.map((c) => (
                <td className="num" key={c}>
                  {cell(totals, c)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
