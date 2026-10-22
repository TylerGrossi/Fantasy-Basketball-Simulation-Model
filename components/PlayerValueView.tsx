"use client";

import { useMemo, useState } from "react";
import type { LeagueData, PoolPlayer } from "@/lib/league";
import type { ArchivedPool } from "@/lib/loadLeague";
import MultiSelect from "./MultiSelect";
import FilterBar from "./FilterBar";
import PlayerLink from "./PlayerLink";
import StatusBadge from "./StatusBadge";
import SortableTable, { type SortCol, type SortRow } from "./SortableTable";
import {
  gpFor,
  MIN_GP_OPTIONS,
  POSITION_ORDER,
  VALUE_BASES,
  VALUE_COL,
  type ValueBasis,
  playerStatus,
  seasonLabel,
  thisSeasonOnly,
} from "@/lib/playerPool";

/**
 * Every rostered player plus the top free agents, ranked by value, as one sortable table.
 *
 * Was a list of tappable rows with a translucent value bar behind each and the stats
 * hidden in an expandable card (owner asked for a table, 2026-10-20): comparing two
 * players meant opening both. Now every number is a column and any column sorts. The
 * card's headshot and game log live on the Player Card, which the name links to.
 *
 * All filtering is client-side over the exported pool — instant at ~290 players.
 */

/** Per-game counting stats, in the expanded card's order plus the league's extra cats. */
const STATS = ["PTS", "REB", "AST", "STL", "BLK", "3PM", "DD", "TO"];

const COLS: SortCol[] = [
  { key: "rank", label: "#", num: true },
  { key: "name", label: "Player" },
  { key: "nba", label: "NBA" },
  { key: "pos", label: "Pos" },
  { key: "owner", label: "Owner" },
  { key: "gp", label: "GP", num: true },
  // All three value windows at once, so "is he heating up" needs no basis toggling.
  { key: "value", label: "Value", num: true, leader: true },
  { key: "v30", label: "30D", num: true, leader: true },
  { key: "v15", label: "15D", num: true, leader: true },
  { key: "t30", label: "30D Δ", num: true },
  { key: "t15", label: "15D Δ", num: true },
  ...STATS.slice(0, 5).map((key) => ({ key, label: key, num: true, leader: true })),
  { key: "STOCKS", label: "STK", num: true, leader: true },
  ...STATS.slice(5).map((key) => ({ key, label: key, num: true, leader: key !== "TO" })),
  { key: "fg", label: "FG%", num: true },
  { key: "ft", label: "FT%", num: true },
  { key: "tp", label: "3P%", num: true },
];

const signed = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
const tone = (v: number) => (v > 0 ? "var(--good)" : v < 0 ? "var(--bad)" : undefined);
const score = (v: number | undefined) => {
  const n = Number(v ?? 0);
  return { sort: n, text: signed(n), color: tone(n) };
};
const perGame = (v: number) => ({ sort: v, text: v.toFixed(1) });
const pctCell = (v: number) => ({ sort: v, text: (v * 100).toFixed(1) });

export default function PlayerValueView({
  league,
  archives = [],
}: {
  league: LeagueData;
  archives?: ArchivedPool[];
}) {
  /*
   * WHICH SEASON (owner, 2026-10-21), this one by default — and this one means only this
   * season's games: a player who has not played is left out, and one under ten games is
   * shown on his actual line, not the ranking blend with last season (thisSeasonOnly).
   * Past seasons come from the archive, as they stand at that season's end.
   */
  const [season, setSeason] = useState(league.season);
  const current = season === league.season;
  const pool = useMemo(() => {
    if (!current) return archives.find((a) => a.season === season)?.pool ?? [];
    return (league.seasonData.playerPool ?? [])
      .filter((p) => p.statSource === "current" || p.statSource === "blend")
      .map(thisSeasonOnly);
  }, [current, season, archives, league.seasonData.playerPool]);

  const [name, setName] = useState("");
  const [positions, setPositions] = useState<string[]>([]);
  const [nbaTeams, setNbaTeams] = useState<string[]>([]);
  const [owners, setOwners] = useState<string[]>([]);
  const [basis, setBasis] = useState<ValueBasis>("Regular");
  const [showInjured, setShowInjured] = useState(true);
  /*
   * Null until the reader picks one: then the default follows the season. Ten games is
   * the right bar for a season in full, and an empty table in a season's first weeks —
   * nobody has ten games yet — so the current season starts at Any until it does.
   */
  const [pickedMinGp, setMinGp] = useState<number | null>(null);
  const young = current && Math.max(0, ...pool.map((p) => p.gp ?? 0)) < 10;
  const minGp = pickedMinGp ?? (young ? 0 : 10);

  const valueCol = VALUE_COL[basis];

  // Basketball order (PG -> C), not alphabetical: "C, PF, PG, SF, SG" reads as noise to
  // anyone who thinks in lineup slots. Anything unexpected is appended alphabetically.
  const positionOptions = useMemo(() => {
    const present = new Set(pool.map((p) => p.position).filter(Boolean));
    return [
      ...POSITION_ORDER.filter((p) => present.has(p)),
      ...[...present].filter((p) => !POSITION_ORDER.includes(p)).sort(),
    ];
  }, [pool]);

  const teamOptions = useMemo(
    () => [...new Set(pool.map((p) => p.nbaTeam).filter(Boolean))].sort(),
    [pool]
  );

  // Free agents first — it is the one "owner" that gets filtered to constantly, and
  // alphabetical buried it between team names.
  const ownerOptions = useMemo(() => {
    const all = [...new Set(pool.map((p) => p.owner).filter(Boolean))].sort();
    return [...all.filter((o) => o === "FA"), ...all.filter((o) => o !== "FA")];
  }, [pool]);

  const rows = useMemo<SortRow[]>(() => {
    const q = name.trim().toLowerCase();
    const kept = pool.filter((p) => {
      if (q && !p.name.toLowerCase().includes(q)) return false;
      if (positions.length && !positions.includes(p.position)) return false;
      if (nbaTeams.length && !nbaTeams.includes(p.nbaTeam)) return false;
      if (owners.length && !owners.includes(p.owner)) return false;
      if (!showInjured && playerStatus(p.status)[1] === "out") return false;
      if (minGp > 0 && gpFor(p, basis) < minGp) return false;
      return true;
    });
    // "#" is the VALUE rank among what is shown, fixed while other columns re-sort, so
    // sorting by rebounds still tells you where each player sits on value.
    const ranked = [...kept].sort((a, b) => b[valueCol] - a[valueCol]);
    return ranked.map((p, i) => playerRow(p, i + 1, basis));
  }, [pool, name, positions, nbaTeams, owners, showInjured, minGp, basis, valueCol]);

  if (!pool.length) {
    return <p className="caption">No player pool data — run the data export.</p>;
  }

  return (
    <>
      <FilterBar className="controls pv-filters">
        {/* Widths come from .pv-f-* in globals.css so the six controls share one row —
            see the note there. Position/NBA Team/Value basis hold short values and are
            sized down; the two that hold long text take the leftover space. */}
        <div className="ms pv-f-name">
          <div className="ms-label">Player name</div>
          <input
            className="field"
            type="search"
            placeholder="Search…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Player name"
          />
        </div>
        <MultiSelect
          label="Position"
          options={positionOptions}
          selected={positions}
          onChange={setPositions}
          className="pv-f-pos"
        />
        <MultiSelect
          label="NBA Team"
          options={teamOptions}
          selected={nbaTeams}
          onChange={setNbaTeams}
          searchable
          className="pv-f-team"
        />
        <MultiSelect
          label="Fantasy Owner"
          options={ownerOptions}
          selected={owners}
          onChange={setOwners}
          className="pv-f-owner"
        />
        <div className="ms pv-f-season">
          <div className="ms-label">Season</div>
          <select
            className="field field-select"
            value={season}
            onChange={(e) => setSeason(Number(e.target.value))}
            aria-label="Season"
          >
            {[league.season, ...archives.map((a) => a.season)].map((s) => (
              <option key={s} value={s}>
                {seasonLabel(s)}
              </option>
            ))}
          </select>
        </div>
        <div className="ms pv-f-basis">
          <div className="ms-label">Value basis</div>
          <select
            className="field field-select"
            value={basis}
            onChange={(e) => setBasis(e.target.value as ValueBasis)}
            aria-label="Value basis"
          >
            {VALUE_BASES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <div className="ms pv-f-gp">
          <div className="ms-label">Min GP</div>
          <select
            className="field field-select"
            value={minGp}
            onChange={(e) => setMinGp(Number(e.target.value))}
            aria-label="Minimum games played"
          >
            {MIN_GP_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "Any" : n}
              </option>
            ))}
          </select>
        </div>
        <label className="check pv-injured">
          <input
            type="checkbox"
            checked={showInjured}
            onChange={(e) => setShowInjured(e.target.checked)}
          />
          Show injured players
        </label>
      </FilterBar>

      {rows.length === 0 ? (
        <p className="caption">No players match these filters.</p>
      ) : (
        // Keyed on the basis: switching it re-ranks everything, so start back on the
        // value sort rather than keeping a column sort over the old numbers.
        <SortableTable
          key={`${season}-${basis}`}
          cols={COLS}
          rows={rows}
          defaultKey="rank"
          defaultDesc={false}
          className="sticky-2 pv-table"
          pageSize={50}
        />
      )}

      {/* A footnote, not something that needs to sit above the data. */}
      <p className="caption" style={{ marginTop: "1rem" }}>
        <strong>Value</strong> is a z-score across all 15 of this league&rsquo;s categories
        (points above/below an average leaguer — shooting volume, DD and TW included);{" "}
        <strong>30D</strong> and{" "}
        <strong>15D</strong> are the same score over the last 30 and 15 days, and the{" "}
        <strong>Δ</strong> columns are those minus the season: positive = heating up.{" "}
        <strong>#</strong> ranks by the value basis, and GP and the stat columns follow it
        {basis === "Regular" ? " (season per-game)" : ` (last ${basis === "30D" ? 30 : 15} days per-game)`}.
        STK is steals + blocks. Click any header to sort. Covers every rostered player plus
        the top free agents.{" "}
        {current
          ? `${seasonLabel(season)} counts only games played this season — a player who has not played yet is not listed.`
          : `${seasonLabel(season)} as it stood at the end of that season.`}
      </p>
    </>
  );
}

function playerRow(p: PoolPlayer, rank: number, basis: ValueBasis): SortRow {
  // The recent windows when the basis asks for one; the season line otherwise, and also
  // when a window is empty (no games in it), which is not the same as a line of zeros.
  const w = basis === "30D" ? p.last30 : basis === "15D" ? p.last15 : undefined;
  const win = w?.gp ? w : undefined;
  const stat = (k: string) =>
    Number(win?.[k] ?? (p as unknown as Record<string, number>)[k] ?? 0);
  const ratio = (made: string, att: string, season: number) => {
    const m = win?.[made];
    const a = win?.[att];
    return m != null && a ? m / a : season;
  };
  const fg = ratio("FGM", "FGA", p.fgPct);
  const ft = ratio("FTM", "FTA", p.ftPct);
  const tp = ratio("3PM", "3PA", p.tpPct);
  const isFa = p.owner === "FA";
  const [code] = playerStatus(p.status);

  const cells: SortRow["cells"] = {
    rank: { sort: rank, text: String(rank) },
    name: {
      sort: p.name,
      text: p.name,
      node: (
        <span className="pv-tname">
          <PlayerLink name={p.name} />
          {code && <StatusBadge status={p.status} />}
        </span>
      ),
    },
    nba: { sort: p.nbaTeam || "", text: p.nbaTeam || "-" },
    pos: { sort: p.position || "", text: p.position || "-" },
    owner: {
      sort: isFa ? "" : p.owner,
      text: isFa ? "FA" : p.owner,
      node: isFa ? <span className="pv-fa">FA</span> : undefined,
    },
    gp: { sort: gpFor(p, basis), text: String(gpFor(p, basis)) },
    value: score(p.value),
    v30: score(p.recent),
    v15: score(p.recent15),
    t30: score(p.trend),
    t15: score(p.trend15),
    STOCKS: perGame(stat("STL") + stat("BLK")),
    fg: pctCell(fg),
    ft: pctCell(ft),
    tp: pctCell(tp),
  };
  for (const k of STATS) cells[k] = perGame(stat(k));
  return { id: `${p.name}-${p.playerId ?? rank}`, cells };
}
