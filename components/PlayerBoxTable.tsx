"use client";

import { useMemo, useState } from "react";
import type { BoxLine } from "@/lib/loadLeague";
import PlayerLink from "./PlayerLink";

/**
 * Columns for a player line, in ESPN's own box-score order: opponents, then the stat group.
 *
 * MINUTES are deliberately absent. They are not a scored category in this league, so the
 * column bought a reader nothing here while costing width on the one table that is already
 * the widest thing in the app — and on a phone it was the first column pushed under the
 * frozen name. The export still carries `BoxLine.min`, and the draft projection reads it
 * (it is the only place minutes exist in the data); this table just doesn't show it.
 */
const BOX_COLS = [
  "FGM/FGA", "FG%", "FTM/FTA", "FT%", "3PM/3PA", "3P%",
  "REB", "AST", "STL", "BLK", "TO", "DD", "PTS", "TW",
] as const;

type BoxCol = (typeof BOX_COLS)[number];
type SortKey = "name" | BoxCol;
type Dir = "asc" | "desc";

/**
 * One team's players for a matchup period, sortable, with a TOTALS row.
 *
 * A CLIENT component, unlike the rest of BoxScoreSheet: sorting is local UI state. It
 * lives in its own file so that importing it doesn't drag `CategorySheet` and friends —
 * which a server component (WeekRecap) renders — into the client bundle with it.
 *
 * Makes/attempts render as ONE cell ("12/16"), matching ESPN's own box score, rather than
 * three separate FGM/FGA/FG% columns — FG% is still its own column (a rate, not a raw
 * stat), but the makes and attempts that produce it read as a pair, not two unrelated
 * counting stats. The totals row has to equal the category sheet above it; that identity
 * is the reader's own check that both halves came from the same week, so it is NOT part
 * of the sort — it stays pinned at the bottom however the rows above are ordered.
 */
export function PlayerBoxTable({
  title,
  stats,
  lines,
}: {
  title: string;
  stats: string[];
  lines: BoxLine[];
}) {
  // Biggest scorer first — the order the table had before it was sortable.
  const [sort, setSort] = useState<{ key: SortKey; dir: Dir }>({ key: "PTS", dir: "desc" });

  const at = (l: BoxLine, stat: string) => l.v?.[stats.indexOf(stat)] ?? 0;

  /**
   * What a column sorts BY, which is not always what it displays: the paired cells sort
   * on makes, and a percentage sorts on the rate it prints rather than the string.
   * A rate with no attempts returns -1 so "no data" sinks under a genuine 0%.
   */
  const sortVal = (l: BoxLine, key: SortKey): number | string => {
    if (key === "name") return l.name.toLowerCase();
    if (key === "FGM/FGA") return at(l, "FGM");
    if (key === "FTM/FTA") return at(l, "FTM");
    if (key === "3PM/3PA") return at(l, "3PM");
    if (key === "FG%" || key === "FT%" || key === "3P%") {
      const [m, a] =
        key === "FG%" ? ["FGM", "FGA"] : key === "FT%" ? ["FTM", "FTA"] : ["3PM", "3PA"];
      const att = at(l, a);
      return att ? at(l, m) / att : -1;
    }
    return at(l, key);
  };

  const played = useMemo(() => {
    const rows = [...lines];
    rows.sort((a, b) => {
      const x = sortVal(a, sort.key);
      const y = sortVal(b, sort.key);
      const cmp =
        typeof x === "string" || typeof y === "string"
          ? String(x).localeCompare(String(y))
          : x - y;
      // Ties fall back to name, so a re-sort on a column full of zeros is still stable
      // and predictable rather than dependent on the export's own ordering.
      return (sort.dir === "asc" ? cmp : -cmp) || a.name.localeCompare(b.name);
    });
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, sort, stats]);

  const totals = lines.reduce<Record<string, number>>((acc, l) => {
    acc.GP = (acc.GP ?? 0) + (l.gp || 0);
    for (const s of stats) acc[s] = (acc[s] ?? 0) + at(l, s);
    return acc;
  }, {});

  if (!lines.length) return null;

  const madeAttempt = (src: Record<string, number> | BoxLine, made: string, att: string) => {
    const get = (s: string) =>
      "v" in src || "gp" in src ? at(src as BoxLine, s) : (src as Record<string, number>)[s] ?? 0;
    const m = get(made);
    const a = get(att);
    return a || m ? `${m.toLocaleString("en-US")}/${a.toLocaleString("en-US")}` : "—";
  };

  const cell = (src: Record<string, number> | BoxLine, col: BoxCol): string => {
    const get = (s: string) =>
      "v" in src || "gp" in src ? at(src as BoxLine, s) : (src as Record<string, number>)[s] ?? 0;
    if (col === "FGM/FGA") return madeAttempt(src, "FGM", "FGA");
    if (col === "FTM/FTA") return madeAttempt(src, "FTM", "FTA");
    if (col === "3PM/3PA") return madeAttempt(src, "3PM", "3PA");
    // Percentages are RATES: derived from the makes and attempts, never averaged.
    if (col === "FG%" || col === "FT%" || col === "3P%") {
      const [m, a] =
        col === "FG%" ? ["FGM", "FGA"] : col === "FT%" ? ["FTM", "FTA"] : ["3PM", "3PA"];
      const att = get(a);
      return att ? `${((get(m) / att) * 100).toFixed(1)}%` : "—";
    }
    const v = get(col);
    return v ? v.toLocaleString("en-US") : "—";
  };

  /** Clicking the active column flips direction; a new column starts at its natural end. */
  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "name" ? "asc" : "desc" }
    );

  /** Header cell, matching the app's existing sortable-table markup (see SortableTable). */
  const Th = ({ k, label, num }: { k: SortKey; label: string; num?: boolean }) => {
    const active = sort.key === k;
    return (
      <th
        className={num ? "num" : undefined}
        aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : "none"}
      >
        <button type="button" className="th-sort" onClick={() => onSort(k)}>
          {label}
          <span className={`sort-caret ${active ? "on" : ""}`} aria-hidden="true">
            {active ? (sort.dir === "desc" ? "▾" : "▴") : "▾"}
          </span>
        </button>
      </th>
    );
  };

  return (
    <>
      <h2 className="rc-box-title">{title}</h2>
      <div className="table-scroll">
        <table className="sheet sortable rc-box">
          <thead>
            <tr>
              <Th k="name" label="Starters" />
              {BOX_COLS.map((c) => (
                <Th key={c} k={c} label={c} num />
              ))}
            </tr>
          </thead>
          <tbody>
            {played.map((l) => (
              <tr key={l.name} className={l.gp ? undefined : "row-muted"}>
                <td className="rc-player"><PlayerLink name={l.name} /></td>
                {BOX_COLS.map((c) => (
                  <td className="num" key={c}>
                    {cell(l, c)}
                  </td>
                ))}
              </tr>
            ))}
            <tr className="rc-totals">
              <td>Totals</td>
              {BOX_COLS.map((c) => (
                <td className="num" key={c}>
                  {cell(totals, c)}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

export default PlayerBoxTable;
