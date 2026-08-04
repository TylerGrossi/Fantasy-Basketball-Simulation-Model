import {
  categoryValue,
  formatValue,
  type AcquisitionSummary,
  type LeagueData,
} from "@/lib/league";

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

/**
 * The head-to-head, each cell shaded when it beat the other side's.
 *
 * TWO layouts of the same numbers, switched by breakpoint in CSS (both always rendered —
 * no width detection, no flash of the wrong one, matching how Home does it):
 *
 *   desktop  teams as ROWS, categories as columns — a wide sheet you read across
 *   mobile   categories as ROWS, the two teams as two columns — the vertical head-to-head
 *            ESPN's app uses, because fifteen categories across a phone is a sideways
 *            scroll where the two numbers being compared are never on screen together
 */
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
  const lower = new Set(league.lowerIsBetter);
  return (
    <>
      <div className="table-scroll cs-horiz">
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

      {/* mine | category | theirs — the category label sits BETWEEN the two numbers it
          belongs to, so each row reads as one comparison rather than as a lookup. */}
      <div className="cs-vert">
        <div className="cs-vert-row cs-vert-head">
          <span className="cs-vert-team">{youName}</span>
          <span className="cs-vert-cat" />
          <span className="cs-vert-team">{oppName}</span>
        </div>
        {league.categories.map((c) => {
          const a = categoryValue(league.stats, youVec, c);
          const b = categoryValue(league.stats, oppVec, c);
          const youWins = lower.has(c) ? a < b : a > b;
          const oppWins = lower.has(c) ? b < a : b > a;
          return (
            <div className="cs-vert-row" key={c}>
              <span className={`cs-vert-v mono ${youWins ? "cs-vert-win" : ""}`}>
                {formatValue(c, a)}
              </span>
              <span className="cs-vert-cat">{c}</span>
              <span className={`cs-vert-v mono ${oppWins ? "cs-vert-win" : ""}`}>
                {formatValue(c, b)}
              </span>
            </div>
          );
        })}
        {/* No score row: the board directly above this already states it, and repeating
            it here made the same fact appear twice on one screen. */}
      </div>
    </>
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
 * ESPN's "Matchup Acquisition Limit" — how much of the matchup's add allowance each side
 * has spent — plus GP, the team's total games played so far this period (summed from the
 * same box lines `PlayerBoxTable` renders below it). The used/max shape is legible from
 * the figure itself ("14/14"), so the label doesn't spell it out. Renders
 * nothing when either side's acquisition summary is missing (an old export, or a period
 * the exporter couldn't resolve a window for) rather than showing a blank or a guessed
 * number; GP renders independently since it has no such failure mode.
 */
export function AcquisitionLine({
  youName,
  oppName,
  youAcq,
  oppAcq,
  youGp,
  oppGp,
}: {
  youName: string;
  oppName: string;
  youAcq?: AcquisitionSummary;
  oppAcq?: AcquisitionSummary;
  youGp?: number;
  oppGp?: number;
}) {
  if (!youAcq || !oppAcq) return null;
  return (
    <div className="acq-line">
      <div className="acq-side">
        <span className="acq-name">{youName}</span>
        <span className="acq-label mono">
          Acquisitions: {youAcq.used}/{youAcq.max}
        </span>
        {youGp != null && <span className="acq-label mono">GP: {youGp}</span>}
      </div>
      <div className="acq-side acq-side-right">
        <span className="acq-name">{oppName}</span>
        <span className="acq-label mono">
          Acquisitions: {oppAcq.used}/{oppAcq.max}
        </span>
        {oppGp != null && <span className="acq-label mono">GP: {oppGp}</span>}
      </div>
    </div>
  );
}

/**
 * The sortable per-player table lives in its own CLIENT component (sorting is local UI
 * state). Re-exported here so the four call sites keep importing every box-score piece
 * from one place, and so a server component importing this file doesn't pull the
 * client one in unless it actually renders it.
 */
export { PlayerBoxTable } from "./PlayerBoxTable";
