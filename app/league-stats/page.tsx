import SortableTable, { type SortCol, type SortRow } from "@/components/SortableTable";
import { loadLeague, myTeam } from "@/lib/loadLeague";

/**
 * Category columns, in the legacy app's order — which is NOT `league.categories`.
 * TW is deliberately absent: it was left out of the Streamlit table and adding it here
 * would widen an already-wide table for the least-read category in the league.
 */
const CATS = [
  "FGM", "FGA", "FG%", "FT%", "3PM", "3PA", "3P%",
  "REB", "AST", "STL", "BLK", "TO", "DD", "PTS",
];

const rec = (w: number, l: number, t: number) => `${w}-${l}-${t}`;
/** A win rate as a percentage. The export stores it as a 0–1 fraction. */
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** League standings with all-play and luck, then every team's season category totals. */
export default async function Page() {
  const league = await loadLeague();
  const me = await myTeam(league);
  const standings = league.seasonData?.standings ?? [];

  if (!standings.length) {
    return (
      <>
        <h1>League Stats</h1>
        <p className="caption">No league data — run the data export.</p>
      </>
    );
  }

  /**
   * Games played by everyone who was ever on a team's roster.
   *
   * Not an ESPN category — it is summed from the per-player season lines, and it is the
   * closest thing to "did you actually use your roster spots". Every counting total below
   * is downstream of it, so a team can only out-score you here by playing more games or
   * playing better ones. Blank rather than zero if a team's player lines are missing, so
   * an absent number never reads as a team that fielded nobody.
   */
  const gpByTeam = new Map<number, number>();
  for (const t of standings) {
    const lines = league.seasonData?.teamSeasonStats?.[String(t.teamId)]?.players;
    if (lines?.length) {
      gpByTeam.set(t.teamId, lines.reduce((a, p) => a + (p.gp || 0), 0));
    }
  }

  // Luck is already in percentage points (actual win % minus all-play win %), so it is
  // printed with a % here — the same number the Season Summary shows unsuffixed.
  const luckColor = (v: number) =>
    v > 0 ? "var(--good)" : v < 0 ? "var(--bad)" : "var(--ink-2)";
  const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

  // ESPN's "Moves" is the season acquisition count — how hard a manager worked the wire.
  const hasMoves = standings.some((t) => t.acquisitions != null);
  // The fuller "Transaction Counter" widget ESPN also shows: acquisitions/drops/trades
  // plus the two roster-management counts (`moveToActive`/`moveToIR`) that Moves above
  // doesn't carry — needs the same optional-field check, for the same reason.
  const hasTxnCounter = standings.some((t) => t.moveToActive != null);

  // Every data column is right-aligned monospace, records included — they are figures
  // too, and having two of the seven left-aligned made the row read as three ragged
  // groups. Only Team stays left; # keeps the treatment it had.
  const standingCols: SortCol[] = [
    { key: "rank", label: "#", num: true },
    { key: "team", label: "Team" },
    { key: "record", label: "Record", num: true },
    { key: "pct", label: "PCT", num: true },
    { key: "allplay", label: "All-Play", num: true },
    { key: "appct", label: "AP PCT", num: true },
    { key: "luck", label: "Luck", num: true },
    // Only when the export carries it — an older snapshot would otherwise show a column
    // of zeros, which reads as "nobody made a move all season" rather than "no data".
    ...(hasMoves ? [{ key: "moves", label: "Moves", num: true }] : []),
  ];

  const standingRows: SortRow[] = standings.map((t) => ({
    id: t.teamId,
    highlight: t.teamId === me.id,
    cells: {
      rank: { sort: t.standing, text: String(t.standing) },
      team: { sort: t.teamName, text: t.teamName },
      // Records sort by the rate behind them, not the string.
      record: { sort: t.winPct, text: rec(t.wins, t.losses, t.ties) },
      pct: { sort: t.winPct, text: pct(t.winPct) },
      allplay: {
        sort: t.allPlayPct,
        text: rec(t.allPlayWins, t.allPlayLosses, t.allPlayTies),
      },
      appct: { sort: t.allPlayPct, text: pct(t.allPlayPct) },
      luck: { sort: t.luck, text: signed(t.luck), color: luckColor(t.luck) },
      ...(hasMoves
        ? {
            moves: {
              sort: t.acquisitions ?? 0,
              text: (t.acquisitions ?? 0).toLocaleString("en-US"),
            },
          }
        : {}),
    },
  }));

  const catCols: SortCol[] = [
    { key: "rank", label: "Rk", num: true },
    { key: "team", label: "Team" },
    // Ahead of the categories: it is the volume every one of them is drawn from.
    { key: "GP", label: "GP", num: true },
    ...CATS.map((c) => ({ key: c, label: c, num: true })),
  ];

  const catRows: SortRow[] = standings.map((t) => {
    const gp = gpByTeam.get(t.teamId);
    const cells: Record<string, { sort: number | string; text: string }> = {
      rank: { sort: t.standing, text: String(t.standing) },
      team: { sort: t.teamName, text: t.teamName },
      GP: {
        sort: gp ?? -1,
        text: gp === undefined ? "—" : gp.toLocaleString("en-US"),
      },
    };
    for (const c of CATS) {
      const v = t.catTotals[c] ?? 0;
      cells[c] = {
        sort: v,
        // Rates keep three decimals, the way the legacy table printed them.
        text: c.includes("%") ? v.toFixed(3) : Math.round(v).toLocaleString("en-US"),
      };
    }
    return { id: t.teamId, highlight: t.teamId === me.id, cells };
  });

  // ESPN's own "Transaction Counter" widget: LOSS is that team's standings loss column,
  // repeated here rather than derived from a different source, so it matches Full League
  // Standings above exactly.
  const txnCols: SortCol[] = [
    { key: "team", label: "Team Name" },
    { key: "loss", label: "Loss", num: true },
    { key: "trade", label: "Trade", num: true },
    { key: "acq", label: "Acquisitions", num: true },
    { key: "drop", label: "Drop", num: true },
    { key: "activate", label: "Activate", num: true },
    { key: "ir", label: "IR", num: true },
  ];

  const txnRows: SortRow[] = standings.map((t) => ({
    id: t.teamId,
    highlight: t.teamId === me.id,
    cells: {
      team: { sort: t.teamName, text: t.teamName },
      loss: { sort: t.losses, text: String(t.losses) },
      trade: { sort: t.trades ?? 0, text: String(t.trades ?? 0) },
      acq: { sort: t.acquisitions ?? 0, text: String(t.acquisitions ?? 0) },
      drop: { sort: t.drops ?? 0, text: String(t.drops ?? 0) },
      activate: { sort: t.moveToActive ?? 0, text: String(t.moveToActive ?? 0) },
      ir: { sort: t.moveToIR ?? 0, text: String(t.moveToIR ?? 0) },
    },
  }));

  return (
    <>
      <h1>League Stats</h1>

      <h2>Full League Standings</h2>
      <SortableTable
        cols={standingCols}
        rows={standingRows}
        defaultKey="rank"
        defaultDesc={false}
      />

      <h2>Season Category Totals</h2>
      <SortableTable cols={catCols} rows={catRows} defaultKey="PTS" />

      {hasTxnCounter && (
        <>
          <h2>Transaction Counter</h2>
          {/* Opens on acquisitions, descending: the counter is read to see who worked
              the wire hardest, and alphabetical order answered nothing. */}
          <SortableTable cols={txnCols} rows={txnRows} defaultKey="acq" defaultDesc />
        </>
      )}
    </>
  );
}
