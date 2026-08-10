import RankTrendChart from "@/components/RankTrendChart";
import StarterRankingsPanel from "@/components/StarterRankingsPanel";
import { loadLeague, myTeam } from "@/lib/loadLeague";

/** Power rankings by all-play %, plus how each rank moved week to week. */
export default async function Page() {
  const league = await loadLeague();
  const me = await myTeam(league);
  const pr = league.seasonData?.powerRankings;
  const pool = league.seasonData?.playerPool ?? [];

  if (!pr?.teams.length) {
    return (
      <>
        <h1>Power Rankings</h1>
        <p className="caption">No power-ranking data — run the data export.</p>
      </>
    );
  }

  const teams = [...pr.teams].sort((a, b) => a.rank - b.rank);
  /*
   * The team's REAL record, for the ladder's meta line.
   *
   * `PowerRankingRow.record` is the ALL-PLAY record — 1905-880-50 across the season, which
   * is the number the power ranking is computed from, not the one anyone recognises as
   * "their record". The desktop table labels it "All-play" so the distinction is clear
   * there; on a card with no header it would just read as the record and be wrong by an
   * order of magnitude.
   */
  const recordFor = new Map(
    league.teams.map((t) => [
      t.id,
      `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""}`,
    ])
  );

  return (
    <>
      <h1>Power Rankings</h1>

      {/*
        MOBILE: the eight-column table as a ladder.

        Six of those columns answer one question — how strong is this team, and is it
        trending — so the ladder answers it once: position, name, the power bar, and the
        movement. Form and L3% collapse into a single chip, because "Hot" and "71.1%" say
        the same thing and the word is the readable half. SoS and the all-play record are
        the evidence rather than the answer, and stay in the table.

        Both are rendered and switched at 767px, the pattern the rest of the app uses.
      */}
      <div className="pr-ladder">
        {/* The ladder's own heading. The page <h1> is hidden on mobile (the back row
            already names it), so this is the visible title — and it says what the list is
            ordered by, which "Power Rankings" alone does not. No week number: the power
            rankings cover the regular season, and stamping a week on them invited the
            reading that they were as of the current playoff period. */}
        <h2 className="pr-title">All-Play Strength by Power %</h2>
        {teams.map((t) => (
          <div
            key={t.teamId}
            className={`pr-row${t.teamId === me.id ? " pr-you" : ""}`}
          >
            <span className="pr-pos mono">{t.rank}</span>
            <span className="pr-main">
              <span className="pr-team">{t.teamName}</span>
              <span className="pr-meta">
                <span className="mono">{recordFor.get(t.teamId) ?? ""}</span>
                {t.delta !== 0 && (
                  <span className={`pr-chip ${t.delta > 0 ? "up" : "dn"}`}>
                    {t.delta > 0 ? `+${t.delta}` : t.delta}
                  </span>
                )}
                <span className={`pr-chip form-${t.form.toLowerCase()}`}>{t.form}</span>
              </span>
            </span>
            <span className="pr-pct mono">{(t.powerPct * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>

      <div className="table-scroll pr-table-wrap">
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
      <RankTrendChart weeks={pr.weeks} teams={pr.teams} yourTeamId={me.id} />

      {/* Heading lives here, not inside the panel, so it sits at the same level as
          "Rank movement" above it — and inside the guard, so a missing player pool
          doesn't leave a title standing over nothing. */}
      {pool.length > 0 && (
        <>
          <h2>Value Power Rankings</h2>
          <StarterRankingsPanel
            pool={pool}
            teamNames={league.teams.map((t) => t.name)}
            defaultTeam={me.name}
          />
        </>
      )}
    </>
  );
}
