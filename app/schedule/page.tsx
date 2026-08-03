import Link from "next/link";
import { loadLeague, myTeam } from "@/lib/loadLeague";
import { weeklyAllPlay } from "@/lib/history";
import { periodLabel } from "@/lib/league";

/**
 * Your season, matchup by matchup — what happened, and what would have happened against
 * the whole league.
 *
 * The all-play columns live HERE rather than on a page of their own: they are the same
 * twenty-one rows this table already lists, and a second page repeating the schedule to
 * add three columns is two places to look for one story.
 */
export default async function Page() {
  const league = await loadLeague();
  const me = await myTeam(league);
  const rows = league.seasonData?.schedules?.[String(me.id)] ?? [];

  if (!rows.length) {
    return (
      <>
        <h1>Schedule</h1>
        <p className="caption">No schedule data — run the data export.</p>
      </>
    );
  }

  // Week-by-week all-play, keyed by period so it can join onto the schedule rows.
  const history = weeklyAllPlay(league, me.id);
  const byPeriod = new Map(history.weeks.map((h) => [h.period, h]));

  /**
   * What to print in the # column. A playoff round's period number (20, 22) means
   * nothing to a reader — "R1" and "R2" are how the league talks about those weeks.
   */
  const weekTag = (period: number) => {
    const round = /^Playoff Round (\d+)$/.exec(periodLabel(league, period));
    return round ? `R${round[1]}` : String(period);
  };

  /**
   * The export writes "Matchup 16 (Feb 03 - Feb 09)" — the label is already the # column
   * and the row's own position, so only the date range is worth a column.
   */
  const dates = (matchup: string) => /\(([^)]+)\)/.exec(matchup ?? "")?.[1] ?? "";

  const w = rows.filter((r) => r.result === "W").length;
  const l = rows.filter((r) => r.result === "L").length;
  const t = rows.filter((r) => r.result === "T").length;
  const played = w + l + t;

  // Every category won across the whole season, not just matchups won. A 10-5 week and a
  // 8-7 week are both one win in the matchup column but say very different things here.
  const cats = rows.reduce(
    (acc, r) => {
      const m = /^(\d+)-(\d+)-(\d+)$/.exec((r.score || "").trim());
      if (!m) return acc;
      return [acc[0] + +m[1], acc[1] + +m[2], acc[2] + +m[3]] as [number, number, number];
    },
    [0, 0, 0] as [number, number, number]
  );

  return (
    <>
      <h1>Schedule</h1>

      <div className="metrics">
        <Metric label="Total record" value={cats.join("-")} />
        <Metric label="Record" value={`${w}-${l}-${t}`} />
        <Metric
          label="Expected record"
          value={`${history.expected.win}-${history.expected.loss}`}
        />
        {/* What the draw was worth: the record you got minus the one your all-play rate
            says you earned. The "best opponent" tile it replaces was a curiosity; this
            answers the question the table below is actually about. */}
        <Metric
          label="Schedule swing"
          value={`${history.actual.win - history.expected.win >= 0 ? "+" : ""}${history.actual.win - history.expected.win}`}
          tone={
            history.actual.win > history.expected.win
              ? "good"
              : history.actual.win < history.expected.win
                ? "bad"
                : undefined
          }
        />
      </div>

      {(history.luckyWeeks.length > 0 || history.unluckyWeeks.length > 0) && (
        <p className="caption">
          {history.unluckyWeeks.length > 0 && (
            <>
              <strong>{history.unluckyWeeks.length}</strong>{" "}
              {history.unluckyWeeks.length === 1 ? "week was" : "weeks were"} lost while
              beating most of the league (
              {history.unluckyWeeks.map((x) => x.label).join(", ")}).{" "}
            </>
          )}
          {history.luckyWeeks.length > 0 && (
            <>
              <strong>{history.luckyWeeks.length}</strong>{" "}
              {history.luckyWeeks.length === 1 ? "week was" : "weeks were"} won on the draw
              ({history.luckyWeeks.map((x) => x.label).join(", ")}).
            </>
          )}
        </p>
      )}

      <div className="table-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Dates</th>
              <th>Opponent</th>
              <th>Manager</th>
              <th>Result</th>
              <th className="num">Score</th>
              <th className="num">All-play</th>
              <th className="num">Beat</th>
              <th>vs the field</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              /* The whole row navigates to that week's matchup. The link lives in the
                 first cell so there is a real focusable anchor for the keyboard; the
                 row-level click is CSS-driven via the stretched pseudo-element. */
              <tr key={r.period} className="row-link">
                <td className="num">
                  <Link href={`/scoreboard?period=${r.period}`} className="row-link-a">
                    {weekTag(r.period)}
                  </Link>
                </td>
                <td>{dates(r.matchup)}</td>
                <td>{r.opponent}</td>
                <td>{r.manager}</td>
                <td>
                  <span
                    style={{
                      fontWeight: 700,
                      color:
                        r.result === "W"
                          ? "var(--good)"
                          : r.result === "L"
                            ? "var(--bad)"
                            : "var(--ink-3)",
                    }}
                  >
                    {r.result || "—"}
                  </span>
                </td>
                <td className="num">{r.score || r.winPct || "—"}</td>
                <ScheduleAllPlay week={byPeriod.get(r.period)} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/**
 * The three all-play cells for one week: the record against everyone, the rate, and a
 * bar flagging the weeks that ran against the draw.
 */
function ScheduleAllPlay({ week }: { week?: ReturnType<typeof weeklyAllPlay>["weeks"][number] }) {
  if (!week) {
    // A scheduled-but-unplayed week has no totals to score against the league.
    return (
      <>
        <td className="num">—</td>
        <td className="num">—</td>
        <td />
      </>
    );
  }
  return (
    <>
      <td className="num">
        {week.allPlay.win}-{week.allPlay.loss}-{week.allPlay.tie}
      </td>
      {/* Share of the LEAGUE beaten that week, not share of categories won — the
          two differ a lot, and this is the one the bar and the flags encode.
          One decimal: in a 10-team league the denominator is 9 opponents, so the
          raw values are ninths (88.9%, 77.8%) and rounding to whole numbers made
          distinct weeks print as the same 89%. */}
      <td className="num">{(week.beat * 100).toFixed(1)}%</td>
      <td>
        <span className="wk-bar" aria-hidden="true">
          <span
            className="wk-fill"
            style={{
              width: `${(week.beat * 100).toFixed(0)}%`,
              background:
                week.luck === -1
                  ? "var(--bad)"
                  : week.luck === 1
                    ? "var(--clay)"
                    : "var(--cobalt)",
            }}
          />
        </span>
        {week.luck === -1 && <span className="wk-flag wk-robbed">robbed</span>}
        {week.luck === 1 && <span className="wk-flag wk-gifted">gifted</span>}
      </td>
    </>
  );
}

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "bad";
}) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div
        className="metric-value mono"
        style={tone ? { color: tone === "good" ? "var(--good)" : "var(--bad)" } : undefined}
      >
        {value}
      </div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}
