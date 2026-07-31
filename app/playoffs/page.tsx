import { loadLeague, myTeam } from "@/lib/loadLeague";

/** Playoff seeding and championship odds from the bracket simulation. */
export default async function Page() {
  const league = await loadLeague();
  const me = myTeam(league);
  const odds = league.seasonData.playoffOdds ?? [];
  const finalists = new Set(league.seasonData.championshipFinalists ?? []);

  if (!odds.length) {
    return (
      <>
        <h1>Playoffs</h1>
        <p className="caption">No playoff data — run the data export.</p>
      </>
    );
  }

  const sorted = [...odds].sort((a, b) => b.championshipProb - a.championshipProb);
  const shown = sorted.filter((t) => t.championshipProb > 0.1);
  const peak = Math.max(...shown.map((t) => t.championshipProb), 1);

  // Final standing 1 is the actual champion once the season is over.
  const champion = (league.seasonData.standings ?? []).find((s) => s.standing === 1);

  return (
    <>
      <h1>Playoffs</h1>
      <p className="caption">
        Projected roster (injury-aware), simulated category by category. Playoff matchups
        are two weeks each.
      </p>

      {/* These are the MODEL's odds, not the outcome. With the season finished the two
          finalists come out near a coin flip, which would read as "51% to win" for a team
          that actually lifted the trophy — say so rather than let the number imply it. */}
      {league.seasonOver && champion && (
        <div className="notice">
          <strong>{champion.teamName}</strong> won the {league.season - 1}–
          {String(league.season).slice(2)} championship. The probabilities below are the
          model&rsquo;s view of the bracket, not the result — a final between two evenly
          matched teams simulates close to 50/50 however it actually finished.
        </div>
      )}

      <h2>Championship probability</h2>
      {shown.length === 0 ? (
        <p className="caption">No team has a non-trivial championship probability.</p>
      ) : (
        <div style={{ marginBottom: "0.5rem" }}>
          {shown.map((t) => (
            <div className="bar-row" key={t.teamId}>
              <div
                className="bar-label"
                style={{ fontWeight: t.teamId === me.id ? 700 : 400 }}
              >
                {t.teamName}
              </div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{
                    width: `${Math.max(1, (t.championshipProb / peak) * 100)}%`,
                    background: t.teamId === me.id ? "var(--cobalt)" : "var(--clay)",
                  }}
                />
              </div>
              <div className="bar-value mono">{t.championshipProb.toFixed(1)}%</div>
            </div>
          ))}
        </div>
      )}

      <h2>All teams</h2>
      <div className="table-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th>Team</th>
              <th className="num">Record</th>
              <th className="num">Make playoffs</th>
              <th className="num">Reach final</th>
              <th className="num">Champion</th>
              <th>Finalist</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t) => (
              <tr key={t.teamId} className={t.teamId === me.id ? "row-you" : undefined}>
                <td>{t.teamName}</td>
                <td className="num">{t.record.join("-")}</td>
                <td className="num">{t.playoffProb.toFixed(1)}%</td>
                <td className="num">{t.advanceProb.toFixed(1)}%</td>
                <td
                  className="num"
                  style={{ fontWeight: t.championshipProb > 50 ? 700 : 400 }}
                >
                  {t.championshipProb.toFixed(1)}%
                </td>
                <td>{finalists.has(t.teamId) ? <span className="tag">FINAL</span> : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
