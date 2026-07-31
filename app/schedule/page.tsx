import { loadLeague, myTeam } from "@/lib/loadLeague";

/** Your season, matchup by matchup. Completed weeks show the category score. */
export default async function Page() {
  const league = await loadLeague();
  const me = myTeam(league);
  const rows = league.seasonData.schedules?.[String(me.id)] ?? [];

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

  return (
    <>
      <h1>Schedule</h1>
      <p className="caption">
        {me.name}&rsquo;s season. Completed matchups show the category score (W-L-T).
      </p>

      <div className="metrics">
        <Metric label="Record" value={`${w}-${l}-${t}`} />
        <Metric label="Matchups" value={String(rows.length)} />
        <Metric label="Win rate" value={played ? `${((w / played) * 100).toFixed(0)}%` : "—"} />
        <Metric
          label="Season"
          value={`${league.season - 1}–${String(league.season).slice(2)}`}
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
              <tr key={r.period}>
                <td className="num">{r.period}</td>
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div className="metric-value mono">{value}</div>
    </div>
  );
}
