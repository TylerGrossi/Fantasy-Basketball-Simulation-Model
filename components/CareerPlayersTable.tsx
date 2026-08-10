"use client";

import { useMemo, useState } from "react";
import PlayerLink from "./PlayerLink";
import SortableTable, { type SortCol, type SortRow } from "./SortableTable";
import FilterBar from "./FilterBar";

/**
 * The career players table: every player ever rostered, in one of three units.
 *
 * Same two ideas as the season table (SeasonStatsView), on purpose — a reader who learns
 * one should not have to learn the other:
 *
 *   1. **A unit toggle.** The career line is stored per game, so Totals multiplies it back
 *      out by games played and "% of total" divides by the all-time franchise total.
 *   2. **Bold marks the leader, ALWAYS BY TOTAL.** Leading a category is a fact about a
 *      career and does not change because you asked to see it per game — switching the
 *      unit re-expresses the same players' numbers rather than crowning a different one.
 *      It also disposes of the small-sample problem for counting stats: a two-game
 *      streamer who went for 30 can top a per-game column but can never top a total.
 *
 * A CLIENT component because the toggle is view state, and it takes the compact per-player
 * numbers rather than pre-built table rows: deriving the three units here is both smaller
 * in the payload than shipping three sets of formatted cells and the only way the toggle
 * can be instant. The career log itself never crosses the boundary — the server maps it
 * down to `CareerPlayerRow` first (see CareerHistoryView).
 */

export interface CareerPlayerRow {
  id: number;
  name: string;
  seasons: number[];
  days: number;
  gp: number;
  /** Per-game averages, weighted by games — see `careerPlayers` in lib/career.ts. */
  PTS: number; REB: number; AST: number; STL: number; BLK: number;
  TPM: number; TO: number;
  fgPct: number;
  /** Field-goal attempts per game: the volume that qualifies the percentage. */
  fga: number;
  titles: number;
  rating: number;
  honors: "Jersey" | "HoF" | null;
}

type Mode = "total" | "game" | "share";

const MODES: Array<[Mode, string]> = [
  ["total", "Totals"],
  ["game", "Per game"],
  ["share", "% of total"],
];

/** The per-game columns the unit toggle applies to, and the label each wears. */
const STATS: Array<{ key: string; label: string; of: keyof CareerPlayerRow }> = [
  { key: "PTS", label: "PTS", of: "PTS" },
  { key: "REB", label: "REB", of: "REB" },
  { key: "AST", label: "AST", of: "AST" },
  { key: "STL", label: "STL", of: "STL" },
  { key: "BLK", label: "BLK", of: "BLK" },
  { key: "3PM", label: "3PM", of: "TPM" },
  { key: "TO", label: "TO", of: "TO" },
];

/**
 * Columns with no bold leader.
 *
 * Only **TO**, and only because it is lower-is-better: the biggest number would decorate
 * the most careless player as though it were an achievement, and the smallest just finds
 * whoever played least. Neither is a leader.
 *
 * Days and Games ARE bolded. On a career table they are not mere sample size — most days
 * rostered is the answer to "who did you keep", which is what this page is about, and both
 * are totals, so they qualify themselves.
 */
const NO_LEADER = new Set(["TO", "seasons", "name", "honors"]);

/** Attempts a player needs before their FG% can lead, as a share of the biggest volume. */
const QUALIFY = 0.2;

/** "24-25" from ESPN's seasonId of 2025 — carried over verbatim from CareerHistoryView,
 *  where this column used to be built. A bare "'25" would have quietly restyled it. */
const shortSeason = (s: number) =>
  `${String((s - 1) % 100).padStart(2, "0")}-${String(s % 100).padStart(2, "0")}`;

/** Rows per page. The full 196 stay in the table — see `pageSize` in SortableTable. */
const PLAYER_ROWS = 50;

export default function CareerPlayersTable({
  players,
  /** Career games below which a per-game line is noise — lib/career.ts RATE_MIN_GP. */
  minGp,
}: {
  players: CareerPlayerRow[];
  minGp: number;
}) {
  // Totals first: it is the unit the bold leaders are ranked in, so the default view is the
  // one where the bold needs no explaining.
  const [mode, setMode] = useState<Mode>("total");

  const { cols, rows } = useMemo(() => {
    // Franchise totals, the denominator for "% of total".
    const totals: Record<string, number> = {};
    for (const s of STATS) {
      totals[s.key] = players.reduce((a, p) => a + (p[s.of] as number) * p.gp, 0);
    }
    const maxFga = Math.max(0, ...players.map((p) => p.fga * p.gp));

    const cols: SortCol[] = [
      { key: "name", label: "Player" },
      { key: "seasons", label: "Seasons" },
      { key: "days", label: "Days", num: true, leader: true },
      { key: "gp", label: "Games", num: true, leader: true },
      ...STATS.map((s) => ({
        key: s.key,
        label: s.label,
        num: true,
        leader: !NO_LEADER.has(s.key),
      })),
      { key: "fg", label: "FG%", num: true, leader: true },
      { key: "titles", label: "Titles", num: true, leader: true },
      { key: "rating", label: "Rating", num: true, leader: true },
      // HoF and Jersey were two columns that were never independent — a retired jersey
      // always implies the Hall. One column says the same thing and buys back the width.
      { key: "honors", label: "Honors" },
    ];

    const rows: SortRow[] = players.map((p) => {
      const cells: SortRow["cells"] = {
        // Linked, like every other player name in the app — this is a 196-row table of
        // players and the card is the obvious next tap. `text` stays the plain name so
        // sorting and the leader logic never see an element.
        name: { sort: p.name, text: p.name, node: <PlayerLink name={p.name} /> },
        seasons: { sort: p.seasons[0] ?? 0, text: p.seasons.map(shortSeason).join(", ") },
        days: { sort: p.days, text: String(p.days) },
        gp: { sort: p.gp, text: p.gp ? String(p.gp) : "—" },
        fg: {
          sort: p.fgPct,
          text: p.fgPct > 0 ? p.fgPct.toFixed(3).replace(/^0/, "") : "—",
          /*
           * A percentage has no total to rank by, so it is the one column whose leader is
           * the best RATE — among players with real volume. Without the floor a player who
           * went 2-for-2 in one appearance leads the franchise at 100%. Rounded to the
           * printed precision so two cells reading ".598" cannot have one of them bold.
           */
          lead:
            p.fgPct > 0 && p.fga * p.gp >= maxFga * QUALIFY
              ? Math.round(p.fgPct * 1000)
              : null,
        },
        titles: {
          sort: p.titles,
          text: p.titles ? String(p.titles) : "—",
          color: p.titles ? "var(--good)" : undefined,
          lead: p.titles || null,
        },
        // A dash, not 0.00: players under the games minimum are UNRATED rather than rated
        // zero, and a printed 0.00 would read as a verdict the sample cannot support.
        rating: {
          sort: p.rating,
          text: p.rating > 0 ? p.rating.toFixed(2) : "—",
          lead: p.rating > 0 ? p.rating : null,
        },
        honors: {
          sort: p.honors === "Jersey" ? 2 : p.honors === "HoF" ? 1 : 0,
          text: p.honors ?? "—",
          color:
            p.honors === "Jersey"
              ? "var(--cobalt)"
              : p.honors === "HoF"
                ? "var(--good)"
                : undefined,
        },
      };

      for (const s of STATS) {
        const perGame = p[s.of] as number;
        const total = perGame * p.gp;
        const shown =
          mode === "total" ? total : mode === "share"
            ? (totals[s.key] > 0 ? (total / totals[s.key]) * 100 : 0)
            : perGame;
        const text = !p.gp
          ? "—"
          : mode === "total"
            ? Math.round(total).toLocaleString("en-US")
            : mode === "share"
              ? `${shown.toFixed(1)}%`
              : shown.toFixed(1);
        cells[s.key] = {
          sort: shown,
          text,
          // The leader is the TOTAL in every mode. Under the games minimum a career line
          // is noise, so those rows are listed but never crowned — the same threshold
          // that leaves their Rating as a dash.
          lead: NO_LEADER.has(s.key) || p.gp < minGp ? null : Math.round(total),
        };
      }

      return { id: p.id, cells };
    });

    return { cols, rows };
  }, [players, mode, minGp]);

  return (
    <>
      <FilterBar className="controls">
        <div className="segmented" role="group" aria-label="Stat units">
          {MODES.map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={`seg ${mode === k ? "seg-on" : ""}`}
              aria-pressed={mode === k}
              onClick={() => setMode(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </FilterBar>

      <SortableTable
        cols={cols}
        rows={rows}
        defaultKey="rating"
        defaultDesc
        // `sheet-fixed` locks the column widths against sorting; it is paired with a
        // min-width in globals.css and must never be used without one.
        className="sheet-tight sheet-fixed"
        pageSize={PLAYER_ROWS}
      />

      <p className="caption">
        Bold marks the career-total leader in each column, whichever unit is shown — a
        player needs {minGp} games to be in the running.{" "}
        {mode === "game" && "Per game played while on your roster. "}
        {mode === "share" && "Each player's share of the franchise all-time total. "}
        FG% has no total, so its leader is the best rate among players with at least{" "}
        {Math.round(QUALIFY * 100)}% of the most attempts. Turnovers have no leader.
      </p>
    </>
  );
}
