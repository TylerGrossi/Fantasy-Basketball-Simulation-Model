import SortableTable, { type SortCol, type SortRow } from "./SortableTable";
import CareerPlayersTable, { type CareerPlayerRow } from "./CareerPlayersTable";
import {
  RATE_MIN_GP,
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

/*
 * The landing page's own two components — a 4-tile career strip and an eight-column
 * seasons table — used to live here. They are now `components/SeasonShelf.tsx`, which
 * says why the table became a shelf.
 */

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

/*
 * The matchup log used to be a nine-column table here. It is now the scores feed in
 * `components/MatchupFeed.tsx` — two scores on the outside, the result in the middle.
 */

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="metric">
      <div className="eyebrow">{label}</div>
      <div className="metric-value mono">{value}</div>
      {sub && <div className="metric-delta mono">{sub}</div>}
    </div>
  );
}
