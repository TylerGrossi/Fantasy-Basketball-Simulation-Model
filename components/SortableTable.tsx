"use client";

import { useMemo, useState } from "react";

export interface SortCol {
  key: string;
  label: string;
  /** Right-aligned, monospace tabular figures. */
  num?: boolean;
}

export interface SortCell {
  /** What to order by — kept apart from `text` so "185-92-8" can sort by win %. */
  sort: number | string;
  text: string;
  /** Optional per-cell colour, e.g. luck green/red. */
  color?: string;
}

export interface SortRow {
  id: string | number;
  /** Your own team, highlighted so it is findable in a ten-row table. */
  highlight?: boolean;
  cells: Record<string, SortCell>;
}

interface Props {
  cols: SortCol[];
  rows: SortRow[];
  /** Column to sort on first. */
  defaultKey: string;
  /** Descending by default — false for rank-style columns where 1 comes first. */
  defaultDesc?: boolean;
}

/**
 * A sortable table, the equivalent of the legacy app's `render_sortable_table`.
 *
 * Sorting is view state over rows the server already computed, so this is the only part
 * that needs to be a client component — the page around it stays server-rendered and the
 * league object never crosses the boundary.
 */
export default function SortableTable({ cols, rows, defaultKey, defaultDesc = true }: Props) {
  const [sort, setSort] = useState({ key: defaultKey, desc: defaultDesc });

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const av = a.cells[sort.key]?.sort ?? 0;
      const bv = b.cells[sort.key]?.sort ?? 0;
      const d =
        typeof av === "string" || typeof bv === "string"
          ? String(av).localeCompare(String(bv))
          : av - bv;
      return sort.desc ? -d : d;
    });
    return out;
  }, [rows, sort]);

  const click = (c: SortCol) =>
    setSort((s) =>
      // Same column flips; a new one opens the way that column is most useful —
      // biggest first for numbers, A-Z for text.
      s.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: !!c.num }
    );

  return (
    <div className="table-scroll">
      <table className="sheet sortable">
        <thead>
          <tr>
            {cols.map((c) => {
              const active = sort.key === c.key;
              return (
                <th
                  key={c.key}
                  className={c.num ? "num" : undefined}
                  aria-sort={active ? (sort.desc ? "descending" : "ascending") : "none"}
                >
                  <button type="button" className="th-sort" onClick={() => click(c)}>
                    {c.label}
                    <span className={`sort-caret ${active ? "on" : ""}`} aria-hidden="true">
                      {active ? (sort.desc ? "▾" : "▴") : "▾"}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className={r.highlight ? "row-you" : undefined}>
              {cols.map((c) => {
                const cell = r.cells[c.key];
                return (
                  <td
                    key={c.key}
                    className={c.num ? "num" : undefined}
                    style={cell?.color ? { color: cell.color } : undefined}
                  >
                    {cell?.text ?? ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
