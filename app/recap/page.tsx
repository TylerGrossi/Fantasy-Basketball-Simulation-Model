import Link from "next/link";
import PlayerLink from "@/components/PlayerLink";
import { categoryValue, formatValue, winPctText, type LeagueData } from "@/lib/league";
import {
  loadBoxScores,
  loadGameLogs,
  loadGameSpread,
  loadLeague,
  loadPredictions,
  myTeam,
} from "@/lib/loadLeague";
import {
  buildWeekRecap,
  finishedPeriods,
  RECAP_MIN_GP,
  type RecapMatchup,
  type RecapPlayer,
} from "@/lib/weekRecap";

/**
 * Weekly Recap (owner, 2026-11-09): a finished week across the whole league. The numbers
 * come from lib/weekRecap.ts, which only assembles what other pages already compute.
 */

const SHOWN = ["PTS", "REB", "AST", "STL", "BLK", "3PM"];
const TOP = 10;
const MOVERS = 6;
const BEST_GAMES = 10;

export default async function Page({ searchParams }: { searchParams: Promise<{ week?: string }> }) {
  const sp = await searchParams;
  const league = await loadLeague();
  const me = await myTeam(league);
  const weeks = finishedPeriods(league);

  if (!weeks.length) {
    return (
      <>
        <h1>Weekly Recap</h1>
        <p className="caption">No finished week yet — the first recap appears once week 1 is over.</p>
      </>
    );
  }

  const asked = Number(sp.week);
  const period = weeks.includes(asked) ? asked : weeks[0];
  const [box, logs, pre, spread] = await Promise.all([
    loadBoxScores(),
    loadGameLogs(),
    loadPredictions(),
    loadGameSpread(),
  ]);
  const r = buildWeekRecap(league, period, box, logs, pre, spread?.spread ?? {});
  if (!r) {
    return (
      <>
        <h1>Weekly Recap</h1>
        <p className="caption">No results for week {period} in this export.</p>
      </>
    );
  }

  const name = new Map(league.teams.map((t) => [t.id, t.name]));
  const teamName = (id: number) => name.get(id) ?? "—";
  const dates =
    /\(([^)]+)\)/.exec(
      Object.values(league.seasonData.schedules ?? {})[0]?.find((x) => x.period === period)?.matchup ?? ""
    )?.[1] ?? "";

  // Headline tiles.
  const mineRow = r.teams.find((t) => t.teamId === me.id)?.row;
  const upsets = r.matchups.filter((m) => m.upset);
  // TOTAL value for the week (owner, 2026-11-09): per-game value x games played, so a
  // 4-game week outranks the same level over 2. No games minimum - the total handles it.
  const ranked = [...r.players].sort((a, b) => b.week * b.gp - a.week * a.gp);
  const best = [...r.games].sort((a, b) => b.gs - a.gs);
  const movers = r.players.filter((p) => p.gp >= RECAP_MIN_GP && p.season != null);
  const rising = [...movers].sort((a, b) => b.week - b.season! - (a.week - a.season!)).slice(0, MOVERS);
  const falling = [...movers].sort((a, b) => a.week - a.season! - (b.week - b.season!)).slice(0, MOVERS);
  const allPlay = [...r.teams].sort((a, b) => b.row.beat - a.row.beat || b.row.allPlayPct - a.row.allPlayPct);
  const signed = (x: number, d = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(d)}`;

  return (
    <div className="wr">
      <div className="wr-top">
        <div>
          <h1>Weekly Recap</h1>
          <p className="caption wr-sub">
            Week {period}
            {dates && ` · ${dates}`}
          </p>
        </div>
        <nav className="chips" aria-label="Week">
          {[...weeks].reverse().map((w) => (
            <Link key={w} href={`/recap?week=${w}`} className={`chip${w === period ? " chip-on" : ""}`} aria-current={w === period ? "page" : undefined}>
              Wk {w}
            </Link>
          ))}
        </nav>
      </div>

      <div className="metrics">
        <Tile
          label="Your week"
          value={mineRow?.result ? `${mineRow.result} ${mineRow.actual!.win}-${mineRow.actual!.loss}-${mineRow.actual!.tie}` : "—"}
          sub={mineRow?.opponentName ? `vs ${mineRow.opponentName}` : undefined}
          tone={mineRow?.result === "W" ? "good" : mineRow?.result === "L" ? "bad" : undefined}
        />
        <Tile
          label="Upsets"
          value={r.matchups.some((m) => m.pre) ? String(upsets.length) : "—"}
          sub={
            upsets.length
              ? upsets.map((m) => `${teamName(m.winnerId!)} (${winPctText(m.winnerId === m.homeId ? m.pre!.home : m.pre!.away)})`).join(", ")
              : r.matchups.some((m) => m.pre)
                ? "Every favourite won"
                : "No pre-week forecast logged"
          }
        />
        <Tile label="Top performer" value={ranked[0] ? signed(ranked[0].week * ranked[0].gp) : "—"} sub={ranked[0] ? `${ranked[0].name} · ${teamName(ranked[0].teamId)}` : undefined} />
        <Tile label="Best game" value={best[0] ? signed(best[0].gs) : "—"} sub={best[0] ? `${best[0].name} · ${dayLabel(best[0].date)}` : undefined} />
      </div>

      <h2>Matchups</h2>
      <p className="caption ctx">
        Final category score, the pre-week win probability each side was given, and an
        upset tag when the side under 50% won.
      </p>
      <div className="wr-matchups">
        {r.matchups.map((m) => (
          <MatchupCard key={m.homeId} league={league} period={period} m={m} teamName={teamName} me={me.id} />
        ))}
      </div>

      <div className="wr-grid">
        <section>
          <h2>All-play and luck</h2>
          <p className="caption ctx">
            Each team against every other team that week. Lucky: won while beating less
            than half the league. Unlucky: lost while beating most of it.
          </p>
          <div className="table-scroll">
            <table className="sheet">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Team</th>
                  <th>Result</th>
                  <th className="num">All-play</th>
                  <th className="num">Beat</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {allPlay.map(({ teamId, row }, i) => (
                  <tr key={teamId} className={teamId === me.id ? "wr-me" : undefined}>
                    <td className="num">{i + 1}</td>
                    <td>{teamName(teamId)}</td>
                    <td>
                      <span className={`wr-res ${row.result === "W" ? "w" : row.result === "L" ? "l" : ""}`}>{row.result ?? "—"}</span>{" "}
                      <span className="mono">{row.actual ? `${row.actual.win}-${row.actual.loss}-${row.actual.tie}` : ""}</span>
                    </td>
                    <td className="num">
                      {row.allPlay.win}-{row.allPlay.loss}-{row.allPlay.tie}
                    </td>
                    <td className="num">{(row.beat * 100).toFixed(0)}%</td>
                    <td>
                      {row.luck === 1 && <span className="wk-flag wk-gifted">lucky</span>}
                      {row.luck === -1 && <span className="wk-flag wk-robbed">unlucky</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2>Category leaders</h2>
          <p className="caption ctx">Best and worst team total in each category this week.</p>
          <div className="table-scroll">
            <table className="sheet">
              <thead>
                <tr>
                  <th>Cat</th>
                  <th>Best</th>
                  <th className="num" />
                  <th>Worst</th>
                  <th className="num" />
                </tr>
              </thead>
              <tbody>
                {r.leaders.map((l) => (
                  <tr key={l.cat}>
                    <td>{l.cat}</td>
                    <td className={l.best.teamId === me.id ? "wr-me-cell" : undefined}>{teamName(l.best.teamId)}</td>
                    <td className="num">{formatValue(l.cat, l.best.value)}</td>
                    <td className={l.worst.teamId === me.id ? "wr-me-cell" : undefined}>{teamName(l.worst.teamId)}</td>
                    <td className="num">{formatValue(l.cat, l.worst.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <h2>Top players</h2>
      <p className="caption ctx">
        Ranked by total value for the week: per-game value (the Player Value scale) times games
        played. Per game and season are both per-game, so the two compare directly.
      </p>
      <PlayerTable rows={ranked.slice(0, TOP)} teamName={teamName} me={me.id} />

      <div className="wr-grid">
        <section>
          <h2>Rising</h2>
          <p className="caption ctx">Week value furthest above season value.</p>
          <MoverList rows={rising} teamName={teamName} me={me.id} />
        </section>
        <section>
          <h2>Falling</h2>
          <p className="caption ctx">Week value furthest below season value.</p>
          <MoverList rows={falling} teamName={teamName} me={me.id} />
        </section>
      </div>

      <h2>Best games</h2>
      <p className="caption ctx">Single nights by Game Score (GS), scored exactly as Game Day scores a final.</p>
      {best.length === 0 ? (
        <p className="caption">No game-by-game lines for this week in the export yet.</p>
      ) : (
        <div className="table-scroll">
          <table className="sheet">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Player</th>
                <th className="wr-hide-sm">Team</th>
                <th>Date</th>
                {SHOWN.map((s) => (
                  <th className="num wr-hide-sm" key={s}>
                    {s}
                  </th>
                ))}
                <th className="num wr-hide-sm">FG</th>
                <th className="num">GS</th>
              </tr>
            </thead>
            <tbody>
              {best.slice(0, BEST_GAMES).map((g, i) => (
                <tr key={`${g.name}-${g.date}`} className={g.teamId === me.id ? "wr-me" : undefined}>
                  <td className="num">{i + 1}</td>
                  <td>
                    <PlayerLink name={g.name} />
                  </td>
                  <td className="wr-hide-sm">{teamName(g.teamId)}</td>
                  <td>{dayLabel(g.date)}</td>
                  {SHOWN.map((s) => (
                    <td className="num wr-hide-sm" key={s}>
                      {g.line[s] ?? 0}
                    </td>
                  ))}
                  <td className="num wr-hide-sm">
                    {g.line.FGM ?? 0}-{g.line.FGA ?? 0}
                  </td>
                  <td className="num wr-strong">{signed(g.gs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** One decimal, never "-0.0". */
const one = (x: number) => (Math.abs(x) < 0.05 ? "0.0" : x.toFixed(1));

/** "Tue 11/3" from an ISO date, read as that calendar day. */
function dayLabel(iso: string) {
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric", timeZone: "UTC" });
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div className="metric-value mono" style={tone ? { color: tone === "good" ? "var(--good)" : "var(--bad)" } : undefined}>
        {value}
      </div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

function MatchupCard({
  league,
  period,
  m,
  teamName,
  me,
}: {
  league: LeagueData;
  period: number;
  m: RecapMatchup;
  teamName: (id: number) => string;
  me: number;
}) {
  const lower = new Set(league.lowerIsBetter);
  // Scoreboard order (ESPN's), as every scoreboard in the app keeps it.
  const cats = league.categories;
  const sides = [
    { id: m.homeId, vec: m.home, other: m.away, won: m.score.home, lost: m.score.away, pre: m.pre?.home },
    { id: m.awayId, vec: m.away, other: m.home, won: m.score.away, lost: m.score.home, pre: m.pre?.away },
  ];
  return (
    <div className={`wr-card${m.homeId === me || m.awayId === me ? " wr-card-me" : ""}`}>
      <div className="wr-card-head">
        {m.upset && <span className="wr-upset">Upset</span>}
        <Link href={`/scoreboard?period=${period}&game=${m.homeId}`} className="wr-box-link">
          Box score
        </Link>
      </div>
      <div className="table-scroll">
        <table className="wr-board">
          <thead>
            <tr>
              <th aria-label="Team" />
              <th className="num">Score</th>
              <th className="num">Pre-week</th>
              {cats.map((c) => (
                <th key={c} className="num">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sides.map((s) => (
              <tr key={s.id} className={s.id === m.winnerId ? "wr-win" : undefined}>
                <td className={`wr-team${s.id === me ? " wr-me-cell" : ""}`}>{teamName(s.id)}</td>
                <td className="num mono wr-strong">
                  {s.won}-{s.lost}-{m.score.tie}
                </td>
                <td className="num mono">{s.pre == null ? "—" : winPctText(s.pre)}</td>
                {cats.map((c) => {
                  const a = categoryValue(league.stats, s.vec, c);
                  const b = categoryValue(league.stats, s.other, c);
                  const lead = lower.has(c) ? a < b : a > b;
                  return (
                    <td key={c} className={`num mono${lead ? " wr-lead" : ""}`}>
                      {formatValue(c, a)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PlayerTable({ rows, teamName, me }: { rows: RecapPlayer[]; teamName: (id: number) => string; me: number }) {
  if (!rows.length) return <p className="caption">No player lines for this week in the export.</p>;
  return (
    <div className="table-scroll">
      <table className="sheet">
        <thead>
          <tr>
            <th className="num">#</th>
            <th>Player</th>
            <th className="wr-hide-sm">Team</th>
            <th className="num">GP</th>
            {SHOWN.map((s) => (
              <th className="num wr-hide-sm" key={s}>
                {s}
              </th>
            ))}
            <th className="num">Total</th>
            <th className="num wr-hide-sm">Per game</th>
            <th className="num">Season</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.name} className={p.teamId === me ? "wr-me" : undefined}>
              <td className="num">{i + 1}</td>
              <td>
                <PlayerLink name={p.name} />
              </td>
              <td className="wr-hide-sm">{teamName(p.teamId)}</td>
              <td className="num">{p.gp}</td>
              {SHOWN.map((s) => (
                <td className="num wr-hide-sm" key={s}>
                  {one(p.perGame[s] ?? 0)}
                </td>
              ))}
              <td className="num wr-strong">{one(p.week * p.gp)}</td>
              <td className="num wr-hide-sm">{one(p.week)}</td>
              <td className="num">{p.season == null ? "—" : one(p.season)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MoverList({ rows, teamName, me }: { rows: RecapPlayer[]; teamName: (id: number) => string; me: number }) {
  if (!rows.length) return <p className="caption">Not enough games played to compare.</p>;
  return (
    <div className="table-scroll">
      <table className="sheet">
        <thead>
          <tr>
            <th>Player</th>
            <th className="wr-hide-sm">Team</th>
            <th className="num">Week</th>
            <th className="num">Season</th>
            <th className="num">Change</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const d = p.week - (p.season ?? 0);
            return (
              <tr key={p.name} className={p.teamId === me ? "wr-me" : undefined}>
                <td>
                  <PlayerLink name={p.name} />
                </td>
                <td className="wr-hide-sm">{teamName(p.teamId)}</td>
                <td className="num">{one(p.week)}</td>
                <td className="num">{one(p.season ?? 0)}</td>
                <td className="num wr-strong" style={{ color: d >= 0 ? "var(--good)" : "var(--bad)" }}>
                  {d >= 0 ? "+" : "−"}
                  {Math.abs(d).toFixed(1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
