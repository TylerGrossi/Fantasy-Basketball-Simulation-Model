import RankTrendChart from "@/components/RankTrendChart";
import { loadLeague, myTeam } from "@/lib/loadLeague";

/** Power rankings by all-play %, plus how each rank moved week to week. */
export default async function Page() {
  const league = await loadLeague();
  const me = await myTeam(league);
  const pr = league.seasonData?.powerRankings;

  if (!pr?.teams.length) {
    return (
      <>
        <h1>Power Rankings</h1>
        <p className="caption">No power-ranking data — run the data export.</p>
      </>
    );
  }

  const teams = [...pr.teams].sort((a, b) => a.rank - b.rank);

  return (
    <>
      <h1>Power Rankings</h1>
      <p className="caption">
        Ranked by <strong>all-play win %</strong> — how each team would score against the
        whole league every week, so schedule luck is stripped out. <strong>Move</strong> is
        the change from last week, <strong>Form</strong> compares the last three weeks to
        the season, and <strong>SoS</strong> is the average all-play strength of the
        opponents faced.
      </p>

      <div className="table-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th className="num">Rank</th>
              <th className="num">Move</th>
              <th>Team</th>
              <th className="num">Power %</th>
              <th>Form</th>
              <th className="num">L3 %</th>
              <th className="num">SoS %</th>
              <th className="num">All-play</th>
            </tr>
          </thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.teamId} className={t.teamId === me.id ? "row-you" : undefined}>
                <td className="num">{t.rank}</td>
                <td
                  className="num"
                  style={{
                    color:
                      t.delta > 0
                        ? "var(--good)"
                        : t.delta < 0
                          ? "var(--bad)"
                          : "var(--ink-3)",
                  }}
                >
                  {t.delta > 0 ? `+${t.delta}` : t.delta}
                </td>
                <td>{t.teamName}</td>
                <td className="num">{(t.powerPct * 100).toFixed(1)}%</td>
                <td>{t.form}</td>
                <td className="num">{(t.recentPct * 100).toFixed(1)}%</td>
                <td className="num">{(t.sos * 100).toFixed(1)}%</td>
                <td className="num">{t.record.join("-")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Rank movement</h2>
      <p className="caption">
        Weekly power-rank path. <strong>{me.name}</strong> is highlighted.
      </p>
      <RankTrendChart weeks={pr.weeks} teams={pr.teams} yourTeamId={me.id} />
    </>
  );
}
