import { loadLeague, myTeam } from "@/lib/loadLeague";
import type { StandingRow } from "@/lib/league";

/**
 * Season Summary: champion, your headline numbers, and the final standings.
 *
 * Deliberately narrow — this is the landing page for "how did the season go", and the
 * Streamlit version it replaces was tuned to fit one 1080p screen without scrolling.
 * Per-category season totals are NOT here; they live on /league-stats, with each team's
 * rank in every category, which is the version worth reading.
 */
export default async function Page() {
  const league = await loadLeague();
  const me = await myTeam(league);
  const standings = league.seasonData?.standings ?? [];

  if (!standings.length) {
    return (
      <>
        <h1>Season</h1>
        <p className="caption">No season data — run `npm run data`.</p>
      </>
    );
  }

  const sorted = [...standings].sort((a, b) => rankOf(a) - rankOf(b));
  const champ = sorted[0];
  const mine = standings.find((s) => s.teamId === me.id);
  const yr = `${league.season - 1}–${String(league.season).slice(2)}`;

  return (
    <>
      <h1 className="ss-title">
        {yr} Season {league.seasonOver ? "Complete" : "So Far"}
      </h1>

      <div className="ss-col">
        <div className="champion">
          <div className="eyebrow">
            {league.seasonOver ? "Champion" : "Regular-Season Leader"}
          </div>
          <div className="champion-name">{champ.teamName}</div>
          <div className="mono champion-rec">{record(champ)}</div>
        </div>

        {mine && (
          <>
            <p className="ss-finish">
              <strong>{mine.teamName}</strong> finished{" "}
              <strong className="ss-place">{ordinal(rankOf(mine))}</strong>.
            </p>
            <div className="metrics ss-metrics">
              <Metric label="Category Record" value={record(mine)} />
              <Metric label="Win %" value={pct(mine.winPct)} />
              <Metric label="All-Play Win %" value={pct(mine.allPlayPct)} />
              <Metric label="Luck" value={signed(mine.luck)} />
            </div>
          </>
        )}

        <div className="table-scroll">
          <table className="sheet ss-standings">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Team</th>
                <th className="num">Record</th>
                <th className="num">Win %</th>
                <th className="num">All-Play %</th>
                <th className="num">Luck</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.teamId} className={t.teamId === me.id ? "row-you" : undefined}>
                  <td className="ss-rank">{rankOf(t)}</td>
                  <td className="ss-team">{t.teamName}</td>
                  <td className="num">{record(t)}</td>
                  <td className="num">{pct(t.winPct)}</td>
                  <td className="num">{pct(t.allPlayPct)}</td>
                  <td
                    className="num"
                    style={{ color: t.luck >= 0 ? "var(--good)" : "var(--bad)" }}
                  >
                    {signed(t.luck)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

/**
 * Where the league actually finished them. `finalStanding` is ESPN's post-bracket
 * placing; it's 0 until the playoffs resolve, so fall back to the category-record order.
 */
function rankOf(t: StandingRow): number {
  return t.finalStanding || t.standing;
}

const record = (t: StandingRow) => `${t.wins}-${t.losses}-${t.ties}`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div className="metric-value mono">{value}</div>
    </div>
  );
}
