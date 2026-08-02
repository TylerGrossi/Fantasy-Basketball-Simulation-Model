import {
  categoryValue,
  formatValue,
  periodLabel,
  type LeagueData,
  type PeriodResult,
} from "@/lib/league";
import type { BoxLine, BoxScores } from "@/lib/loadLeague";

/**
 * A completed week, laid out the way ESPN's box-score page lays it out: every matchup in
 * the league across the top, then your head-to-head with the full category sheet under it,
 * each category shaded for whoever won it.
 *
 * The player tables come from `boxscores.json` — ESPN's own per-player weekly totals,
 * collected in the loop `build_period_results` already runs, so they cost no extra
 * requests. Summing them reproduces the team's category totals exactly, which is worth
 * knowing: there is no bench to separate out, because ESPN only lists the players whose
 * stats counted.
 *
 * A server component: it reduces the whole league's week down to what renders, so the
 * browser never receives `periodResults`.
 */
export default function WeekRecap({
  league,
  period,
  teamId,
  box,
}: {
  league: LeagueData;
  period: number;
  teamId: number;
  /** Per-player lines, or null when the export predates them. */
  box: BoxScores | null;
}) {
  const result = (league.periodResults ?? []).find((p) => p.period === period);
  const mine = result?.games.find((g) => g.homeId === teamId || g.awayId === teamId);
  if (!result || !mine) return null;

  const byId = new Map(league.teams.map((t) => [t.id, t]));
  const name = (id: number) => byId.get(id)?.name ?? "Unknown";
  const record = (id: number) => {
    const t = byId.get(id);
    return t ? `${t.wins}-${t.losses}-${t.ties}` : "";
  };

  const isHome = mine.homeId === teamId;
  const you = isHome ? mine.home : mine.away;
  const opp = isHome ? mine.away : mine.home;
  const oppId = isHome ? mine.awayId : mine.homeId;

  const score = tally(league, you, opp);
  const oppScore = { win: score.loss, loss: score.win, tie: score.tie };

  return (
    <>
      {/* Every matchup in the league that week — the strip ESPN puts above the box score,
          so a week reads as a league event rather than just your own game. */}
      <div className="rc-strip">
        {result.games.map((g) => {
          const home = tally(league, g.home, g.away);
          const yours = g.homeId === teamId || g.awayId === teamId;
          return (
            <div className={`rc-game ${yours ? "rc-game-you" : ""}`} key={g.homeId}>
              <RcSide
                name={name(g.homeId)}
                score={`${home.win}-${home.loss}-${home.tie}`}
                won={home.win > home.loss}
              />
              <RcSide
                name={name(g.awayId)}
                score={`${home.loss}-${home.win}-${home.tie}`}
                won={home.loss > home.win}
              />
            </div>
          );
        })}
      </div>

      {/* The head-to-head, in the app's own board rather than a copy of ESPN's chrome. */}
      <div className="board">
        <div className="board-side">
          <span className="board-team board-you">{name(teamId)}</span>
          <span className="rc-meta">{record(teamId)}</span>
        </div>
        <div className={`board-score ${score.win >= score.loss ? "sb-win" : "sb-lose"}`}>
          {score.win}
        </div>
        <div className="board-center">
          <span className="board-status">Final</span>
          {score.tie > 0 && (
            <span className="board-ties">
              {score.tie} {score.tie === 1 ? "tie" : "ties"}
            </span>
          )}
        </div>
        <div className={`board-score ${oppScore.win >= oppScore.loss ? "sb-win" : "sb-lose"}`}>
          {score.loss}
        </div>
        <div className="board-side board-side-right">
          <span className="board-team board-opp">{name(oppId)}</span>
          <span className="rc-meta">{record(oppId)}</span>
        </div>
      </div>

      {/* The category sheet: one row per team, a column per category, winner shaded. */}
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
              team={name(teamId)}
              vec={you}
              other={opp}
              score={`${score.win}-${score.loss}-${score.tie}`}
              won={score.win > score.loss}
            />
            <CategoryRow
              league={league}
              team={name(oppId)}
              vec={opp}
              other={you}
              score={`${score.loss}-${score.win}-${score.tie}`}
              won={score.loss > score.win}
            />
          </tbody>
        </table>
      </div>

      <p className="caption">
        Final totals for {periodLabel(league, period)}. A shaded cell is a category won.
      </p>

      {box && (
        <>
          <BoxTable
            title={`${name(teamId)} box score`}
            stats={box.stats}
            lines={box.periods[String(period)]?.[String(teamId)] ?? []}
          />
          <BoxTable
            title={`${name(oppId)} box score`}
            stats={box.stats}
            lines={box.periods[String(period)]?.[String(oppId)] ?? []}
          />
        </>
      )}
    </>
  );
}

/** Columns for a player line, in ESPN's box-score order. */
const BOX_COLS = ["MIN", "FGM", "FGA", "FG%", "FTM", "FTA", "FT%", "3PM", "3PA", "3P%",
  "REB", "AST", "STL", "BLK", "TO", "DD", "PTS", "TW"] as const;

/**
 * One team's players for the week, biggest contributor first, with a TOTALS row.
 *
 * The totals row is not decoration: it has to equal the team's line in the category
 * sheet above, and it is the reader's own check that the two halves of the page came
 * from the same week.
 */
function BoxTable({
  title,
  stats,
  lines,
}: {
  title: string;
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

  const cell = (src: Record<string, number> | BoxLine, col: string): string => {
    const get = (s: string) =>
      "v" in src || "gp" in src ? at(src as BoxLine, s) : (src as Record<string, number>)[s] ?? 0;
    if (col === "MIN") {
      const m = "min" in src ? (src as BoxLine).min : (src as Record<string, number>).MIN;
      return m ? String(Math.round(m)) : "—";
    }
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
              <th>Player</th>
              <th className="num">GP</th>
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
                <td className="num">{l.gp || "—"}</td>
                {BOX_COLS.map((c) => (
                  <td className="num" key={c}>
                    {cell(l, c)}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="rc-totals">
              <td>Totals</td>
              <td className="num">{totals.GP || "—"}</td>
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

/** One team's category row, each cell shaded when it beat the other team's. */
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

function RcSide({ name, score, won }: { name: string; score: string; won: boolean }) {
  return (
    <div className={`rc-row ${won ? "rc-row-won" : ""}`}>
      <span className="rc-name">{name}</span>
      <span className="rc-score mono">{score}</span>
    </div>
  );
}

/** Categories won / lost / tied for `a` against `b`, by the league's own rules. */
function tally(league: LeagueData, a: number[], b: number[]) {
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

export type { PeriodResult };
