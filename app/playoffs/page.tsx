import { loadLeague, myTeam } from "@/lib/loadLeague";
import type { PlayoffOddsRow } from "@/lib/league";

/**
 * Playoff seeding and championship odds from the bracket simulation.
 *
 * The table follows the legacy page's shape exactly, including its two modes: before the
 * playoffs it shows seed probabilities and a "no playoffs" column; once teams are in the
 * bracket those give way to Advance % / Champ %. Percentages are rounded the way the
 * Streamlit page rounded them (">99%", "<1%", "X" for a dead number) and paired with
 * American odds, which is how anyone reads a probability out loud.
 */

/** ">99%" / "<1%" / "X" for impossible — a percentage point of precision no one needs. */
function fmtPct(pct: number): string {
  if (pct >= 99.5) return ">99%";
  if (pct <= 0.5) return pct < 0.01 ? "X" : "<1%";
  return `${pct.toFixed(0)}%`;
}

/** Green above a quarter chance, red below. `invert` for "no playoffs", where high = bad. */
function pctColor(pct: number, invert = false): string {
  if (pct < 0.01) return "var(--ink-3)";
  const over = pct >= 25;
  return (invert ? !over : over) ? "var(--good)" : "var(--bad)";
}

/** Probability as American odds, blank at the extremes where a price is meaningless. */
function americanOdds(pct: number): string {
  if (pct >= 99 || pct < 1) return "";
  const p = pct / 100;
  if (p >= 0.5) return `${Math.round((-100 * p) / (1 - p) / 5) * 5}`;
  return `+${Math.round((100 * (1 - p)) / p / 5) * 5}`;
}

export default async function Page() {
  const league = await loadLeague();
  const me = await myTeam(league);
  const odds = league.seasonData?.playoffOdds ?? [];
  const finalists = league.seasonData?.championshipFinalists ?? [];

  if (!odds.length) {
    return (
      <>
        <h1>Playoff &amp; Championship Probabilities</h1>
        <p className="caption">No playoff data — run the data export.</p>
      </>
    );
  }

  const inPlayoffs = odds.some((r) => r.inPlayoffs);
  const finalistSet = new Set(finalists);

  // Once the finals are set the league has two teams left, and every other row is a
  // column of zeros — the legacy page collapsed to a two-row "Championship" table there.
  const championshipRows = [...odds]
    .filter((r) => finalistSet.has(r.teamId))
    .sort((a, b) => b.championshipProb - a.championshipProb);
  const isChampionship = championshipRows.length >= 2;

  const tableRows: PlayoffOddsRow[] = isChampionship
    ? championshipRows
    : inPlayoffs
      ? odds.filter((r) => r.advanceProb > 0 || r.championshipProb > 0)
      : [...odds].sort((a, b) => b.championshipProb - a.championshipProb);

  // Only show an odds column when at least one team's number is actually priceable.
  const showPlayoffOdds =
    !inPlayoffs && odds.some((r) => r.playoffProb >= 1 && r.playoffProb < 99);
  const showAdvanceOdds =
    inPlayoffs && odds.some((r) => r.advanceProb >= 1 && r.advanceProb < 99);
  const showChampOdds = tableRows.some(
    (r) => r.championshipProb >= 1 && r.championshipProb < 99
  );

  const chartRows = (isChampionship ? championshipRows : [...odds])
    .sort((a, b) => b.championshipProb - a.championshipProb)
    .filter((t) => t.championshipProb > 0.1);
  const peak = Math.max(...chartRows.map((t) => t.championshipProb), 1);

  // Final standing 1 is the actual champion once the season is over.
  const champion = (league.seasonData?.standings ?? []).find((s) => s.standing === 1);

  return (
    <>
      <h1>Playoff &amp; Championship Probabilities</h1>
      <p className="caption">
        Projected roster (injury-aware) + category-by-category. Playoff matchups are two
        weeks each (semis + finals).
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

      <h2>{isChampionship ? "Championship" : "Playoff Standings"}</h2>
      <div className="table-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th>Team</th>
              {!isChampionship && (
                <>
                  <th className="num">W</th>
                  <th className="num">L</th>
                </>
              )}
              {!isChampionship && !inPlayoffs && (
                <>
                  {[1, 2, 3, 4].map((s) => (
                    <th className="num" key={s}>
                      #{s}*
                    </th>
                  ))}
                  <th className="num">No Playoffs</th>
                  <th className="num">Playoff %</th>
                  {showPlayoffOdds && <th className="num">Playoff Odds</th>}
                </>
              )}
              {!isChampionship && inPlayoffs && (
                <>
                  <th className="num">Advance %</th>
                  {showAdvanceOdds && <th className="num">Advance Odds</th>}
                </>
              )}
              <th className="num">Champ %</th>
              {showChampOdds && <th className="num">Champ Odds</th>}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((t) => {
              const [w, l] = t.record;
              return (
                <tr key={t.teamId} className={t.teamId === me.id ? "row-you" : undefined}>
                  <td>{t.teamName}</td>
                  {!isChampionship && (
                    <>
                      <td className="num">{w}</td>
                      <td className="num">{l}</td>
                    </>
                  )}
                  {!isChampionship && !inPlayoffs && (
                    <>
                      {[1, 2, 3, 4].map((s) => {
                        const pct = t.seedProbs?.[String(s)] ?? 0;
                        return (
                          <td className="num" key={s} style={{ color: pctColor(pct) }}>
                            {fmtPct(pct)}
                          </td>
                        );
                      })}
                      <td
                        className="num"
                        style={{
                          color: pctColor(t.seedProbs?.no_playoffs ?? 0, true),
                        }}
                      >
                        {fmtPct(t.seedProbs?.no_playoffs ?? 0)}
                      </td>
                      <td className="num" style={{ color: pctColor(t.playoffProb) }}>
                        {fmtPct(t.playoffProb)}
                      </td>
                      {showPlayoffOdds && (
                        <td className="num" style={{ color: "var(--clay)" }}>
                          {americanOdds(t.playoffProb) || "–"}
                        </td>
                      )}
                    </>
                  )}
                  {!isChampionship && inPlayoffs && (
                    <>
                      <td className="num" style={{ color: pctColor(t.advanceProb) }}>
                        {fmtPct(t.advanceProb)}
                      </td>
                      {showAdvanceOdds && (
                        <td className="num" style={{ color: "var(--clay)" }}>
                          {americanOdds(t.advanceProb) || "–"}
                        </td>
                      )}
                    </>
                  )}
                  <td className="num" style={{ color: pctColor(t.championshipProb) }}>
                    {fmtPct(t.championshipProb)}
                  </td>
                  {showChampOdds && (
                    <td className="num" style={{ color: "var(--clay)" }}>
                      {americanOdds(t.championshipProb) || "–"}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Championship Probability</h2>
      {chartRows.length === 0 ? (
        <p className="caption">No team has a non-trivial championship probability.</p>
      ) : (
        <div style={{ marginBottom: "0.5rem" }}>
          {chartRows.map((t) => (
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
    </>
  );
}
