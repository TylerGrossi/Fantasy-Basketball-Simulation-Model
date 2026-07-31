import { loadLeague, myTeam } from "@/lib/loadLeague";

/** Season Summary: champion, your headline numbers, and the full standings. */
export default async function Page() {
  const league = await loadLeague();
  const me = myTeam(league);
  const standings = league.seasonData.standings ?? [];

  if (!standings.length) {
    return (
      <>
        <h1>Season</h1>
        <p className="caption">No season data — run `npm run data`.</p>
      </>
    );
  }

  const sorted = [...standings].sort((a, b) => a.standing - b.standing);
  const champ = sorted[0];
  const mine = standings.find((s) => s.teamId === me.id);
  const yr = `${league.season - 1}–${String(league.season).slice(2)}`;

  return (
    <>
      <h1>{yr} Season {league.seasonOver ? "Complete" : "So Far"}</h1>
      <p className="caption">
        Standings by category record, with all-play — how each team would have scored
        against the whole league every week, which strips out schedule luck.
      </p>

      {league.seasonOver && (
        <div className="champion">
          <div className="eyebrow">Champion</div>
          <div className="champion-name">{champ.teamName}</div>
          <div className="mono champion-rec">
            {champ.wins}-{champ.losses}-{champ.ties}
          </div>
        </div>
      )}

      {mine && (
        <>
          <h2>{mine.teamName}</h2>
          <div className="metrics">
            <Metric label="Category record" value={`${mine.wins}-${mine.losses}-${mine.ties}`} />
            <Metric label="Win %" value={`${(mine.winPct * 100).toFixed(1)}%`} />
            <Metric label="All-play %" value={`${(mine.allPlayPct * 100).toFixed(1)}%`} />
            <Metric
              label="Luck"
              value={`${mine.luck >= 0 ? "+" : ""}${mine.luck.toFixed(1)}`}
              tone={mine.luck >= 0 ? "good" : "bad"}
            />
          </div>
          <p className="caption">
            Luck is actual wins minus what the all-play record predicts. Positive means the
            schedule was kind, negative means it wasn&rsquo;t — neither reflects skill.
          </p>
        </>
      )}

      <h2>Standings</h2>
      <div className="table-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>Team</th>
              <th className="num">Record</th>
              <th className="num">Win %</th>
              <th className="num">All-play</th>
              <th className="num">Luck</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.teamId} className={t.teamId === me.id ? "row-you" : undefined}>
                <td className="num">{t.standing}</td>
                <td>{t.teamName}</td>
                <td className="num">
                  {t.wins}-{t.losses}-{t.ties}
                </td>
                <td className="num">{(t.winPct * 100).toFixed(1)}%</td>
                <td className="num">{(t.allPlayPct * 100).toFixed(1)}%</td>
                <td
                  className="num"
                  style={{ color: t.luck >= 0 ? "var(--good)" : "var(--bad)" }}
                >
                  {t.luck >= 0 ? "+" : ""}
                  {t.luck.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Season category totals</h2>
      <div className="table-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th>Team</th>
              {league.categories.map((c) => (
                <th key={c} className="num">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.teamId} className={t.teamId === me.id ? "row-you" : undefined}>
                <td>{t.teamName}</td>
                {league.categories.map((c) => {
                  const v = t.catTotals[c] ?? 0;
                  return (
                    <td key={c} className="num">
                      {c.includes("%") ? `${(v * 100).toFixed(1)}%` : Math.round(v).toLocaleString("en-US")}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div
        className="metric-value mono"
        style={tone ? { color: tone === "good" ? "var(--good)" : "var(--bad)" } : undefined}
      >
        {value}
      </div>
    </div>
  );
}
