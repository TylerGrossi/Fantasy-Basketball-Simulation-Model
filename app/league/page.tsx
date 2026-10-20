import Link from "next/link";
import PlayerLink from "@/components/PlayerLink";
import {
  categoryRecord,
  periodLabel,
  scoreboardRows,
  winProbability,
  type LeagueData,
  type Matchup,
  type PoolPlayer,
} from "@/lib/league";
import { loadLeague, loadWeek0, myTeam, type Week0Rank } from "@/lib/loadLeague";
import { timeLabel } from "@/lib/moves";
import { playerStatus } from "@/lib/playerPool";

/**
 * League Home — the in-season front page, modelled on ESPN's league home: who you are and
 * how your week is going on the left, what is happening in the league in the middle, the
 * table on the right.
 *
 * Everything here is read from the export snapshot, not fetched live: it is a summary
 * page, and each panel links to the page that has the live or full version (Scoreboard,
 * Recent Moves, Season Summary). That keeps it a plain server component with no client
 * JavaScript of its own.
 */

const ET = "America/New_York";
const RECENT_MOVES = 8;
const TREND_ROWS = 6;
/** A riser needs a real sample on both sides of the comparison. */
const TREND_MIN_GP = 5;
const TREND_MIN_GP15 = 3;
/** Best Available: the top free agent at each, then the best of whoever is left. */
const FA_SLOTS = ["PG", "SG", "SF", "PF", "C"] as const;

export default async function Page() {
  const league = await loadLeague();
  const me = await myTeam(league);
  const teamName = new Map(league.teams.map((t) => [t.id, t.name]));
  const pool = league.seasonData.playerPool ?? [];
  // Week 0 of the power rankings: the opening-day value snapshot (see loadWeek0).
  const draft = await loadWeek0();

  const scores = league.matchups.map((m) => scoreLine(league, m));
  const mine = scores.find((s) => s.homeId === me.id || s.awayId === me.id);

  /*
   * A DASHBOARD: all three columns end on the same line. The columns stretch to the
   * tallest, and the last card in each grows to fill what is left (`.lh-col > :last-child`
   * in globals.css), with its "more" link pinned to the bottom so the extra height reads
   * as the card's own space rather than a gap.
   */
  return (
    <div className="lh">
      <div className="lh-col lh-left">
        <MyTeamCard league={league} meId={me.id} score={mine} teamName={teamName} />
        <ScoresCard scores={scores} meId={me.id} teamName={teamName} label={periodLabel(league)} />
        <FreeAgentsCard pool={pool} />
      </div>

      <div className="lh-col lh-main">
        <HeaderCard league={league} />
        <CategoryEdgeCard league={league} meId={me.id} teamName={teamName} />
        <MovesCard league={league} pool={pool} />
        <TrendsCard pool={pool} />
      </div>

      <div className="lh-col lh-right">
        <StandingsCard league={league} meId={me.id} />
        <PowerCard league={league} meId={me.id} draft={draft} />
        <TitleOddsCard league={league} meId={me.id} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ scores */

interface ScoreLine {
  homeId: number;
  awayId: number;
  /** Category record from the HOME side: [won, lost, tied]. */
  home: [number, number, number];
  /** Model's P(home wins the matchup), from banked totals + remaining projection. */
  homeWin: number;
}

function scoreLine(league: LeagueData, m: Matchup): ScoreLine {
  const rec = categoryRecord(scoreboardRows(league, m.home.current, m.away.current));
  const p = winProbability(league, m.home, m.away, m.home.current, m.away.current);
  return {
    homeId: m.homeId,
    awayId: m.awayId,
    home: [rec.win, rec.loss, rec.tie],
    homeWin: p.win + p.tie / 2,
  };
}

/** The same matchup seen from `teamId`'s side. */
function sideOf(s: ScoreLine, teamId: number) {
  const isHome = s.homeId === teamId;
  const [w, l, t] = s.home;
  return {
    oppId: isHome ? s.awayId : s.homeId,
    rec: isHome ? `${w}-${l}-${t}` : `${l}-${w}-${t}`,
    oppRec: isHome ? `${l}-${w}-${t}` : `${w}-${l}-${t}`,
    win: isHome ? s.homeWin : 1 - s.homeWin,
  };
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

/* ----------------------------------------------------------------- my team */

function MyTeamCard({
  league,
  meId,
  score,
  teamName,
}: {
  league: LeagueData;
  meId: number;
  score?: ScoreLine;
  teamName: Map<number, string>;
}) {
  const team = league.teams.find((t) => t.id === meId);
  if (!team) return null;
  const side = score ? sideOf(score, meId) : null;

  // Your roster's injury report: anyone ESPN lists as other than active.
  const m = league.matchups.find((x) => x.homeId === meId || x.awayId === meId);
  const roster = m ? (m.homeId === meId ? m.home.players : m.away.players) : [];
  const hurt = roster
    .map((p) => ({ p, s: playerStatus(p.status) }))
    .filter(({ s }) => s[1] !== "");

  return (
    <section className="lh-card">
      <h2 className="lh-h">My Team</h2>
      <div className="lh-me">
        <div className="lh-me-name">{team.name}</div>
        <div className="lh-me-sub mono">
          {team.wins}-{team.losses}-{team.ties} · {ordinal(team.standing)} place
        </div>
      </div>

      {side && (
        <Link href="/scoreboard" className="lh-me-week">
          <span className="lh-me-week-l">This week vs {teamName.get(side.oppId)}</span>
          <span className="lh-me-week-r">
            <b className="mono">{side.rec}</b>
            <span className="lh-me-win mono">{pct(side.win)} to win</span>
          </span>
        </Link>
      )}

      {hurt.length > 0 && (
        <div className="lh-inj">
          <div className="lh-sub-h">Injury report</div>
          {hurt.map(({ p, s }) => (
            <div className="lh-inj-row" key={p.name}>
              <PlayerLink name={p.name} />
              <span className={`lh-inj-s ${s[1]}`}>{s[0]}</span>
            </div>
          ))}
        </div>
      )}

      <div className="lh-links">
        <Link href="/scoreboard#roster">Roster</Link>
        <Link href="/lineup">Lineup</Link>
        <Link href="/scoreboard">Matchup</Link>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ scores */

function ScoresCard({
  scores,
  meId,
  teamName,
  label,
}: {
  scores: ScoreLine[];
  meId: number;
  teamName: Map<number, string>;
  label: string;
}) {
  return (
    <section className="lh-card">
      <h2 className="lh-h">
        Scores <span className="lh-h-note">{label}</span>
      </h2>
      {scores.length === 0 ? (
        <p className="caption">No matchups this week.</p>
      ) : (
        <div className="lh-scores">
          {scores.map((s) => {
            const home = sideOf(s, s.homeId);
            const away = sideOf(s, s.awayId);
            return (
              <div
                className={`lh-game${s.homeId === meId || s.awayId === meId ? " lh-game-you" : ""}`}
                key={`${s.homeId}-${s.awayId}`}
              >
                {[
                  { id: s.homeId, side: home },
                  { id: s.awayId, side: away },
                ].map(({ id, side }) => (
                  <div className="lh-game-row" key={id}>
                    <span className={`lh-game-team${id === meId ? " you" : ""}`}>
                      {teamName.get(id)}
                    </span>
                    <span className="lh-game-win mono">{pct(side.win)}</span>
                    <span className="lh-game-rec mono">{side.rec}</span>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
      <p className="lh-foot-note">Category record · model&rsquo;s chance to win the week</p>
      <Link href="/scoreboard" className="lh-more">
        Full scoreboard
      </Link>
    </section>
  );
}

/* ------------------------------------------------------------------ header */

function HeaderCard({ league }: { league: LeagueData }) {
  const weeks = league.regularSeasonWeeks ?? 19;
  const asOf = new Date(league.generatedAt).toLocaleString("en-US", {
    timeZone: ET,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const week =
    league.period <= weeks
      ? `Week ${league.period} of ${weeks}`
      : periodLabel(league);
  return (
    <section className="lh-card lh-head">
      {/* The timestamp is about the PAGE, not the league, so it sits in the title row's
          corner rather than as a fifth fact — where it also stopped wrapping onto a row
          of its own at narrower widths. */}
      <div className="lh-title-row">
        <h1 className="lh-title">{league.leagueName ?? "League Home"}</h1>
        <span className="lh-asof">Data as of {asOf}</span>
      </div>
      <dl className="lh-facts">
        <div>
          <dt>Now</dt>
          <dd>{week}</dd>
        </div>
        <div>
          <dt>Scoring</dt>
          <dd>H2H each category</dd>
        </div>
        <div>
          <dt>Categories</dt>
          <dd>{league.categories.length}</dd>
        </div>
        <div>
          <dt>Teams</dt>
          <dd>{league.teams.length}</dd>
        </div>
      </dl>
    </section>
  );
}

/* ------------------------------------------------------------------- moves */

function MovesCard({ league, pool }: { league: LeagueData; pool: PoolPlayer[] }) {
  // The draft is ~100 rows of "Draft" with one timestamp; on a front page it would bury
  // every real move under the first night of the season.
  const moves = (league.seasonData.recentMoves ?? [])
    .filter((m) => m.action !== "Draft")
    .slice(0, RECENT_MOVES);
  const valueOf = new Map(pool.map((p) => [p.name, p.value]));

  return (
    <section className="lh-card">
      <h2 className="lh-h">Recent Activity</h2>
      {moves.length === 0 ? (
        <p className="caption">No adds, drops or trades since the draft.</p>
      ) : (
        <div className="table-scroll">
          <table className="sheet lh-moves">
            <thead>
              <tr>
                <th>When</th>
                <th>Team</th>
                <th>Move</th>
                <th>Player</th>
                <th className="num">Value</th>
              </tr>
            </thead>
            <tbody>
              {moves.map((m, i) => {
                const v = valueOf.get(m.player);
                return (
                  <tr key={`${m.date}-${m.player}-${i}`}>
                    <td className="lh-when">
                      {dayLabel(m.date)} <span className="lh-time">{timeLabel(m.date)}</span>
                    </td>
                    <td>{m.team}</td>
                    <td>
                      <span className={`rm-badge ${badgeClass(m.action)}`}>{m.action}</span>
                    </td>
                    <td>
                      <PlayerLink name={m.player} />
                    </td>
                    <td className="num">{v == null ? "—" : signed(v)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Link href="/recent-moves" className="lh-more">
        All recent moves
      </Link>
    </section>
  );
}

function badgeClass(action: string) {
  if (action === "Add" || action === "Waiver Add") return "add";
  if (action === "Drop") return "drop";
  if (action === "Trade") return "trade";
  return "moved";
}

/* ------------------------------------------------------------------ trends */

/**
 * Rising and falling: last-15-day value against the season's, among players with THIS
 * season's numbers. Before anyone has played, the pool carries last season's lines
 * (statSource "last") and their trends describe last March — so they are left out rather
 * than presented as this week's movers.
 */
function TrendsCard({ pool }: { pool: PoolPlayer[] }) {
  const live = pool.filter(
    (p) =>
      (p.statSource == null || p.statSource === "current" || p.statSource === "blend") &&
      (p.gp ?? 0) >= TREND_MIN_GP &&
      (p.last15?.gp ?? 0) >= TREND_MIN_GP15
  );
  const byTrend = [...live].sort((a, b) => b.trend15 - a.trend15);
  const rising = byTrend.slice(0, TREND_ROWS).filter((p) => p.trend15 > 0);
  const falling = byTrend
    .slice(-TREND_ROWS)
    .reverse()
    .filter((p) => p.trend15 < 0);

  return (
    <section className="lh-card">
      <h2 className="lh-h">
        Rising &amp; Falling <span className="lh-h-note">last 15 days vs season value</span>
      </h2>
      {live.length === 0 ? (
        <p className="caption">
          Starts once players have a few games this season — until then every line is
          last season&rsquo;s.
        </p>
      ) : (
        <div className="lh-trends">
          <TrendList title="Rising" rows={rising} />
          <TrendList title="Falling" rows={falling} />
        </div>
      )}
      <Link href="/player-value" className="lh-more">
        Player Value
      </Link>
    </section>
  );
}

function TrendList({ title, rows }: { title: string; rows: PoolPlayer[] }) {
  return (
    <div className="lh-trend">
      <div className="lh-sub-h">{title}</div>
      {rows.length === 0 && <p className="caption">Nobody yet.</p>}
      {rows.map((p) => {
        const free = !p.owner || p.owner === "FA" || p.owner === "Waivers";
        return (
          <div className="lh-trend-row" key={p.name}>
            <span className="lh-trend-who">
              <PlayerLink name={p.name} />
              <span className={`lh-trend-own${free ? " fa" : ""}`}>
                {free ? "Free agent" : p.owner}
              </span>
            </span>
            <span className={`lh-trend-d mono ${p.trend15 >= 0 ? "up" : "dn"}`}>
              {signed(p.trend15)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------------- standings */

function StandingsCard({ league, meId }: { league: LeagueData; meId: number }) {
  const rows = [...(league.seasonData.standings ?? [])].sort((a, b) => a.standing - b.standing);
  const odds = new Map(
    (league.seasonData.playoffOdds ?? []).map((o) => [o.teamId, o.playoffProb])
  );
  const lead = rows[0];
  // Games back in a category league: half the gap in (wins - losses), the usual formula.
  const gb = (w: number, l: number) =>
    lead ? (lead.wins - w + (l - lead.losses)) / 2 : 0;

  return (
    <section className="lh-card">
      <h2 className="lh-h">Standings</h2>
      <table className="sheet lh-stand">
        <thead>
          <tr>
            <th>Team</th>
            <th className="num">W</th>
            <th className="num">L</th>
            <th className="num">T</th>
            <th className="num">GB</th>
            <th className="num" title="Chance to make the playoffs, from the season simulation">
              Playoff
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const back = gb(r.wins, r.losses);
            const p = odds.get(r.teamId);
            return (
              <tr key={r.teamId} className={r.teamId === meId ? "row-you" : undefined}>
                <td className="lh-stand-team">
                  <span className="lh-seed mono">{r.standing}</span>
                  {r.teamName}
                </td>
                <td className="num">{r.wins}</td>
                <td className="num">{r.losses}</td>
                <td className="num">{r.ties}</td>
                <td className="num">{back <= 0 ? "—" : back.toFixed(1).replace(/\.0$/, "")}</td>
                <td className="num">{p == null ? "—" : `${Math.round(p)}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <Link href="/season" className="lh-more">
        Season Summary
      </Link>
    </section>
  );
}

/* ----------------------------------------------------------- category edge */

/**
 * Your matchup, one row per category: the model's chance you take it, from banked totals
 * plus the rest of the week's projection. The Scoreboard shows the totals; this is the
 * part of /matchup that fits on a front page — where the week will be won and lost.
 */
function CategoryEdgeCard({
  league,
  meId,
  teamName,
}: {
  league: LeagueData;
  meId: number;
  teamName: Map<number, string>;
}) {
  const m = league.matchups.find((x) => x.homeId === meId || x.awayId === meId);
  if (!m) return null;
  const home = m.homeId === meId;
  const [you, opp] = home ? [m.home, m.away] : [m.away, m.home];
  const out = winProbability(league, you, opp, you.current, opp.current);
  const oppName = teamName.get(home ? m.awayId : m.homeId) ?? "Opponent";

  return (
    <section className="lh-card">
      <h2 className="lh-h">
        Your Matchup by Category{" "}
        <span className="lh-h-note">
          vs {oppName} · {out.expectedCats.toFixed(1)} cats expected
        </span>
      </h2>
      <div className="lh-edge">
        {league.categories.map((cat, i) => {
          const p = out.categoryProbs[i] ?? 0.5;
          const tone = p >= 0.6 ? "up" : p <= 0.4 ? "dn" : "even";
          return (
            <div className="lh-edge-row" key={cat}>
              <span className="lh-edge-cat">{cat}</span>
              {/* Your share of the track in cobalt, theirs in clay — the app's you/them pair. */}
              <span className="lh-edge-track" aria-hidden="true">
                <span className="lh-edge-you" style={{ width: `${p * 100}%` }} />
              </span>
              <span className={`lh-edge-p mono ${tone}`}>{pct(p)}</span>
            </div>
          );
        })}
      </div>
      <Link href="/scoreboard#odds" className="lh-more">
        Full matchup model
      </Link>
    </section>
  );
}

/* ------------------------------------------------------------- free agents */

/**
 * The best healthy players nobody has, by 9-cat value: the top one at each position, then
 * the best of the rest. Before a player has games this season that value is his 2025-26
 * line (statSource "last"), still the honest pre-season ranking.
 */
function FreeAgentsCard({ pool }: { pool: PoolPlayer[] }) {
  const free = pool
    // Injured (OUT / IR / suspended) players are left out: not available in any useful
    // sense this week (owner, 2026-10-20).
    .filter((p) => (p.owner === "FA" || !p.owner) && playerStatus(p.status)[1] !== "out")
    .sort((a, b) => b.value - a.value);
  /*
   * One per position, then one more. Eligibility, not the single listed position: a
   * PG/SG counts at both, which is how he would fill a roster spot. Taken in order and
   * never twice, so a dual-eligible player who wins PG leaves SG to the next guard.
   */
  const taken = new Set<string>();
  const fas: Array<{ slot: string; p: PoolPlayer }> = [];
  for (const slot of FA_SLOTS) {
    const p = free.find(
      (x) => !taken.has(x.name) && (x.eligibleSlots?.length ? x.eligibleSlots : [x.position]).includes(slot)
    );
    if (p) {
      taken.add(p.name);
      fas.push({ slot, p });
    }
  }
  const rest = free.find((x) => !taken.has(x.name));
  if (rest) fas.push({ slot: "Next", p: rest });

  return (
    <section className="lh-card">
      <h2 className="lh-h">
        Best Available
      </h2>
      {fas.length === 0 ? (
        <p className="caption">No free agents in the export.</p>
      ) : (
        <div className="lh-fa">
          {fas.map(({ slot, p }) => {
            const [code, sev] = playerStatus(p.status);
            return (
              <div className="lh-fa-row" key={p.name}>
                <span className="lh-fa-slot">{slot}</span>
                <span className="lh-trend-who">
                  <PlayerLink name={p.name} />
                  <span className="lh-trend-own">
                    {/* ESPN's team for an unsigned player is "FA" — in a list of fantasy
                        free agents that reads as the wrong thing, so say it outright. */}
                    {p.nbaTeam === "FA" || !p.nbaTeam ? "No NBA team" : p.nbaTeam} · {p.position}
                    {code && <span className={`lh-inj-s ${sev}`}> {code}</span>}
                  </span>
                </span>
                <span className="lh-fa-v mono">{signed(p.value)}</span>
              </div>
            );
          })}
        </div>
      )}
      <Link href="/scoreboard#streamers" className="lh-more">
        Streamers
      </Link>
    </section>
  );
}

/* ----------------------------------------------------------- power ranking */

/**
 * All-play power rankings. Before a week has been scored every row is zero (the Power
 * Rankings page hides its table for the same reason), so the card says when it starts
 * instead of printing a table of zeros.
 */
function PowerCard({
  league,
  meId,
  draft,
}: {
  league: LeagueData;
  meId: number;
  draft: Week0Rank[] | null;
}) {
  const pr = league.seasonData.powerRankings;
  const played = pr?.teams.some((t) => t.record.some((n) => n > 0));
  const draftPlace = new Map((draft ?? []).map((d) => [d.teamId, d.place]));
  // Week 1's move is measured from week 0 (the opening-day value rank), as on Rankings.
  const firstWeek = (pr?.weeks.length ?? 0) <= 1;
  const teams =
    played && pr
      ? [...pr.teams]
          .sort((a, b) => a.rank - b.rank)
          .map((t) => {
            const d = draftPlace.get(t.teamId);
            return firstWeek && d ? { ...t, delta: d - t.rank } : t;
          })
      : [];
  const nameOf = new Map(league.teams.map((t) => [t.id, t.name]));

  return (
    <section className="lh-card">
      <h2 className="lh-h">
        Power Rankings{" "}
        <span className="lh-h-note">{teams.length ? "all-play" : "week 0 · total value"}</span>
      </h2>
      {teams.length === 0 ? (
        draft?.length ? (
          <div className="lh-pr">
            {draft.map((d) => (
              <div className={`lh-pr-row${d.teamId === meId ? " you" : ""}`} key={d.teamId}>
                <span className="lh-seed mono">{d.place}</span>
                <span className="lh-pr-team">{nameOf.get(d.teamId) ?? `Team ${d.teamId}`}</span>
                <span />
                <span className="lh-pr-p mono">
                  {d.value >= 0 ? "+" : ""}
                  {d.value.toFixed(1)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="caption">Starts once week 1 is scored.</p>
        )
      ) : (
        <div className="lh-pr">
          {teams.map((t) => (
            <div className={`lh-pr-row${t.teamId === meId ? " you" : ""}`} key={t.teamId}>
              <span className="lh-seed mono">{t.rank}</span>
              <span className="lh-pr-team">{t.teamName}</span>
              <span className={`lh-pr-d mono ${t.delta > 0 ? "up" : t.delta < 0 ? "dn" : ""}`}>
                {t.delta > 0 ? `+${t.delta}` : t.delta < 0 ? t.delta : ""}
              </span>
              <span className="lh-pr-p mono">{(t.powerPct * 100).toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}
      <Link href="/rankings" className="lh-more">
        Power Rankings
      </Link>
    </section>
  );
}

/* --------------------------------------------------------------- title odds */

/** Each team's chance to win the title, from the season simulation. */
function TitleOddsCard({ league, meId }: { league: LeagueData; meId: number }) {
  const odds = [...(league.seasonData.playoffOdds ?? [])].sort(
    (a, b) => b.championshipProb - a.championshipProb
  );
  const top = Math.max(1, ...odds.map((o) => o.championshipProb));
  return (
    <section className="lh-card">
      <h2 className="lh-h">
        Title Odds <span className="lh-h-note">season simulation</span>
      </h2>
      {odds.length === 0 ? (
        <p className="caption">No season simulation in the export.</p>
      ) : (
        <div className="lh-pr">
          {odds.map((o, i) => (
            <div className={`lh-pr-row${o.teamId === meId ? " you" : ""}`} key={o.teamId}>
              <span className="lh-seed mono">{i + 1}</span>
              <span className="lh-pr-team">{o.teamName}</span>
              <span className="lh-pr-bar" aria-hidden="true">
                <span style={{ width: `${(o.championshipProb / top) * 100}%` }} />
              </span>
              <span className="lh-pr-p mono">{Math.round(o.championshipProb)}%</span>
            </div>
          ))}
        </div>
      )}
      <Link href="/playoffs" className="lh-more">
        Playoff Odds
      </Link>
    </section>
  );
}

/* ----------------------------------------------------------------- helpers */

function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function signed(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
}

/** "Oct 19", read in Eastern time like every other date in the app. */
function dayLabel(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { timeZone: ET, month: "short", day: "numeric" });
}
