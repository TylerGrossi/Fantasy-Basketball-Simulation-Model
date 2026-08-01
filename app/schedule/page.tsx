import Link from "next/link";
import { loadLeague, myTeam } from "@/lib/loadLeague";

/** Your season, matchup by matchup. Completed weeks show the category score. */
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

  // Best opponent, measured in CATEGORIES rather than matchups — beating someone 12-3
  // twice says more than edging them 8-7 twice, and with only two or three meetings per
  // opponent a matchup record is too coarse to separate anyone.
  // Names arrive as "@ Team Name (140-143-2)": strip the away marker and their record.
  const byOpp = new Map<string, [number, number, number]>();
  for (const r of rows) {
    const m = /^(\d+)-(\d+)-(\d+)$/.exec((r.score || "").trim());
    if (!m) continue;
    const name = (r.opponent || "")
      .replace(/^@\s*/, "")
      .replace(/\s*\([^)]*\)\s*$/, "")
      .trim();
    if (!name) continue;
    const rec = byOpp.get(name) ?? [0, 0, 0];
    byOpp.set(name, [rec[0] + +m[1], rec[1] + +m[2], rec[2] + +m[3]]);
  }
  // Best category win rate; ties broken by the bigger sample, so one lucky week does not
  // outrank a team you beat repeatedly.
  const best = [...byOpp.entries()].sort((a, b) => {
    const rate = (x: [number, number, number]) => {
      const n = x[0] + x[1] + x[2];
      return n ? (x[0] + x[2] / 2) / n : 0;
    };
    return rate(b[1]) - rate(a[1]) ||
      (b[1][0] + b[1][1] + b[1][2]) - (a[1][0] + a[1][1] + a[1][2]);
  })[0];

  return (
    <>
      <h1>Schedule</h1>
      <p className="caption">
        {me.name}&rsquo;s season. Completed matchups show the category score (W-L-T) —
        click any row to open that week.
      </p>

      <div className="metrics">
        <Metric label="Total record" value={cats.join("-")} />
        <Metric label="Record" value={`${w}-${l}-${t}`} />
        <Metric label="Win rate" value={played ? `${((w / played) * 100).toFixed(0)}%` : "—"} />
        <Metric
          label="Best opponent"
          value={best ? best[1].join("-") : "—"}
          sub={best ? best[0] : undefined}
        />
      </div>

      <div className="table-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Matchup</th>
              <th>Opponent</th>
              <th>Manager</th>
              <th>Result</th>
              <th className="num">Score</th>
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
                    {r.period}
                  </Link>
                </td>
                <td>{r.matchup}</td>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div className="metric-value mono">{value}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}
