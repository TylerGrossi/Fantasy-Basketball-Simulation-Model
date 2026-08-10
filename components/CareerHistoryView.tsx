import SortableTable, { type SortCol, type SortRow } from "./SortableTable";
import CareerPlayersTable, { type CareerPlayerRow } from "./CareerPlayersTable";
import {
  RATE_MIN_GP,
  careerTotals,
  gameLog,
  hallOfFame,
  headToHead,
  managerTable,
  myOwnerName,
  type CareerLog,
} from "@/lib/career";

/**
 * The History section, as one component per page.
 *
 * Split into pages rather than one long scroll because the tables answer different
 * questions and are read on different occasions — the player table is 196 rows and the
 * matchup log 128, and stacked together everything below the first was scrolled past
 * rather than read. Each export below is a whole page under /history.
 *
 * Everything here is keyed on the PERSON, never the team name: managers rename their team
 * most years, and this manager has been "Team Grossi", "New Balance Ballers" and
 * "VJ Maxx". Grouping by name would scatter one rival across five rows of one game each.
 */

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const rate = (v: number) => (v > 0 ? v.toFixed(3).replace(/^0/, "") : "—");

/** "2024-25" from ESPN's seasonId of 2025 — "2025" alone is ambiguous across a table. */
const seasonLabel = (s: number) => `${s - 1}-${String(s % 100).padStart(2, "0")}`;
const shortSeason = (s: number) =>
  `${String((s - 1) % 100).padStart(2, "0")}-${String(s % 100).padStart(2, "0")}`;

export function span(log: CareerLog): string {
  const years = log.seasons.map((s) => s.season).sort((a, b) => a - b);
  if (!years.length) return "";
  return `${years[0] - 1}-${String(years[years.length - 1] % 100).padStart(2, "0")}`;
}

function ordinal(n: number): string {
  const r = n % 100;
  if (r >= 11 && r <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}

/* -------------------------------------------------------------------------- */
/* Seasons — the landing page, DESKTOP                                         */
/* -------------------------------------------------------------------------- */

/*
 * The wide half of /history. `components/SeasonShelf.tsx` is the phone half, and its
 * header comment says why a shelf reads better there — everything it argues is true of a
 * 390px screen and none of it is true of a 1180px one. A laptop has the width to put
 * eight columns side by side, and side by side is the only way one season gets COMPARED
 * to another. Both are rendered; `.only-web` / `.only-app` in globals.css pick.
 */

/** Career totals, as five tiles. The shelf's strip is the same figures cut to two. */
export function CareerStrip({ log }: { log: CareerLog }) {
  const t = careerTotals(log);
  const [w, l, ti] = t.record;
  /*
   * Five tiles, no sub-line.
   *
   * The win rate was the record tile's caption, which buried the one number most likely
   * to be looked up on a page of career totals. Promoting it to its own tile is also what
   * made the sub-row removable: of the four captions, it was the only one carrying a
   * figure rather than restating its label ("2017-26" under Seasons, "finished 1st" under
   * Titles), and a row of tiles reads faster when every tile is one number.
   *
   * "Category" is in the label rather than under it because the record beside it is in
   * categories too — 814-496-25 is categories won across six seasons, not matchups, and
   * an unqualified "Win %" next to it would invite reading both as a matchup record.
   *
   * No tile colours its value. Green is the app's "this is good" signal and it was firing
   * on two of five here — a career win rate and a title count are the subject of the page,
   * not a warning, and colouring some tiles and not others made the plain ones read as
   * though something were wrong with them.
   */
  return (
    <div className="metrics metrics-5">
      <Tile label="Seasons" value={String(t.seasons)} />
      <Tile label="All-time record" value={`${w}-${l}${ti ? `-${ti}` : ""}`} />
      <Tile label="Category win %" value={pct(t.winPct)} />
      <Tile label="Titles" value={String(t.titles)} />
      <Tile label="Players rostered" value={String(t.distinctPlayers)} />
    </div>
  );
}

export function SeasonsTable({ log }: { log: CareerLog }) {
  const cols: SortCol[] = [
    { key: "season", label: "Season" },
    { key: "team", label: "Team" },
    { key: "league", label: "League" },
    { key: "record", label: "Record", num: true },
    { key: "winPct", label: "Win %", num: true },
    { key: "finish", label: "Finish", num: true },
    { key: "players", label: "Players used", num: true },
  ];
  const rows: SortRow[] = log.seasons.map((s) => {
    const [w, l, t] = s.record;
    const decided = w + l;
    const wp = decided > 0 ? w / decided : 0;
    return {
      id: `${s.leagueId}-${s.season}`,
      cells: {
        season: { sort: s.season, text: seasonLabel(s.season) },
        team: { sort: s.teamName, text: s.teamName },
        league: { sort: s.leagueName || "", text: s.leagueName || "—" },
        record: { sort: wp, text: `${w}-${l}${t ? `-${t}` : ""}` },
        winPct: { sort: wp, text: pct(wp) },
        finish: {
          sort: s.finalStanding || s.standing || 99,
          text: s.finalStanding ? ordinal(s.finalStanding) : "—",
          color: s.finalStanding === 1 ? "var(--good)" : undefined,
        },
        players: { sort: s.players.length, text: String(s.players.length) },
      },
    };
  });
  return <SortableTable cols={cols} rows={rows} defaultKey="season" defaultDesc />;
}

/* -------------------------------------------------------------------------- */
/* Players                                                                     */
/* -------------------------------------------------------------------------- */

/** Rows per page. The full 196 stay in the table — see `pageSize` in SortableTable. */
const PLAYER_ROWS = 50;

/**
 * Every player ever rostered.
 *
 * A thin server shim: it maps the career log down to the compact per-player numbers the
 * table needs and hands them over. The unit toggle and the leader bolding live in the
 * client component, because both are view state — and the log itself must not cross that
 * boundary, so the mapping happens here rather than there.
 */
export function PlayersTable({ log }: { log: CareerLog }) {
  const players: CareerPlayerRow[] = hallOfFame(log).map((p) => ({
    id: p.playerId,
    name: p.name,
    seasons: p.seasons,
    days: p.days,
    gp: p.gp,
    PTS: p.PTS, REB: p.REB, AST: p.AST, STL: p.STL, BLK: p.BLK,
    // Renamed off "3PM" so the row is a plain identifier-keyed object; the column keeps
    // the "3PM" label the rest of the app uses.
    TPM: p["3PM"],
    TO: p.TO,
    fgPct: p.fgPct,
    fga: p.fga,
    titles: p.titles,
    rating: p.rating,
    honors: p.jersey ? "Jersey" : p.hof ? "HoF" : null,
  }));
  return <CareerPlayersTable players={players} minGp={RATE_MIN_GP} />;
}

/** The headline counts above the player table — how exclusive the rafters actually are. */
export function HallOfFameStrip({ log }: { log: CareerLog }) {
  const players = hallOfFame(log);
  const hof = players.filter((p) => p.hof);
  const jerseys = players.filter((p) => p.jersey);
  const top = players[0];
  return (
    /* Four tiles, so no `metrics-3` — the base `.metrics` grid is already 4-up on desktop.
       `hof-strip` hides the whole row on a phone: as 2x2 it cost ~230px above the fold and
       pushed the player table, which is the page, most of a screen down. The four figures
       are context, not the reason you opened this. */
    <div className="metrics hof-strip">
      {/*
        Bare counts, no subtitles. They used to read "of 196 ever rostered" and a list of
        the four retired jerseys, both of which the table directly below already says — the
        Honors column names every one of them. The 196 was worth keeping though, so it is
        its own tile now rather than a footnote on another number.

        It leads, because it is the denominator the other three are read against: 196
        rostered, 7 of them in the Hall, 4 in the rafters.

        No `good` colour on the Hall count either — green is this app's "in your favour"
        marker, and a museum count is not a result.
      */}
      <Tile label="Players rostered" value={String(players.length)} />
      <Tile label="Hall of Famers" value={String(hof.length)} />
      <Tile label="Jerseys retired" value={String(jerseys.length)} />
      <Tile
        label="Top rating"
        value={top && top.rating > 0 ? top.rating.toFixed(1) : "—"}
        sub={top && top.rating > 0 ? top.name : "not enough games"}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Head to head                                                                */
/* -------------------------------------------------------------------------- */

export function HeadToHeadTable({ log }: { log: CareerLog }) {
  const h2h = headToHead(log);
  const cols: SortCol[] = [
    { key: "owner", label: "Opponent" },
    { key: "meetings", label: "Played", num: true },
    { key: "record", label: "Record", num: true },
    { key: "winPct", label: "Win %", num: true },
    { key: "po", label: "Playoffs", num: true },
    { key: "avgFor", label: "Cats/wk", num: true },
    { key: "avgAgainst", label: "Opp cats", num: true },
    { key: "best", label: "Best", num: true },
    { key: "diff", label: "Diff", num: true },
    { key: "closest", label: "Closest", num: true },
  ];
  const rows: SortRow[] = h2h.map((h) => ({
    id: h.owner,
    cells: {
      owner: { sort: h.owner, text: h.owner },
      meetings: { sort: h.meetings, text: String(h.meetings) },
      record: {
        sort: h.winPct,
        text: `${h.wins}-${h.losses}${h.ties ? `-${h.ties}` : ""}`,
      },
      winPct: {
        sort: h.winPct,
        text: pct(h.winPct),
        color: h.winPct > 0.5 ? "var(--good)" : h.winPct < 0.5 ? "var(--bad)" : undefined,
      },
      // A dash, not 0-0: most opponents have simply never been met in a playoff, and a
      // zero record would read as having lost games that were never played.
      po: {
        sort: h.playoffW + h.playoffL,
        text: h.playoffW + h.playoffL ? `${h.playoffW}-${h.playoffL}` : "—",
      },
      avgFor: { sort: h.avgFor, text: h.scored ? h.avgFor.toFixed(1) : "—" },
      avgAgainst: { sort: h.avgAgainst, text: h.scored ? h.avgAgainst.toFixed(1) : "—" },
      best: { sort: h.best, text: h.scored ? String(h.best) : "—" },
      diff: {
        sort: h.diff,
        text: h.scored ? `${h.diff > 0 ? "+" : ""}${h.diff}` : "—",
        color: h.diff > 0 ? "var(--good)" : h.diff < 0 ? "var(--bad)" : undefined,
      },
      closest: { sort: h.closest, text: h.scored ? String(h.closest) : "—" },
    },
  }));
  return <SortableTable cols={cols} rows={rows} defaultKey="meetings" defaultDesc />;
}

/* -------------------------------------------------------------------------- */
/* Managers                                                                    */
/* -------------------------------------------------------------------------- */

export function ManagersTable({ log }: { log: CareerLog }) {
  const managers = managerTable(log, myOwnerName(log));
  const cols: SortCol[] = [
    { key: "owner", label: "Manager" },
    { key: "seasons", label: "Seasons", num: true },
    { key: "avgFinish", label: "Avg finish", num: true },
    { key: "best", label: "Best", num: true },
    { key: "worst", label: "Worst", num: true },
    { key: "titles", label: "Titles", num: true },
    { key: "record", label: "Record", num: true },
    { key: "winPct", label: "Win %", num: true },
  ];
  const rows: SortRow[] = managers.map((m) => ({
    id: m.owner,
    highlight: m.isYou,
    cells: {
      owner: { sort: m.owner, text: m.owner },
      seasons: { sort: m.seasons, text: String(m.seasons) },
      avgFinish: {
        sort: m.avgFinish || 99,
        text: m.avgFinish ? m.avgFinish.toFixed(1) : "—",
      },
      best: { sort: m.bestFinish || 99, text: m.bestFinish ? ordinal(m.bestFinish) : "—" },
      worst: { sort: m.worstFinish, text: m.worstFinish ? ordinal(m.worstFinish) : "—" },
      titles: {
        sort: m.titles,
        text: String(m.titles),
        color: m.titles > 0 ? "var(--good)" : undefined,
      },
      record: {
        sort: m.winPct,
        text: `${m.wins}-${m.losses}${m.ties ? `-${m.ties}` : ""}`,
      },
      winPct: { sort: m.winPct, text: pct(m.winPct) },
    },
  }));
  return (
    <SortableTable cols={cols} rows={rows} defaultKey="titles" defaultDesc />
  );
}

/* -------------------------------------------------------------------------- */
/* Matchups — DESKTOP                                                          */
/* -------------------------------------------------------------------------- */

/*
 * The wide half of /history/matchups; `components/MatchupFeed.tsx` is the phone half.
 *
 * The feed's case against this table — nine columns, three of them repeating the season
 * down 128 rows — is a case about a 390px screen. On a laptop those columns are the
 * feature: this is the only view of the log you can SORT, so "my worst week ever" and
 * "every game against Ronnie" are one header click away, and the feed cannot answer
 * either. Sorted, the repeated Season and Type columns stop being repetition.
 */

export function MatchupsTable({ log }: { log: CareerLog }) {
  const games = gameLog(log);
  const cols: SortCol[] = [
    { key: "when", label: "Season" },
    { key: "week", label: "Week", num: true },
    { key: "team", label: "Your team" },
    { key: "opp", label: "Opponent" },
    { key: "cats", label: "Score", num: true },
    { key: "oppCats", label: "Opp", num: true },
    { key: "type", label: "Type" },
    { key: "diff", label: "Diff", num: true },
    { key: "result", label: "Result" },
  ];
  const rows: SortRow[] = games.map((g, i) => {
    const d = g.scoreFor - g.scoreAgainst;
    // A points week prints 1,643.0; a category week prints 9. Same column, different
    // units — which is why the header says "Score" and the Type column names the format.
    const fmt = (v: number) =>
      g.scoring === "points" ? v.toFixed(1) : String(v);
    /* A first-round playoff bye. ESPN files it as a 0-0 entry with no opponent, so every
       score column here would otherwise print a zero that looks like a shutout. The row
       stays — earning a bye is worth seeing — but as dashes. */
    const bye = g.bye || g.result === "BYE";
    return {
      id: `${g.season}-${g.week}-${i}`,
      cells: {
        // Sorted on a composite so "newest first" holds ACROSS seasons — sorting on the
        // week alone would interleave every season's week 1.
        when: { sort: g.season * 100 + (g.week ?? 0), text: seasonLabel(g.season) },
        week: {
          sort: g.week ?? 0,
          text: g.playoff ? `${g.week} (PO)` : String(g.week ?? "—"),
        },
        team: { sort: g.teamName, text: g.teamName },
        opp: { sort: g.oppOwner, text: bye ? "—" : g.oppOwner },
        cats: { sort: g.scoreFor, text: bye ? "—" : fmt(g.scoreFor) },
        oppCats: { sort: g.scoreAgainst, text: bye ? "—" : fmt(g.scoreAgainst) },
        type: {
          sort: g.scoring,
          text: bye ? "—" : g.scoring === "points" ? "Points" : "Cats",
        },
        diff: {
          sort: d,
          text: bye ? "—" : `${d > 0 ? "+" : ""}${fmt(d)}`,
          color: bye ? undefined : d > 0 ? "var(--good)" : d < 0 ? "var(--bad)" : undefined,
        },
        result: {
          sort: g.result,
          text: bye ? "Bye" : g.result === "W" ? "Won" : g.result === "L" ? "Lost" : "Tied",
          color:
            bye ? "var(--ink-3)"
              : g.result === "W" ? "var(--good)"
                : g.result === "L" ? "var(--bad)"
                  : undefined,
        },
      },
    };
  });
  return <SortableTable cols={cols} rows={rows} defaultKey="when" defaultDesc />;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div className="metric-value mono">{value}</div>
      {sub && <div className="metric-delta mono">{sub}</div>}
    </div>
  );
}
